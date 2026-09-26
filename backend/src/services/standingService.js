const { Op } = require("sequelize");
const {
  sequelize,
  Ticket,
  Booking,
  Trip,
  TrainName,
  TripCoach,
  TripSeat,
  CoachClass,
  Station,
  RouteStop,
  User,
} = require("../models");
const { TICKET_STATUS, TICKET_KIND } = require("../models/Ticket");
const { BOOKING_STATUS } = require("../models/Booking");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const money = require("../utils/money");
const { bookingReference, ticketNumber, unique } = require("../utils/reference");
const { addDays } = require("../utils/dhakaTime");
const standing = require("../utils/standing");
const inventory = require("./inventoryService");
const fareService = require("./fareService");
const paymentService = require("./paymentService");
const settings = require("./settingService");
const audit = require("./auditService");

/**
 * Connecting standing tickets (§10).
 *
 * Someone who could only secure a seat for part of their journey can travel the
 * whole way rather than abandoning the booking or riding unticketed. The leg
 * must abut their seated one, on the same train, and it costs a share of what a
 * seat over the same stretch would.
 *
 * ## Why this locks a coach rather than relying on a constraint
 *
 * Seat inventory is protected by a unique index: one ticket per seat-segment,
 * and the database refuses the second. That works because a seat is exclusive.
 *
 * Standing is a quantity — twenty people may stand in a coach — so there is
 * nothing for a unique index to be unique about. Two buyers could each count
 * nineteen and each insert the twentieth. So a standing purchase takes a row
 * lock on the coach it is selling into, counts, and inserts inside that lock.
 * Contention is per coach and standing is a minority of sales, so the cost is
 * small and the alternative is overselling.
 */

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

async function seatedTicketOr404(ticketId, { userId, canViewAll = false }) {
  const ticket = await Ticket.findByPk(ticketId, {
    include: [
      {
        model: Booking,
        as: "booking",
        include: [{ model: Trip, as: "trip", include: [{ model: TrainName, as: "train" }] }],
      },
    ],
  });

  if (!ticket) throw ApiError.notFound("Ticket not found");
  if (!canViewAll && userId && ticket.booking.userId !== userId) {
    throw ApiError.notFound("Ticket not found");
  }
  if (ticket.kind !== TICKET_KIND.SEATED) {
    throw ApiError.badRequest("Standing is bought against a seated ticket, not another standing one.");
  }
  return ticket;
}

/** How many already stand in this coach, per segment. */
async function occupancyFor(tripCoachId, { transaction } = {}) {
  const rows = await Ticket.findAll({
    where: {
      tripCoachId: Number(tripCoachId),
      kind: TICKET_KIND.STANDING,
      status: TICKET_STATUS.VALID,
    },
    attributes: ["segments"],
    transaction,
    raw: true,
  });

  const perSegment = new Map();
  for (const row of rows) {
    for (const segment of row.segments || []) {
      perSegment.set(segment, (perSegment.get(segment) || 0) + 1);
    }
  }
  return perSegment;
}

/**
 * What a passenger could buy alongside this seated ticket.
 *
 * Both directions are offered — before the seat and after it — because a
 * passenger who could only get a seat in the middle of their journey needs
 * both, and offering one at a time hides half the answer.
 */
