const { Op } = require("sequelize");
const {
  sequelize,
  Trip,
  TripCoach,
  TripSeat,
  SeatPlan,
  Ticket,
  SeatSegmentBooking,
  SeatHold,
  WaitlistEntry,
} = require("../models");
const { TRIP_STATUS } = require("../models/Trip");
const { TRIP_COACH_STATUS } = require("../models/TripCoach");
const { TICKET_STATUS } = require("../models/Ticket");
const { HOLD_STATUS } = require("../models/SeatHold");
const { PLAN_STATUS } = require("../constants/planStatus");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const audit = require("./auditService");
const settings = require("./settingService");
const money = require("../utils/money");
const { JOB_STATUS } = require("../models/Job");

/*
 * Lazily required: trips build coaches, and cancelling a coach queues a refund
 * job whose handler reaches back through refunds to trips — requiring these at
 * load time would close a cycle.
 */
const trips = () => require("./tripService");
const waitlist = () => require("./waitlistService");
const jobs = () => require("./jobService");

/**
 * Changing the coaches on a departure after it exists (§14.1).
 *
 * ## Four operations, sized by what they can break
 *
 * | Operation | Who | Why that bar |
 * |---|---|---|
 * | Add a coach | `trip:manage` | Creates seats. Harms nobody. |
 * | Remove a coach nobody has touched | `trip:manage` | Deletes seats no ticket, hold or record refers to. Harms nobody. |
 * | Remove a coach with tickets on it | **Refused** | Deleting the seats would delete the thing those passengers bought. There is no normal-path version of this. |
 * | Cancel a coach | `trip:cancel` | Refunds everyone on it and tells them. Moves money for a carriage-load of people. |
 *
 * The refusal on the third line is not a permission check — nobody can do it,
 * because it would be wrong for anybody. The fourth line is the correct way to
 * take a sold coach out of service, and it is gated higher because it is the
 * one that costs the railway money and changes people's journeys.
 *
 * ## Cancelled is not deleted
 *
 * A cancelled coach keeps its row and its seats. Its tickets refer to those
 * seats, its refunds refer to those tickets, and the record of what was sold
 * and returned has to survive the carriage being taken off. Sale already
 * filters on `active`, so a cancelled coach disappears from every search with
 * no further work.
 */

async function tripOr404(tripId) {
  const trip = await Trip.findByPk(tripId);
  if (!trip) throw ApiError.notFound("Departure not found");
  return trip;
}

async function coachOr404(tripId, coachId) {
  const coach = await TripCoach.findOne({
    where: { id: Number(coachId), tripId: Number(tripId) },
  });
  if (!coach) throw ApiError.notFound("That coach is not on this departure");
  return coach;
}

/** Nothing about a departure that has gone can usefully change. */
function assertChangeable(trip) {
  if (trip.status === TRIP_STATUS.CANCELLED) {
    throw ApiError.badRequest("This departure is cancelled. Reinstate it before changing its coaches.");
  }
  if ([TRIP_STATUS.DEPARTED, TRIP_STATUS.COMPLETED].includes(trip.status)) {
    throw ApiError.badRequest(`This departure has ${trip.status}; its coaches can no longer change.`);
  }
}

/* ---------------- What is on a coach ---------------- */

/**
 * Everything that refers to a coach's seats.
 *
 * Counted separately rather than as one "is it in use" flag, because each
 * answer needs a different sentence: live passengers are a reason to cancel
 * rather than remove; somebody mid-checkout is a reason to wait a few
 * minutes; returned tickets are history that must not be destroyed.
 *
 * **Every ticket counts, not only the valid ones.** The rebuild guard first
 * counted live tickets, reasoning that a returned ticket is nobody's seat — and
 * a departure where everyone had returned their ticket sailed past it into a
 * raw foreign-key error, because the row still names the seat. Same lesson
 * here, learned once.
 */
async function whatIsOn(coach) {
  const seatIds = (
    await TripSeat.findAll({ where: { tripCoachId: coach.id }, attributes: ["id"], raw: true })
  ).map((s) => s.id);

  const onSeats = seatIds.length ? { tripSeatId: seatIds } : { id: -1 };

  const [live, history, standing, holds, blocks] = await Promise.all([
    Ticket.count({ where: { ...onSeats, status: TICKET_STATUS.VALID } }),
    Ticket.count({ where: { ...onSeats, status: { [Op.ne]: TICKET_STATUS.VALID } } }),
    Ticket.count({ where: { tripCoachId: coach.id, status: TICKET_STATUS.VALID } }),
    seatIds.length
      ? SeatSegmentBooking.count({
          where: { tripSeatId: seatIds, source: "hold" },
          distinct: true,
          col: "hold_id",
        })
      : 0,
    seatIds.length
      ? SeatSegmentBooking.count({ where: { tripSeatId: seatIds, source: "block" } })
      : 0,
  ]);

  return { seatIds, live, history, standing, holds, blocks };
}

