const { Op } = require("sequelize");
const {
  sequelize,
  Refund,
  RefundSegment,
  Ticket,
  Booking,
  Trip,
  TrainName,
  Station,
  RouteStop,
  SeatSegmentBooking,
  TripSeat,
} = require("../models");
const { REFUND_STATUS } = require("../models/Refund");
const { TICKET_STATUS, TICKET_KIND } = require("../models/Ticket");
const { BOOKING_STATUS } = require("../models/Booking");
const { SEGMENT_SOURCE } = require("../models/SeatSegmentBooking");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const money = require("../utils/money");
const { refundReference, unique } = require("../utils/reference");
const { instantAt } = require("../utils/dhakaTime");
const policies = require("../utils/refundPolicy");
const inventory = require("./inventoryService");
const walletService = require("./walletService");
const settings = require("./settingService");
const audit = require("./auditService");

/*
 * Lazily required to break the cycle: the waitlist confirms offers by making
 * bookings, and bookings can be refunded. See the same note in holdService.
 */
const waitlist = () => require("./waitlistService");
// Lazily, like the waitlist: the job service is loaded by the worker, which
// loads the handlers, which load this.
const jobs = () => require("./jobService");
const notify = require("./notificationService");

/**
 * Giving a ticket back.
 *
 * Two policies (§11), and the same shape underneath both: the seat returns to
 * inventory immediately, and the money follows on a schedule the policy
 * decides. A convenient return pays at once, less a deduction; a demand-based
 * one pays per segment, and only for the segments that find another buyer.
 *
 * Seats come back the moment the return is accepted, under either policy. A
 * passenger who has decided not to travel should not be occupying a seat while
 * the railway works out what to pay them — and for a demand return, the seat
 * being on sale *is* the mechanism.
 *
 * Money always lands in the wallet (§8.1). Three segments reselling separately
 * would otherwise mean three gateway refunds with three sets of fees, and the
 * wallet is what makes per-segment refunding practical at all.
 */

/** The moment the passenger's own leg departs — what every deadline is measured from. */
async function departureInstantFor(booking) {
  const stop = await RouteStop.findOne({
    where: { trainId: booking.trip.trainId, stationId: booking.fromStationId },
  });
  if (!stop) return null;

  return instantAt(
    booking.trip.departureDate,
    stop.departureTime || stop.arrivalTime || "00:00:00",
    stop.dayOffset || 0
  );
}

const TICKET_INCLUDE = [
  {
    model: Booking,
    as: "booking",
    include: [
      { model: Trip, as: "trip", include: [{ model: TrainName, as: "train" }] },
      { model: Station, as: "fromStation" },
      { model: Station, as: "toStation" },
    ],
  },
];

async function ticketOr404(ticketId, { userId, canViewAll = false }) {
  const ticket = await Ticket.findByPk(ticketId, { include: TICKET_INCLUDE });
  if (!ticket) throw ApiError.notFound("Ticket not found");

  if (!canViewAll && userId && ticket.booking.userId !== userId) {
    throw ApiError.notFound("Ticket not found");
  }
  return ticket;
}

/** The segments this ticket currently occupies, in route order. */
async function segmentsHeldBy(ticketId) {
  const rows = await SeatSegmentBooking.findAll({
    where: { ticketId, source: SEGMENT_SOURCE.TICKET },
    order: [["segmentIndex", "ASC"]],
  });
  return rows;
}

/* ------------------------------------------------------------------ *
 * Quoting
 * ------------------------------------------------------------------ */

/**
 * What each policy would pay for this ticket, right now.
 *
 * Both are quoted together rather than one at a time, because the choice
 * between them is the decision a passenger is actually making: near departure,
 * a convenient return pays nothing while a demand return might still pay most
 * of the fare, and seeing both side by side is what makes that obvious.
 */