async function options({ ticketId, userId, canViewAll = false }) {
  const ticket = await seatedTicketOr404(ticketId, { userId, canViewAll });
  const trip = ticket.booking.trip;

  const index = await inventory.routeIndex(trip.id);
  const seatFrom = index.sequenceOf.get(ticket.fromStationId ?? ticket.booking.fromStationId);
  const seatTo = index.sequenceOf.get(ticket.toStationId ?? ticket.booking.toStationId);

  const coach = await TripCoach.findByPk(ticket.tripCoachId ?? (await coachOfSeat(ticket)), {
    include: [{ model: CoachClass, as: "coachClass" }],
  });

  /*
   * Two switches, and the stricter wins. The class says how many may stand in a
   * coach of its kind; the departure says whether standing happens on this
   * service at all. Turning it off here cannot be worked around by a class
   * setting, which is the point of having it.
   */
  const classCapacity = coach?.coachClass?.standingCapacity ?? 0;
  const capacity = trip.standingEnabled === false ? 0 : classCapacity;

  const percent = settings.get("standing.fare_percent");
  const occupancy = await occupancyFor(coach?.id);

  const existing = await Ticket.findAll({
    where: { seatedTicketId: ticket.id, status: TICKET_STATUS.VALID },
  });

  const legs = [];

  // Everywhere they could join from, arriving at their seat's origin.
  for (const stop of index.stops) {
    if (stop.sequence >= seatFrom) continue;
    legs.push(buildLeg({ index, from: stop.sequence, to: seatFrom, position: "before" }));
  }

  // And everywhere they could continue to, leaving from its destination.
  for (const stop of index.stops) {
    if (stop.sequence <= seatTo) continue;
    legs.push(buildLeg({ index, from: seatTo, to: stop.sequence, position: "after" }));
  }

  const priced = [];
  for (const leg of legs) {
    const room = standing.roomFor({ capacity, occupancy, segments: leg.segments });

    // What a seat over this same stretch would cost, which is what standing is
    // a share of.
    let seatedFareMinor = null;
    try {
      const fare = await fareService.resolveFare({
        trainId: trip.trainId,
        coachClassId: ticket.coachClassId,
        fromStationId: leg.fromStationId,
        toStationId: leg.toStationId,
      });
      seatedFareMinor = money.toMinor(fare.amount);
    } catch {
      // No fare rule covers this stretch, so it cannot be sold at any price.
    }

    const alreadyHeld = existing.some(
      (t) => t.fromStationId === leg.fromStationId && t.toStationId === leg.toStationId
    );

    const fareMinor =
      seatedFareMinor === null ? null : standing.fareFor({ seatedFareMinor, percent });

    priced.push({
      ...leg,
      available: room.ok && seatedFareMinor !== null && !alreadyHeld,
      reason: alreadyHeld
        ? "already_held"
        : seatedFareMinor === null
          ? standing.REFUSAL.OFF_ROUTE
          : room.ok
            ? null
            : room.reason,
      message: alreadyHeld
        ? "You already have a standing ticket for this stretch."
        : seatedFareMinor === null
          ? "No fare is published for that stretch."
          : room.message || null,
      remaining: room.remaining ?? 0,
      fareMinor,
      fareFormatted: fareMinor === null ? null : money.format(fareMinor),
      seatedFareMinor,
    });
  }

  return {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    passengerName: ticket.passengerName,
    seat: {
      seatNumber: ticket.seatNumber,
      coachCode: ticket.coachCode,
      fromStationId: ticket.fromStationId ?? ticket.booking.fromStationId,
      toStationId: ticket.toStationId ?? ticket.booking.toStationId,
      fromStation: index.stops.find((s) => s.sequence === seatFrom)?.station?.name,
      toStation: index.stops.find((s) => s.sequence === seatTo)?.station?.name,
    },
    coachCapacity: capacity,
    classCapacity,
    standingEnabledOnDeparture: trip.standingEnabled !== false,
    sellsStanding: capacity > 0,
    // Said separately, because "this class never sells standing" and "standing
    // is switched off on this train today" are different situations and lead a
    // passenger to different next steps.
    unavailableReason:
      classCapacity === 0
        ? "Standing is not sold in this class of coach."
        : trip.standingEnabled === false
          ? "Standing is not being sold on this departure."
          : null,
    farePercent: percent,
    held: existing.map((t) => t.toPublicJSON()),
    legs: priced,
  };
}