/* ---------------- Adding ---------------- */

/**
 * Put another coach on a departure.
 *
 * Built through `tripService.buildCoach` — the same function generation uses —
 * so a coach added on the day sells exactly like one built at generation.
 *
 * Only an approved plan can be added. A draft plan is somebody's work in
 * progress, and selling seats laid out from it would put passengers in a
 * carriage nobody signed off.
 */
async function add(tripId, { seatPlanId, coachCode, position }, { actorId } = {}) {
  const trip = await tripOr404(tripId);
  assertChangeable(trip);

  const plan = await SeatPlan.findByPk(seatPlanId);
  if (!plan) throw ApiError.notFound("No such seat plan");
  if (plan.status !== PLAN_STATUS.APPROVED) {
    throw ApiError.badRequest(
      `That plan is ${plan.status}. Only an approved plan can be put into service.`
    );
  }

  const code = String(coachCode || "").trim().toUpperCase();
  if (!code) throw ApiError.badRequest("Give the coach a code, such as KA or JHA");

  // Checked here rather than left to the unique index, so the answer is a
  // sentence rather than a constraint name.
  const clash = await TripCoach.findOne({ where: { tripId: trip.id, coachCode: code } });
  if (clash) {
    throw ApiError.conflict(
      clash.status === TRIP_COACH_STATUS.CANCELLED
        ? `${code} is on this departure already, cancelled. Reinstate it, or use another code.`
        : `${code} is on this departure already.`
    );
  }

  /*
   * Where it goes in the train.
   *
   * Appended by default. Given a position, the coaches from there onward move
   * back one — a coupling order has no gaps, and two coaches in the same place
   * would print as two carriages both claiming to be third.
   */
  const existing = await TripCoach.findAll({
    where: { tripId: trip.id },
    order: [["position", "ASC"]],
  });
  const last = existing.length ? Math.max(...existing.map((c) => c.position)) : 0;
  const at = Number.isInteger(Number(position)) && Number(position) > 0
    ? Math.min(Number(position), last + 1)
    : last + 1;

  const built = await sequelize.transaction(async (transaction) => {
    // Shift from the back, so no two coaches share a position mid-update.
    const behind = existing.filter((c) => c.position >= at).sort((a, b) => b.position - a.position);
    for (const coach of behind) {
      await coach.update({ position: coach.position + 1 }, { transaction });
    }
    return trips().buildCoach(trip, { coachCode: code, position: at, plan }, transaction);
  });

  if (built.skipped) {
    throw ApiError.badRequest(`That plan could not be built: ${built.skipped.reason}`);
  }

  await audit.record({
    action: AUDIT_ACTIONS.COACH_ADD,
    entity: { type: "trip", id: trip.id, label: `${code} on trip ${trip.id}` },
    after: { coachCode: code, position: at, seats: built.seatCount, seatPlanId: plan.id },
    message: `coach ${code} added at position ${at} with ${built.seatCount} seats`,
  });

  /*
   * New seats are exactly what a queue for a full train is waiting for.
   *
   * Adding a coach to a sold-out departure is the most common reason to add
   * one, and the people who already said they wanted a seat should hear first.
   */
  waitlist().seatsFreed(trip.id, `coach ${code} added`);

  return { coach: built.tripCoach.toPublicJSON(), seats: built.seatCount, position: at };
}

/* ---------------- Removing ---------------- */

/**
 * Take a coach off a departure that nobody has used.
 *
 * Deletes the coach and its seats outright. Allowed only when nothing refers to
 * them — no ticket of any status, no checkout in progress. Anything else is
 * refused with the reason, and a coach carrying passengers is pointed at
 * cancellation, which is the correct operation for that.
 *
 * Operational blocks do not prevent removal: a block is somebody saying "do not
 * sell this seat", and removing the seat altogether satisfies that entirely.
 */