async function quote({ ticketId, userId, canViewAll = false, now = new Date() }) {
  const ticket = await ticketOr404(ticketId, { userId, canViewAll });

  const existing = await Refund.findOne({ where: { ticketId: ticket.id } });
  if (existing) {
    throw ApiError.conflict(
      `That ticket was already returned (${existing.reference}). ` +
        `${money.format(existing.refundedMinor)} has been credited so far.`
    );
  }

  if (ticket.status !== TICKET_STATUS.VALID) {
    throw ApiError.badRequest(
      ticket.status === TICKET_STATUS.USED
        ? "That ticket has already been travelled on."
        : `That ticket is ${ticket.status} and cannot be returned.`
    );
  }

  /*
   * A standing ticket cannot be returned on its own while its seat is held
   * (§11.3).
   *
   * Standing exists to carry someone over the part of a journey their seat does
   * not. Letting them return the standing leg alone leaves a passenger holding
   * a seat for the middle of a journey with no ticket for either end — which is
   * exactly the situation standing was introduced to prevent. Returning the
   * seat releases its standing legs along with it.
   */
  if (ticket.kind === TICKET_KIND.STANDING && ticket.seatedTicketId) {
    const seat = await Ticket.findByPk(ticket.seatedTicketId);
    if (seat && seat.status === TICKET_STATUS.VALID) {
      throw ApiError.badRequest(
        `This standing ticket goes with seat ${seat.seatNumber}, which you still hold. ` +
          "Return the seat and this goes back with it, or keep both."
      );
    }
  }

  const departureInstant = await departureInstantFor(ticket.booking);
  const segments = await segmentsHeldBy(ticket.id);
  const trip = ticket.booking.trip;

  // Amounts in taka in the settings screen, minor units everywhere below it.
  const taka = (key) => money.toMinor(settings.get(key));

  let convenient = policies.policyFor(policies.REFUND_TYPE.CONVENIENT).quote({
    fareMinor: ticket.fareMinor,
    departureInstant,
    slabs: settings.get("refund.convenient_slabs"),
    bounds: {
      minMinor: taka("refund.convenient_charge_min"),
      maxMinor: taka("refund.convenient_charge_max"),
    },
    now,
  });

  let demand = policies.policyFor(policies.REFUND_TYPE.DEMAND).quote({
    fareMinor: ticket.fareMinor,
    segmentCount: segments.length || 1,
    departureInstant,
    chargePercent: settings.get("refund.demand_charge_percent"),
    bounds: {
      minMinor: taka("refund.demand_charge_min"),
      maxMinor: taka("refund.demand_charge_max"),
    },
    now,
  });

  // Too close to departure for a re-listing to be worth anything: better to
  // refuse than to accept a return that was always going to pay nothing.
  const saleOpenHours = settings.get("refund.sale_open_hours_before");
  const hoursRemaining = policies.hoursUntil(departureInstant, now);
  if (demand.ok && hoursRemaining < saleOpenHours) {
    demand = {
      ok: false,
      reason: policies.REFUSAL.SALE_CLOSED,
      message:
        `Returned seats stop going back on sale ${saleOpenHours} hour(s) before departure, ` +
        "so a demand-based return can no longer be accepted for this train.",
    };
  }

  // Switched off for this departure. Checked after pricing rather than instead
  // of it, so the passenger is told the option exists and is unavailable here
  // rather than being shown a shorter list with no explanation.
  if (!trip.convenientReturnEnabled) {
    convenient = {
      ok: false,
      reason: policies.REFUSAL.DISABLED,
      message: "A convenient return is not offered on this departure.",
    };
  }
  if (!trip.demandReturnEnabled) {
    demand = {
      ok: false,
      reason: policies.REFUSAL.DISABLED,
      message: "A demand-based return is not offered on this departure.",
    };
  }

  return {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    seatNumber: ticket.seatNumber,
    coachCode: ticket.coachCode,
    passengerName: ticket.passengerName,
    fareMinor: ticket.fareMinor,
    fareFormatted: money.format(ticket.fareMinor),
    departureInstant,
    hoursRemaining: Math.max(0, hoursRemaining),
    segmentCount: segments.length,
    options: [
      { ...policySummary(policies.REFUND_TYPE.CONVENIENT), ...convenient },
      { ...policySummary(policies.REFUND_TYPE.DEMAND), ...demand },
    ],
  };
}

function policySummary(type) {
  const policy = policies.policyFor(type);
  return { type, label: policy.label, describe: policy.describe };
}