function buildLeg({ index, from, to, position }) {
  const fromStop = index.stops.find((s) => s.sequence === from);
  const toStop = index.stops.find((s) => s.sequence === to);

  return {
    position,
    fromStationId: fromStop.stationId,
    toStationId: toStop.stationId,
    fromStation: fromStop.station?.name,
    toStation: toStop.station?.name,
    fromSequence: from,
    toSequence: to,
    segments: standing.segmentsFor(from, to),
  };
}

/** A seated ticket sold before `tripCoachId` existed still knows its seat. */
async function coachOfSeat(ticket) {
  if (!ticket.tripSeatId) return null;
  const seat = await TripSeat.findByPk(ticket.tripSeatId, { attributes: ["tripCoachId"] });
  return seat?.tripCoachId ?? null;
}

/* ------------------------------------------------------------------ *
 * Buying
 * ------------------------------------------------------------------ */

/**
 * Add a standing leg to an existing seated ticket.
 *
 * Its own booking, because a booking carries one journey and this leg is a
 * different one from the seat's. That also means payment, refunds and the PDF
 * all work on it with no special cases.
 */
async function purchase({ ticketId, fromStationId, toStationId, userId, method = "wallet", gatewayToken }) {
  const ticket = await seatedTicketOr404(ticketId, { userId });

  if (ticket.status !== TICKET_STATUS.VALID) {
    throw ApiError.badRequest(`That ticket is ${ticket.status}, so nothing can be added to it.`);
  }

  const trip = ticket.booking.trip;
  const index = await inventory.routeIndex(trip.id);

  const seatFrom = index.sequenceOf.get(ticket.fromStationId ?? ticket.booking.fromStationId);
  const seatTo = index.sequenceOf.get(ticket.toStationId ?? ticket.booking.toStationId);
  const standFrom = index.sequenceOf.get(Number(fromStationId));
  const standTo = index.sequenceOf.get(Number(toStationId));

  if (!standFrom || !standTo) {
    throw ApiError.badRequest("One of those stations is not on this train's route.");
  }

  const connects = standing.connection({ seatFrom, seatTo, standFrom, standTo });
  if (!connects.ok) throw ApiError.badRequest(connects.message);

  const tripCoachId = ticket.tripCoachId ?? (await coachOfSeat(ticket));
  if (!tripCoachId) throw ApiError.badRequest("That ticket is not attached to a coach.");

  const segments = standing.segmentsFor(standFrom, standTo);

  // Price it before the lock, so the transaction holds the coach for as little
  // time as possible.
  const fare = await fareService.resolveFare({
    trainId: trip.trainId,
    coachClassId: ticket.coachClassId,
    fromStationId,
    toStationId,
  });
  const fareMinor = standing.fareFor({
    seatedFareMinor: money.toMinor(fare.amount),
    percent: settings.get("standing.fare_percent"),
  });

  const reference = await unique(bookingReference, async (candidate) =>
    Boolean(await Booking.findOne({ where: { reference: candidate } }))
  );
  const number = await unique(ticketNumber, async (candidate) =>
    Boolean(await Ticket.findOne({ where: { ticketNumber: candidate } }))
  );

  const stops = index.stops;
  const offsetOf = (sequence) => stops.find((s) => s.sequence === sequence)?.dayOffset ?? 0;

  const created = await sequelize.transaction(async (transaction) => {
    /*
     * The lock that makes this safe.
     *
     * Standing has no unique constraint to lean on, so the count and the insert
     * must not be separable. Locking the coach row serialises standing sales
     * into that coach and nothing else.
     */
    const coach = await TripCoach.findByPk(tripCoachId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
      include: [{ model: CoachClass, as: "coachClass" }],
    });
    if (!coach) throw ApiError.notFound("That coach is no longer on this departure.");

    // Re-read inside the transaction: the switch may have been thrown while
    // this purchase was being priced.
    const liveTrip = await Trip.findByPk(trip.id, { transaction });
    if (liveTrip.standingEnabled === false) {
      throw ApiError.conflict("Standing is not being sold on this departure.");
    }

    const capacity = coach.coachClass?.standingCapacity ?? 0;
    const occupancy = await occupancyFor(coach.id, { transaction });
    const room = standing.roomFor({ capacity, occupancy, segments });
    if (!room.ok) throw ApiError.conflict(room.message);

    // Re-read the seated ticket under the same transaction: it may have been
    // returned while this was being priced.
    const live = await Ticket.findByPk(ticket.id, { transaction });
    if (live.status !== TICKET_STATUS.VALID) {
      throw ApiError.conflict("That seated ticket was returned a moment ago.");
    }

    const booking = await Booking.create(
      {
        reference,
        userId: ticket.booking.userId,
        tripId: trip.id,
        fromStationId: Number(fromStationId),
        toStationId: Number(toStationId),
        boardingDate: addDays(trip.departureDate, offsetOf(standFrom)),
        arrivalDate: addDays(trip.departureDate, offsetOf(standTo)),
        status: BOOKING_STATUS.CONFIRMED,
        totalMinor: fareMinor,
        ticketCount: 1,
      },
      { transaction }
    );

    const standingTicket = await Ticket.create(
      {
        bookingId: booking.id,
        ticketNumber: number,
        kind: TICKET_KIND.STANDING,
        seatedTicketId: ticket.id,

        tripSeatId: null,
        seatNumber: null,
        tripCoachId: coach.id,
        coachCode: coach.coachCode,
        coachClassId: ticket.coachClassId,

        // The same person as the seat, always. Standing is an extension of one
        // passenger's journey, not a ticket for somebody else.
        passengerName: ticket.passengerName,
        passengerNid: ticket.passengerNid,
        passengerDob: ticket.passengerDob,

        fromStationId: Number(fromStationId),
        toStationId: Number(toStationId),
        segments,

        fareMinor,
        status: TICKET_STATUS.VALID,
      },
      { transaction }
    );

    await paymentService.collect(
      {
        userId: ticket.booking.userId,
        bookingId: booking.id,
        totalMinor: fareMinor,
        method,
        context: { gatewayToken },
      },
      { transaction }
    );

    return { booking, standingTicket, remaining: room.remaining - 1 };
  });

  await audit.record({
    action: AUDIT_ACTIONS.STANDING_PURCHASE,
    entity: { type: "ticket", id: created.standingTicket.id, label: created.standingTicket.ticketNumber },
    after: {
      seatedTicket: ticket.ticketNumber,
      coach: created.standingTicket.coachCode,
      segments,
      fare: money.format(fareMinor),
    },
    message:
      `standing ${connects.position} seat ${ticket.seatNumber}, ` +
      `${money.format(fareMinor)}, ${created.remaining} place(s) left in the coach`,
  });

  return {
    booking: (await Booking.findByPk(created.booking.id, {
      include: [
        { model: Ticket, as: "tickets" },
        { model: Station, as: "fromStation" },
        { model: Station, as: "toStation" },
        { model: Trip, as: "trip", include: [{ model: TrainName, as: "train" }] },
      ],
    })).toPublicJSON(),
    position: connects.position,
    remaining: created.remaining,
  };
}

/* ------------------------------------------------------------------ *
 * Following the seat
 * ------------------------------------------------------------------ */

/**
 * The standing legs riding on a seated ticket.
 *
 * Used by the refund service: a standing ticket cannot be returned on its own
 * while its seat is held (§11.3), and returning the seat releases them with it.
 */
async function legsFor(seatedTicketId, { transaction } = {}) {
  return Ticket.findAll({
    where: {
      seatedTicketId: Number(seatedTicketId),
      kind: TICKET_KIND.STANDING,
      status: TICKET_STATUS.VALID,
    },
    transaction,
  });
}

module.exports = { options, purchase, occupancyFor, legsFor, seatedTicketOr404 };