async function remove(tripId, coachId, { actorId } = {}) {
  const trip = await tripOr404(tripId);
  assertChangeable(trip);
  const coach = await coachOr404(tripId, coachId);

  const on = await whatIsOn(coach);

  if (on.live > 0 || on.standing > 0) {
    throw ApiError.conflict(
      `${on.live + on.standing} passenger(s) hold tickets on ${coach.coachCode}. Removing it ` +
        "would delete the seats they bought. Cancel the coach instead — that refunds each of " +
        "them in full and tells them why."
    );
  }
  if (on.holds > 0) {
    throw ApiError.conflict(
      `Someone is part-way through buying a seat on ${coach.coachCode}. Wait for the checkout ` +
        "to finish or lapse — it will not be long — and try again."
    );
  }
  if (on.history > 0) {
    throw ApiError.conflict(
      `Nobody is travelling on ${coach.coachCode}, but ${on.history} returned or transferred ` +
        "ticket(s) still refer to its seats, and removing it would destroy the record of what " +
        "they held. Cancel it instead; a cancelled coach leaves sale and keeps its history."
    );
  }

  await sequelize.transaction(async (transaction) => {
    if (on.seatIds.length) {
      await SeatSegmentBooking.destroy({ where: { tripSeatId: on.seatIds }, transaction });
      await TripSeat.destroy({ where: { tripCoachId: coach.id }, transaction });
    }
    await coach.destroy({ transaction });

    // Close the gap it leaves, so the coupling order stays contiguous.
    const after = await TripCoach.findAll({
      where: { tripId: trip.id, position: { [Op.gt]: coach.position } },
      order: [["position", "ASC"]],
      transaction,
    });
    for (const c of after) {
      await c.update({ position: c.position - 1 }, { transaction });
    }
  });

  await audit.record({
    action: AUDIT_ACTIONS.COACH_REMOVE,
    entity: { type: "trip", id: trip.id, label: `${coach.coachCode} on trip ${trip.id}` },
    before: { coachCode: coach.coachCode, position: coach.position, seats: on.seatIds.length },
    message: `coach ${coach.coachCode} removed (${on.seatIds.length} unused seats)`,
  });

  return { removed: coach.coachCode, seats: on.seatIds.length };
}

/* ---------------- Cancelling ---------------- */

/**
 * Take a coach out of service and make every passenger on it whole.
 *
 * Refunds in full through the same disruption path a cancelled train uses —
 * nothing deducted, because the railway changed the plan, not the passenger —
 * and each passenger is emailed why. Checkouts in progress on the coach are
 * released so nobody finishes paying for a seat that is not running.
 *
 * The coach is marked cancelled, not deleted: its tickets and refunds refer to
 * its seats, and that record has to outlive the carriage.
 *
 * Like a departure's, the refunds run as a durable job queued in the same
 * transaction that marks the coach cancelled (Phase 8B), and the request waits
 * briefly for it so an ordinary cancellation still reports what it refunded.
 */
async function cancel(tripId, coachId, { reason, actorId, actorLabel } = {}) {
  const trip = await tripOr404(tripId);
  if ([TRIP_STATUS.DEPARTED, TRIP_STATUS.COMPLETED].includes(trip.status)) {
    throw ApiError.badRequest(`This departure has ${trip.status}; its coaches can no longer change.`);
  }
  const coach = await coachOr404(tripId, coachId);

  if (coach.status === TRIP_COACH_STATUS.CANCELLED) {
    throw ApiError.conflict(`${coach.coachCode} is already cancelled.`);
  }

  const words = String(reason || "").trim();
  if (words.length < 5) {
    // Every passenger on the coach is emailed this. "cancelled" is not a reason.
    throw ApiError.badRequest("Say why — every passenger on this coach will be told.");
  }

  // Out of sale, and the refunds owed written down, in one step — so the coach
  // is never cancelled without its passengers' refunds queued.
  let job;
  await sequelize.transaction(async (transaction) => {
    await coach.update(
      {
        status: TRIP_COACH_STATUS.CANCELLED,
        cancellationReason: words,
        cancelledAt: new Date(),
        cancelledById: actorId || null,
      },
      { transaction }
    );
    const afterRefundId = await require("./refundService").lastRefundId({ transaction });
    job = await jobs().enqueue(
      "refund.coach_cancellation",
      {
        tripId: trip.id,
        tripCoachId: coach.id,
        reason: `Coach ${coach.coachCode} withdrawn: ${words}`,
        actorLabel: actorLabel || "an operator",
        afterRefundId,
      },
      {
        transaction,
        dedupeKey: `coach-cancel:${trip.id}:${coach.id}`,
        createdById: actorId || null,
        label: `Refund everyone on coach ${coach.coachCode} of ${trip.train?.name || `trip ${trip.id}`}`,
      }
    );
  });

  // Anyone mid-checkout on this coach loses the seats now rather than paying
  // for them and being refunded a minute later.
  const on = await whatIsOn(coach);
  let released = 0;
  if (on.seatIds.length) {
    const holdIds = (
      await SeatSegmentBooking.findAll({
        where: { tripSeatId: on.seatIds, source: "hold" },
        attributes: ["holdId"],
        group: ["hold_id"],
        raw: true,
      })
    ).map((r) => r.holdId).filter(Boolean);

    if (holdIds.length) {
      const holds = await SeatHold.findAll({
        where: { id: holdIds, status: HOLD_STATUS.ACTIVE },
      });
      const holdService = require("./holdService");
      for (const hold of holds) {
        await holdService.release(hold.reference).catch(() => {});
        released += 1;
      }
    }
  }

  await audit.record({
    action: AUDIT_ACTIONS.COACH_CANCEL,
    entity: { type: "trip", id: trip.id, label: `${coach.coachCode} on trip ${trip.id}` },
    after: {
      coachCode: coach.coachCode,
      reason: words,
      refundJob: job.id,
      checkoutsReleased: released,
    },
    message: `coach ${coach.coachCode} cancelled — refunds queued as job #${job.id}: ${words}`,
  });

  // The same refund path a cancelled train uses, scoped to this coach, run by
  // the job. Wait a little for it, so the usual case still answers in full.
  const settled = await jobs().waitFor(job.id, settings.get("jobs.inline_wait_seconds") * 1000);
  const result = settled?.status === JOB_STATUS.SUCCEEDED ? settled.result : null;

  return {
    coach: (await coach.reload()).toPublicJSON(),
    job: settled ? settled.toPublicJSON() : null,
    // Null while the job is still working through the passengers.
    refunded: result ? result.refunded : null,
    paidMinor: result ? result.paidMinor : null,
    paidFormatted: result ? money.format(result.paidMinor) : null,
    checkoutsReleased: released,
  };
}