/* ------------------------------------------------------------------ *
 * Returning
 * ------------------------------------------------------------------ */

/**
 * Accept a return.
 *
 * Everything that must be true together is true together: the seat leaves the
 * ticket, the ticket is marked returned, the refund is recorded, and — for a
 * convenient return — the wallet is credited. A failure anywhere leaves the
 * passenger holding the ticket they started with.
 */
async function request({ ticketId, type, userId, canViewAll = false, now = new Date() }) {
  const priced = await quote({ ticketId, userId, canViewAll, now });

  if (!policies.PASSENGER_POLICIES.includes(type)) {
    throw ApiError.badRequest(
      `"${type}" is not a return a passenger can ask for. Choose ${policies.PASSENGER_POLICIES.join(" or ")}.`
    );
  }

  const option = priced.options.find((o) => o.type === type);
  if (!option) throw ApiError.badRequest(`Unknown return type "${type}"`);
  if (!option.ok) throw ApiError.badRequest(option.message);

  const ticket = await ticketOr404(ticketId, { userId, canViewAll });
  const segments = await segmentsHeldBy(ticket.id);

  const reference = await unique(refundReference, async (candidate) =>
    Boolean(await Refund.findOne({ where: { reference: candidate } }))
  );

  let releasedStanding = [];

  const refund = await sequelize.transaction(async (transaction) => {
    // Re-read under lock: two tabs, two clicks, one refund.
    const live = await Ticket.findByPk(ticket.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (live.status !== TICKET_STATUS.VALID) {
      throw ApiError.conflict("That ticket was already returned a moment ago.");
    }

    const isImmediate = option.immediate;

    const created = await Refund.create(
      {
        reference,
        ticketId: ticket.id,
        bookingId: ticket.bookingId,
        userId: ticket.booking.userId,
        type,
        status: isImmediate ? REFUND_STATUS.SETTLED : REFUND_STATUS.AWAITING_RESALE,
        fareMinor: ticket.fareMinor,
        deductionPercent: option.percent,
        refundedMinor: isImmediate ? option.refundMinor : 0,
        maximumMinor: isImmediate ? option.refundMinor : option.maximumMinor,
        closedAt: isImmediate ? new Date() : null,
      },
      { transaction }
    );

    // A demand return watches each segment for a buyer. A convenient one is
    // already paid, so there is nothing to watch.
    if (!isImmediate) {
      await RefundSegment.bulkCreate(
        segments.map((segment, i) => ({
          refundId: created.id,
          tripSeatId: segment.tripSeatId,
          segmentIndex: segment.segmentIndex,
          shareMinor: option.lines[i]?.shareMinor ?? 0,
          refundMinor: option.lines[i]?.refundMinor ?? 0,
        })),
        { transaction }
      );
    }

    // The seat goes back on sale under both policies.
    await SeatSegmentBooking.destroy({
      where: { ticketId: ticket.id, source: SEGMENT_SOURCE.TICKET },
      transaction,
    });

    await live.update({ status: TICKET_STATUS.REFUNDED }, { transaction });

    // Any standing legs attached to this seat go back with it, refunded in
    // full — the passenger is not choosing to give them up, they are losing
    // the seat those legs existed to connect to.
    releasedStanding = await releaseStandingFor(live, ticket.booking.userId, transaction);

    if (isImmediate && option.refundMinor > 0) {
      await walletService.refund(
        {
          userId: ticket.booking.userId,
          amountMinor: option.refundMinor,
          bookingId: ticket.bookingId,
          description: `Return of ticket ${ticket.ticketNumber}`,
        },
        { transaction }
      );
    }

    await closeBookingIfEmpty(ticket.bookingId, transaction);

    return created;
  });

  await audit.record({
    action: AUDIT_ACTIONS.REFUND_REQUEST,
    entity: { type: "refund", id: refund.id, label: refund.reference },
    after: {
      ticket: ticket.ticketNumber,
      type,
      deduction: `${option.percent}%`,
      credited: money.format(refund.refundedMinor),
      maximum: money.format(refund.maximumMinor),
      segmentsWatched: option.immediate ? 0 : segments.length,
    },
    message:
      `${ticket.ticketNumber} returned (${type}) — ` +
      (option.immediate
        ? `${money.format(refund.refundedMinor)} credited`
        : `up to ${money.format(refund.maximumMinor)} as ${segments.length} segment(s) resell`),
  });

  /*
   * Tell the queue, after the commit.
   *
   * This is the case the waitlist exists for. A demand-based return pays out
   * only if the seat resells before the train leaves (§11.2) — so the seconds
   * between a return being accepted and the seat being offered to someone who
   * already said they wanted it are the difference between that policy paying
   * and quietly paying nothing.
   */
  waitlist().seatsFreed(ticket.booking.tripId, `ticket ${ticket.ticketNumber} returned`);

  const settled = await get(refund.id, { userId: ticket.booking.userId, canViewAll: true });

  /*
   * Tell them what they have actually agreed to.
   *
   * The two policies need different messages, not the same message with a
   * different number: a convenient return is finished, a demand return has only
   * started and may yet pay nothing. A passenger who learns that a fortnight
   * later, from a wallet that never moved, has been treated badly.
   */
  notify.ticketReturned({
    userId: ticket.booking.userId,
    refund: settled,
    ticket,
    journey: [ticket.booking.fromStation?.name, ticket.booking.toStation?.name]
      .filter(Boolean)
      .join(" → "),
    immediate: option.immediate,
    segments: option.immediate ? 0 : segments.length,
  });

  return settled;
}

/**
 * Give back the standing legs that were riding on a seat.
 *
 * Refunded in full and without a deduction: the passenger did not choose to
 * give these up, they lost the seat these legs existed to connect to. Charging
 * a cancellation fee for that would be charging them for the railway's own
 * arithmetic.
 */
async function releaseStandingFor(seatedTicket, userId, transaction) {
  const legs = await Ticket.findAll({
    where: {
      seatedTicketId: seatedTicket.id,
      kind: TICKET_KIND.STANDING,
      status: TICKET_STATUS.VALID,
    },
    transaction,
  });

  const released = [];

  for (const leg of legs) {
    await leg.update({ status: TICKET_STATUS.REFUNDED }, { transaction });

    if (leg.fareMinor > 0) {
      await walletService.refund(
        {
          userId,
          amountMinor: leg.fareMinor,
          bookingId: leg.bookingId,
          description: `Standing ticket ${leg.ticketNumber} released with its seat`,
        },
        { transaction }
      );
    }

    await closeBookingIfEmpty(leg.bookingId, transaction);
    released.push({ ticketNumber: leg.ticketNumber, refundMinor: leg.fareMinor });
  }

  return released;
}

/**
 * Mark the booking refunded once its last valid ticket has gone.
 *
 * A booking that still has tickets someone can travel on is still confirmed —
 * there is no "partly refunded" status because there does not need to be. Which
 * tickets were returned is recorded on the tickets, where it is unambiguous;
 * putting a summary of that on the booking would be a second source of truth to
 * keep in step.
 */
async function closeBookingIfEmpty(bookingId, transaction) {
  const remaining = await Ticket.count({
    where: { bookingId, status: TICKET_STATUS.VALID },
    transaction,
  });
  if (remaining > 0) return;

  const booking = await Booking.findByPk(bookingId, { transaction });
  if (!booking) return;

  await booking.update({ status: BOOKING_STATUS.REFUNDED }, { transaction });
}

/* ------------------------------------------------------------------ *
 * Settling as segments resell
 * ------------------------------------------------------------------ */

/**
 * Pay out any demand refunds waiting on the segments just sold.
 *
 * Called from inside the booking transaction, so a resale and the refund it
 * triggers commit together — there is no window in which a seat has been sold
 * twice over but paid for once.
 *
 * `segments` is what the new sale took: `[{ tripSeatId, segmentIndex, ticketId }]`.
 */
async function settleResold(segments, { transaction } = {}) {
  if (!segments?.length) return { settled: 0, paidMinor: 0 };

  const waiting = await RefundSegment.findAll({
    where: {
      settledAt: null,
      [Op.or]: segments.map((s) => ({
        tripSeatId: Number(s.tripSeatId),
        segmentIndex: Number(s.segmentIndex),
      })),
    },
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
  });

  if (!waiting.length) return { settled: 0, paidMinor: 0, payouts: [] };

  let paidMinor = 0;
  const touchedRefunds = new Set();
  /*
   * What to tell people once this has committed.
   *
   * A demand-based return can pay in instalments over days as separate stretches
   * of the seat find buyers. Without a message each time, a passenger has to
   * keep opening the wallet page to discover money has arrived — being paid
   * without being told is barely better than not being paid.
   */
  const payouts = [];

  for (const segment of waiting) {
    const sale = segments.find(
      (s) =>
        Number(s.tripSeatId) === segment.tripSeatId &&
        Number(s.segmentIndex) === segment.segmentIndex
    );

    const refund = await Refund.findByPk(segment.refundId, {
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
    if (!refund || !refund.isOpen) continue;

    if (segment.refundMinor > 0) {
      await walletService.refund(
        {
          userId: refund.userId,
          amountMinor: segment.refundMinor,
          bookingId: refund.bookingId,
          description: `Segment ${segment.segmentIndex} of ${refund.reference} resold`,
        },
        { transaction }
      );
    }

    await segment.update(
      {
        resoldAt: new Date(),
        resoldTicketId: sale?.ticketId || null,
        settledAt: new Date(),
      },
      { transaction }
    );

    await refund.update(
      { refundedMinor: Number(refund.refundedMinor) + segment.refundMinor },
      { transaction }
    );

    paidMinor += segment.refundMinor;
    touchedRefunds.add(refund.id);

    // Collected, not sent: this runs inside the buyer's transaction, and a mail
    // announcing money that then rolls back is worse than no mail at all. The
    // caller sends these once the sale has committed.
    payouts.push({
      userId: refund.userId,
      refundId: refund.id,
      refundReference: refund.reference,
      paidMinor: segment.refundMinor,
    });
  }

  // A refund whose every segment has now sold is finished.
  for (const refundId of touchedRefunds) {
    const outstanding = await RefundSegment.count({
      where: { refundId, settledAt: null },
      transaction,
    });

    await Refund.update(
      {
        status: outstanding === 0 ? REFUND_STATUS.SETTLED : REFUND_STATUS.PARTIALLY_SETTLED,
        ...(outstanding === 0 ? { closedAt: new Date() } : {}),
      },
      { where: { id: refundId }, transaction }
    );
  }

  return { settled: waiting.length, paidMinor, payouts };
}

/**
 * Send the messages `settleResold` collected, now that the sale has committed.
 *
 * Separate from `settleResold` because that runs inside the buyer's
 * transaction. Re-reads each refund so the totals quoted are the committed
 * ones, and so "is this return now finished" is answered from the same row the
 * passenger would see.
 */
async function announceSettlements(payouts = []) {
  for (const payout of payouts) {
    const refund = await Refund.findByPk(payout.refundId);
    if (!refund) continue;

    const remaining = await RefundSegment.count({
      where: { refundId: refund.id, settledAt: null },
    });

    await notify.refundSegmentSettled({
      userId: payout.userId,
      refund,
      paidMinor: payout.paidMinor,
      remaining,
    });
  }
}

/**
 * Close out refunds on trains that have left.
 *
 * Segments still unsold at departure will never sell, and the spec is explicit
 * that they refund nothing (§11.2). Leaving them open would mean a passenger
 * watching a refund that can no longer move.
 *
 * Idempotent: a refund already closed is not selected again.
 */
async function closeDeparted({ now = new Date() } = {}) {
  const open = await Refund.findAll({
    where: { status: [REFUND_STATUS.AWAITING_RESALE, REFUND_STATUS.PARTIALLY_SETTLED] },
    include: [
      {
        model: Booking,
        as: "booking",
        include: [{ model: Trip, as: "trip" }],
      },
    ],
  });

  if (!open.length) return { closed: 0, unsoldSegments: 0 };

  let closed = 0;
  let unsoldSegments = 0;

  for (const refund of open) {
    const departureInstant = await departureInstantFor(refund.booking);
    if (!departureInstant || new Date(departureInstant) > now) continue;

    const unsold = await RefundSegment.count({ where: { refundId: refund.id, settledAt: null } });

    await refund.update({
      status: REFUND_STATUS.CLOSED,
      closedAt: now,
      note:
        unsold > 0
          ? `${unsold} segment(s) did not resell before departure and refund nothing.`
          : null,
    });

    closed += 1;
    unsoldSegments += unsold;

    // Closing silently would leave someone waiting indefinitely for money that
    // is now never coming.
    notify.refundClosedUnsold({
      userId: refund.userId,
      refund,
      unsoldSegments: unsold,
    });
  }

  if (closed) {
    await audit.record({
      action: AUDIT_ACTIONS.REFUND_CLOSE,
      entity: { type: "refund", id: String(closed) },
      after: { closed, unsoldSegments },
      message: `${closed} demand-based return(s) closed at departure, ${unsoldSegments} segment(s) unsold`,
    });
  }

  return { closed, unsoldSegments };
}

/* ------------------------------------------------------------------ *
 * When the railway is the one who cancels
 * ------------------------------------------------------------------ */

/**
 * Make every passenger on a cancelled service whole.
 *
 * Nothing is deducted. A deduction prices the cost of someone changing their
 * mind; when the operator changed the plan, there is no such cost to pass on.
 * This also ignores the departure's return switches and the time remaining —
 * those govern what a passenger may *ask* for, and this is not a request.
 *
 * Tickets already returned are skipped, so cancelling a train on which some
 * people had already given seats back does not pay them twice. Idempotent for
 * the same reason: cancelling twice refunds nobody a second time.
 *
 * ## Resumable, which is what lets it run as a job
 *
 * Each ticket is refunded in its own transaction, and a ticket already refunded
 * is no longer valid and is never read again. So this can stop anywhere — a
 * `limit` reached, a process killed — and the next call carries on with exactly
 * the tickets still owed, paying nobody twice. The cancellation jobs call it in
 * batches until a batch finds nothing left (see jobs/handlers.js).
 *
 * ## Each passenger's message is written down with their refund
 *
 * The "your train is cancelled" message is queued as a job *inside* the
 * ticket's refund transaction. If the refund commits, the message is owed and
 * will be sent — retried if the mail server is down, resumed if the process
 * restarts. Sent after the loop instead, as it used to be, a restart between
 * the refunds and the messages left people refunded and never told why.
 *
 * `audit: false` lets a caller running many batches record one entry for the
 * whole cancellation instead of one per batch.
 */
async function issueForCancellation({ tripId, tripCoachId, reason, actorLabel, limit, audit: doAudit = true }) {
  /*
   * The whole departure, or one coach of it.
   *
   * One refund path for every disruption rather than a second for coaches: the
   * rules are identical (full fare, nothing deducted, told why), and two copies
   * of those rules is how a coach cancellation ends up refunding differently
   * from a train cancellation the first time somebody edits one of them.
   *
   * A coach's passengers are the seated tickets on its seats **and** the
   * standing tickets on that coach. Missing the second would leave people
   * holding standing tickets for a carriage that is not running.
   */
  let where = { status: TICKET_STATUS.VALID };
  if (tripCoachId) {
    const seatIds = (
      await TripSeat.findAll({
        where: { tripCoachId: Number(tripCoachId) },
        attributes: ["id"],
        raw: true,
      })
    ).map((seat) => seat.id);

    where = {
      status: TICKET_STATUS.VALID,
      [Op.or]: [
        ...(seatIds.length ? [{ tripSeatId: seatIds }] : []),
        { tripCoachId: Number(tripCoachId) },
      ],
    };
  }

  const tickets = await Ticket.findAll({
    where,
    order: [["id", "ASC"]],
    ...(limit ? { limit: Number(limit) } : {}),
    include: [
      {
        model: Booking,
        as: "booking",
        where: { tripId: Number(tripId) },
        required: true,
        // The train and both stations are loaded because the passenger has to
        // be told which service was cancelled — "your train is cancelled" with
        // no train named is not a usable message.
        include: [
          { model: Trip, as: "trip", include: [{ model: TrainName, as: "train" }] },
          { model: Station, as: "fromStation" },
          { model: Station, as: "toStation" },
        ],
      },
    ],
  });

  if (!tickets.length) return { found: 0, refunded: 0, paidMinor: 0, refunds: [] };

  const policy = policies.policyFor(policies.REFUND_TYPE.DISRUPTION);
  const issued = [];
  let paidMinor = 0;

  for (const ticket of tickets) {
    // References are generated outside the transaction to keep the uniqueness
    // probe off the write path.
    const reference = await unique(refundReference, async (candidate) =>
      Boolean(await Refund.findOne({ where: { reference: candidate } }))
    );

    const quoted = policy.quote({ fareMinor: ticket.fareMinor });

    await sequelize.transaction(async (transaction) => {
      const live = await Ticket.findByPk(ticket.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      // Returned in the moments since the list was read.
      if (!live || live.status !== TICKET_STATUS.VALID) return;

      const refund = await Refund.create(
        {
          reference,
          ticketId: ticket.id,
          bookingId: ticket.bookingId,
          userId: ticket.booking.userId,
          type: policies.REFUND_TYPE.DISRUPTION,
          status: REFUND_STATUS.SETTLED,
          fareMinor: ticket.fareMinor,
          deductionPercent: 0,
          refundedMinor: quoted.refundMinor,
          maximumMinor: quoted.refundMinor,
          closedAt: new Date(),
          note: reason || "Service cancelled by the railway",
        },
        { transaction }
      );

      await SeatSegmentBooking.destroy({
        where: { ticketId: ticket.id, source: SEGMENT_SOURCE.TICKET },
        transaction,
      });

      await live.update({ status: TICKET_STATUS.REFUNDED }, { transaction });

      if (quoted.refundMinor > 0) {
        await walletService.refund(
          {
            userId: ticket.booking.userId,
            amountMinor: quoted.refundMinor,
            bookingId: ticket.bookingId,
            description: `${ticket.ticketNumber} — service cancelled`,
          },
          { transaction }
        );
      }

      await closeBookingIfEmpty(ticket.bookingId, transaction);

      const entry = {
        reference,
        ticketNumber: ticket.ticketNumber,
        refundMinor: quoted.refundMinor,
        userId: ticket.booking.userId,
        train: ticket.booking.trip?.train?.name || null,
        journey: [ticket.booking.fromStation?.name, ticket.booking.toStation?.name]
          .filter(Boolean)
          .join(" \u2192 "),
        date: ticket.boardingDate || ticket.booking.trip?.departureDate || null,
      };

      // Owed from the moment the refund is, and not a moment before.
      await jobs().enqueue(
        "notify.departure_cancelled",
        {
          userId: entry.userId,
          ticket: entry.ticketNumber,
          refundMinor: entry.refundMinor,
          reason,
          train: entry.train,
          journey: entry.journey,
          date: entry.date,
        },
        { transaction, label: `Tell ${entry.ticketNumber} their service is cancelled` }
      );

      issued.push(entry);
      paidMinor += quoted.refundMinor;
    });
  }

  if (issued.length && doAudit) {
    await audit.record({
      action: AUDIT_ACTIONS.REFUND_DISRUPTION,
      entity: { type: "trip", id: String(tripId) },
      after: { refunded: issued.length, paid: money.format(paidMinor), reason },
      message:
        `${issued.length} ticket(s) refunded in full — ${money.format(paidMinor)} returned ` +
        `after ${actorLabel || "the railway"} cancelled the service`,
    });
  }

  return { found: tickets.length, refunded: issued.length, paidMinor, refunds: issued };
}

/**
 * Everything refunded for a disruption since a moment — the whole of one
 * cancellation, however many attempts and batches it took.
 *
 * The job that ran it may have been interrupted and resumed, so its own memory
 * of what it paid covers only the last attempt. The refunds themselves are the
 * record, and this reads them back.
 *
 * `afterRefundId` is the highest refund id when the cancellation was queued:
 * everything after it belongs to this cancellation, which separates it from an
 * earlier cancellation of the same departure or coach that was reinstated.
 * An id, not a time — timestamps are stored to the second, and a coach can be
 * cancelled, reinstated and cancelled again inside one.
 */
async function disruptionSummary({ tripId, tripCoachId, afterRefundId = 0 }) {
  const rows = await Refund.findAll({
    where: {
      type: policies.REFUND_TYPE.DISRUPTION,
      id: { [Op.gt]: Number(afterRefundId) || 0 },
    },
    include: [
      { model: Booking, as: "booking", where: { tripId: Number(tripId) }, required: true, attributes: ["id"] },
      { model: Ticket, as: "ticket", attributes: ["id", "ticketNumber", "tripSeatId", "tripCoachId"] },
    ],
    order: [["id", "ASC"]],
  });

  let refunds = rows;
  if (tripCoachId) {
    const seatIds = new Set(
      (
        await TripSeat.findAll({
          where: { tripCoachId: Number(tripCoachId) },
          attributes: ["id"],
          raw: true,
        })
      ).map((seat) => seat.id)
    );
    refunds = rows.filter(
      (r) => seatIds.has(r.ticket?.tripSeatId) || r.ticket?.tripCoachId === Number(tripCoachId)
    );
  }

  const paidMinor = refunds.reduce((n, r) => n + r.refundedMinor, 0);
  return {
    refunded: refunds.length,
    paidMinor,
    paidFormatted: money.format(paidMinor),
    refunds: refunds.map((r) => ({
      reference: r.reference,
      ticketNumber: r.ticket?.ticketNumber || null,
      refundMinor: r.refundedMinor,
      userId: r.userId,
    })),
  };
}

/** How many tickets a disruption still owes a refund, for progress reporting. */
async function countOwedForCancellation({ tripId, tripCoachId }) {
  let where = { status: TICKET_STATUS.VALID };
  if (tripCoachId) {
    const seatIds = (
      await TripSeat.findAll({ where: { tripCoachId: Number(tripCoachId) }, attributes: ["id"], raw: true })
    ).map((seat) => seat.id);
    where = {
      status: TICKET_STATUS.VALID,
      [Op.or]: [...(seatIds.length ? [{ tripSeatId: seatIds }] : []), { tripCoachId: Number(tripCoachId) }],
    };
  }
  return Ticket.count({
    where,
    include: [{ model: Booking, as: "booking", where: { tripId: Number(tripId) }, required: true, attributes: [] }],
  });
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const REFUND_INCLUDE = [
  { model: RefundSegment, as: "segments" },
  { model: Ticket, as: "ticket" },
];

/** The highest refund id so far — where a cancellation's own refunds begin. */
async function lastRefundId({ transaction } = {}) {
  return (await Refund.max("id", { transaction })) || 0;
}

/** How many refunds were issued against a departure. */
async function countForTrip(tripId) {
  return Refund.count({
    include: [{ model: Booking, as: "booking", where: { tripId: Number(tripId) }, required: true }],
  });
}

async function get(id, { userId, canViewAll = false } = {}) {
  const refund = await Refund.findByPk(id, { include: REFUND_INCLUDE });
  if (!refund) throw ApiError.notFound("Refund not found");

  if (!canViewAll && userId && refund.userId !== userId) {
    throw ApiError.notFound("Refund not found");
  }
  return refund.toPublicJSON();
}

async function byReference(reference, { userId, canViewAll = false } = {}) {
  const refund = await Refund.findOne({
    where: { reference: String(reference).toUpperCase() },
    include: REFUND_INCLUDE,
  });
  if (!refund) throw ApiError.notFound("Refund not found");
  if (!canViewAll && userId && refund.userId !== userId) {
    throw ApiError.notFound("Refund not found");
  }
  return refund.toPublicJSON();
}

async function list({ userId, canViewAll = false, page = 1, limit = 20 } = {}) {
  const where = canViewAll && !userId ? {} : { userId: Number(userId) };

  const { rows, count } = await Refund.findAndCountAll({
    where,
    include: REFUND_INCLUDE,
    order: [["id", "DESC"]],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });

  return {
    refunds: rows.map((r) => r.toPublicJSON()),
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
  };
}

module.exports = {
  quote,
  request,
  settleResold,
  announceSettlements,
  closeDeparted,
  issueForCancellation,
  disruptionSummary,
  countOwedForCancellation,
  lastRefundId,
  countForTrip,
  get,
  byReference,
  list,
  departureInstantFor,
  REFUND_STATUS,
};