/**
 * Put a cancelled coach back into service.
 *
 * Its seats return to sale. Its passengers **stay refunded** — they have their
 * money, may well have booked something else, and quietly re-issuing their
 * tickets would charge nobody and seat people who are not coming. That is the
 * lesson from departure reinstatement, which had the same shape.
 */
async function reinstate(tripId, coachId, { reason, actorId } = {}) {
  const trip = await tripOr404(tripId);
  assertChangeable(trip);
  const coach = await coachOr404(tripId, coachId);

  if (coach.status !== TRIP_COACH_STATUS.CANCELLED) {
    throw ApiError.badRequest(`${coach.coachCode} is not cancelled.`);
  }

  // Not while its passengers are still being refunded — see refundsInFlight.
  const inFlight = await jobs().liveFor({ dedupeKey: `coach-cancel:${trip.id}:${coach.id}` });
  if (inFlight) throw require("./tripService").refusalWhileRefunding(inFlight, `coach ${coach.coachCode}`);

  const before = { reason: coach.cancellationReason, cancelledAt: coach.cancelledAt };

  await coach.update({
    status: TRIP_COACH_STATUS.ACTIVE,
    cancellationReason: null,
    cancelledAt: null,
    cancelledById: null,
  });

  await audit.record({
    action: AUDIT_ACTIONS.COACH_REINSTATE,
    entity: { type: "trip", id: trip.id, label: `${coach.coachCode} on trip ${trip.id}` },
    before,
    after: { reason: reason || null },
    message: `coach ${coach.coachCode} back in service${reason ? ` — ${reason}` : ""}`,
  });

  // Seats back on sale are what a queue is for.
  waitlist().seatsFreed(trip.id, `coach ${coach.coachCode} reinstated`);

  return {
    coach: (await coach.reload()).toPublicJSON(),
    note: "Its seats are on sale again. Passengers refunded when it was cancelled stay refunded.",
  };
}

/* ---------------- Reading ---------------- */

/** The coaches on a departure, with what each is carrying. */
async function list(tripId) {
  const trip = await tripOr404(tripId);
  const coaches = await TripCoach.findAll({
    where: { tripId: trip.id },
    include: [{ model: SeatPlan, as: "seatPlan", attributes: ["id", "coachNo"] }],
    order: [["position", "ASC"]],
  });

  const rows = [];
  for (const coach of coaches) {
    const on = await whatIsOn(coach);
    rows.push({
      ...coach.toPublicJSON(),
      planCoachNo: coach.seatPlan?.coachNo || null,
      passengers: on.live + on.standing,
      history: on.history,
      checkoutsInProgress: on.holds,
      blocks: on.blocks,
      // What an operator may do with it, decided here so the screen shows the
      // right buttons rather than working it out and getting it wrong.
      canRemove: on.live + on.standing + on.holds + on.history === 0,
      canCancel: coach.status === TRIP_COACH_STATUS.ACTIVE,
      canReinstate: coach.status === TRIP_COACH_STATUS.CANCELLED,
    });
  }

  return { tripId: trip.id, status: trip.status, coaches: rows };
}

module.exports = { list, add, remove, cancel, reinstate };
