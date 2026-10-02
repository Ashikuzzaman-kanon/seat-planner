const { Op } = require("sequelize");
const {
  sequelize,
  SeatHold,
  SeatSegmentBooking,
  TripSeat,
  TripCoach,
  Trip,
  TrainName,
  Station,
  RouteStop,
} = require("../models");
const { HOLD_STATUS } = require("../models/SeatHold");
const { SEGMENT_SOURCE } = require("../models/SeatSegmentBooking");
const { TRIP_STATUS } = require("../models/Trip");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { holdReference } = require("../utils/reference");
const { instantAt } = require("../utils/dhakaTime");
const inventory = require("./inventoryService");
const settings = require("./settingService");
const audit = require("./auditService");

/*
 * Required lazily, on purpose.
 *
 * The waitlist needs holds (to offer a seat) and holds need the waitlist (to
 * say a seat came back), which is a cycle. Resolving it at call time rather
 * than at load time keeps both modules honest about the direction of the
 * dependency: holds know nothing about queues except that something may want
 * to hear about a freed seat.
 */
const waitlist = () => require("./waitlistService");

/* Lazily required for the same cycle-breaking reason as the waitlist. */
const abuse = () => require("./abuseService");

/**
 * Seats held while someone pays.
 *
 * A hold occupies its segments immediately, through the same path a sale uses —
 * so the moment checkout starts, the seat is gone from availability and the
 * unique constraint is doing the work. There is no window in which two people
 * both believe they have it.
 *
 * The cost of that is abandoned checkouts sitting on inventory, which is what
 * the expiry job below exists to undo.
 */

async function findOr404(reference) {
  const hold = await SeatHold.findOne({ where: { reference } });
  if (!hold) throw ApiError.notFound("That checkout has expired or never existed");
  return hold;
}

/**
 * Take seats out of sale for the checkout window.
 *
 * Fails with a conflict if any seat went in the meantime — which is the right
 * answer, and far better than discovering it after the passenger has paid.
 */
async function create({ tripId, userId, seatIds, fromStationId, toStationId, minutes: window, now = new Date() }) {
  const trip = await Trip.findByPk(tripId);
  if (!trip) throw ApiError.notFound("Departure not found");
  if (trip.status === TRIP_STATUS.CANCELLED) {
    throw ApiError.badRequest("This departure is cancelled");
  }

  /*
   * Sales for a stop close when the train leaves it — the same moment a
   * return measures "departed" from. Before this, today's train stayed on sale
   * until midnight, hours after it had gone.
   */
  const boarding = await RouteStop.findOne({
    where: { trainId: trip.trainId, stationId: fromStationId },
    include: [{ model: Station, as: "station", attributes: ["name"] }],
  });
  if (boarding) {
    const leaves = instantAt(
      trip.departureDate,
      boarding.departureTime || boarding.arrivalTime || "00:00:00",
      boarding.dayOffset || 0
    );
    if (leaves && leaves <= now) {
      throw ApiError.badRequest(
        `This train has already left ${boarding.station?.name || "that station"}. Choose a later departure.`
      );
    }
  }

  /*
   * A held account cannot take seats out of sale.
   *
   * Checked here rather than at login on purpose: the penalty is "cannot buy",
   * not "cannot log in". Somebody on hold keeps their existing tickets, can
   * still read them, download them and travel on them — because those are
   * already paid for, and voiding them would be a second penalty nobody
   * decided on.
   */
  if (await abuse().isHeld(userId)) {
    const open = await abuse().activeHold(userId);
    throw ApiError.forbidden(
      `This account cannot book at the moment. ${open?.detail || ""} ` +
        "Existing tickets are unaffected."
    );
  }

  const ids = [...new Set((seatIds || []).map(Number))].filter(Boolean);
  if (!ids.length) throw ApiError.badRequest("Choose at least one seat");

  const maximum = settings.get("booking.max_tickets_per_booking");
  if (ids.length > maximum) {
    throw ApiError.badRequest(`At most ${maximum} seats can be bought together`);
  }

  const seats = await TripSeat.findAll({ where: { id: ids, tripId: trip.id } });
  if (seats.length !== ids.length) {
    throw ApiError.badRequest("One or more of those seats is not on this departure");
  }

  /*
   * A checkout's ten minutes is the default, not the only answer. A seat
   * offered to the waitlist is held for longer, because the passenger it is
   * being offered to is not sitting at the screen — they are being emailed. The
   * caller says which situation this is; nothing else changes.
   */
  const minutes = Number.isFinite(window) && window > 0
    ? window
    : settings.get("booking.hold_timeout_minutes");
  const expiresAt = new Date(Date.now() + minutes * 60_000);

  return sequelize.transaction(async (transaction) => {
    const hold = await SeatHold.create(
      {
        reference: holdReference(),
        tripId: trip.id,
        userId,
        fromStationId: Number(fromStationId),
        toStationId: Number(toStationId),
        seatIds: ids,
        expiresAt,
      },
      { transaction }
    );

    // Occupying through the shared path means the same unique constraint
    // protects a hold as protects a sale.
    await inventory.reserveSegments(
      {
        tripId: trip.id,
        seats: ids.map((tripSeatId) => ({ tripSeatId, fromStationId, toStationId })),
        source: SEGMENT_SOURCE.HOLD,
        holdId: hold.id,
      },
      { transaction }
    );

    await audit.record({
      action: AUDIT_ACTIONS.HOLD_CREATE,
      entity: { type: "hold", id: hold.id, label: hold.reference },
      after: { seats: ids.length, expiresAt },
      message: `${ids.length} seat(s) held for ${minutes} minutes`,
    });

    return hold;
  });
}

/** Give the seats back, by choice or because checkout was abandoned. */
async function release(reference, { status = HOLD_STATUS.RELEASED, userId } = {}) {
  const hold = await findOr404(reference);

  if (userId && hold.userId !== userId) {
    throw ApiError.forbidden("That checkout belongs to someone else");
  }
  if (hold.status !== HOLD_STATUS.ACTIVE) {
    return { reference, status: hold.status, released: 0 };
  }

  const released = await sequelize.transaction(async (transaction) => {
    const count = await SeatSegmentBooking.destroy({
      where: { holdId: hold.id, source: SEGMENT_SOURCE.HOLD },
      transaction,
    });
    await hold.update({ status }, { transaction });
    return count;
  });

  await audit.record({
    action: AUDIT_ACTIONS.HOLD_RELEASE,
    entity: { type: "hold", id: hold.id, label: hold.reference },
    after: { status, segmentsFreed: released },
    message: `hold ${reference} ${status}`,
  });

  // After the commit, never inside it: a sweep running on this transaction's
  // uncommitted state would see the segments as still occupied and find nothing.
  if (released > 0) waitlist().seatsFreed(hold.tripId, "checkout released");

  return { reference, status, released };
}

/**
 * Return expired holds to sale.
 *
 * Idempotent: the same query that finds due holds skips ones already handled,
 * so running it twice changes nothing.
 */
async function expireDue({ now = new Date() } = {}) {
  const due = await SeatHold.findAll({
    where: { status: HOLD_STATUS.ACTIVE, expiresAt: { [Op.lte]: now } },
    attributes: ["id", "reference", "tripId"],
  });

  if (!due.length) return { expired: 0, seatsFreed: 0 };

  let seatsFreed = 0;
  await sequelize.transaction(async (transaction) => {
    seatsFreed = await SeatSegmentBooking.destroy({
      where: { holdId: due.map((h) => h.id), source: SEGMENT_SOURCE.HOLD },
      transaction,
    });
    await SeatHold.update(
      { status: HOLD_STATUS.EXPIRED },
      { where: { id: due.map((h) => h.id) }, transaction }
    );
  });

  await audit.record({
    action: AUDIT_ACTIONS.HOLD_EXPIRE,
    entity: { type: "hold", id: String(due.length) },
    after: { expired: due.length, seatsFreed },
    message: `${due.length} abandoned checkout(s) returned ${seatsFreed} seat-segments to sale`,
  });

  // One sweep per departure, not per hold: several checkouts lapsing together
  // on the same train is the ordinary case.
  if (seatsFreed > 0) {
    for (const tripId of new Set(due.map((h) => h.tripId))) {
      waitlist().seatsFreed(tripId, "checkout expired");
    }
  }

  return { expired: due.length, seatsFreed };
}

/** The live hold for a checkout, with its seats — what the payment page needs. */
async function get(reference, { userId } = {}) {
  const hold = await findOr404(reference);
  if (userId && hold.userId !== userId) {
    throw ApiError.forbidden("That checkout belongs to someone else");
  }

  const seats = await TripSeat.findAll({ where: { id: hold.seatIds || [] } });
  return { ...hold.toPublicJSON(), seats: seats.map((s) => s.toPublicJSON()) };
}

/**
 * Everything a user currently has on hold.
 *
 * Enriched with the train, the stations and the seat numbers, because the point
 * of this list is to be shown to someone who has lost their checkout — and
 * "you have seats held on trip 79 between station 1 and station 4" tells them
 * nothing they can act on. A resume prompt has to name the train.
 *
 * Seats a passenger is holding are few and the list is short, so the extra
 * reads cost nothing worth optimising.
 */
async function activeFor(userId) {
  const holds = await SeatHold.findAll({
    where: { userId, status: HOLD_STATUS.ACTIVE, expiresAt: { [Op.gt]: new Date() } },
    order: [["id", "DESC"]],
  });

  if (!holds.length) return [];

  const trips = await Trip.findAll({
    where: { id: [...new Set(holds.map((h) => h.tripId))] },
    include: [{ model: TrainName, as: "train" }],
  });
  const tripById = new Map(trips.map((t) => [t.id, t]));

  const stationIds = [
    ...new Set(holds.flatMap((h) => [h.fromStationId, h.toStationId])),
  ];
  const stations = await Station.findAll({ where: { id: stationIds } });
  const stationById = new Map(stations.map((s) => [s.id, s]));

  const seatIds = [...new Set(holds.flatMap((h) => h.seatIds || []))];
  const seats = seatIds.length
    ? await TripSeat.findAll({
        where: { id: seatIds },
        include: [{ model: TripCoach, as: "coach", attributes: ["coachCode"] }],
      })
    : [];
  const seatById = new Map(seats.map((s) => [s.id, s]));

  return holds.map((hold) => {
    const trip = tripById.get(hold.tripId);
    return {
      ...hold.toPublicJSON(),
      train: trip?.train ? { id: trip.train.id, name: trip.train.name } : null,
      departureDate: trip?.departureDate || null,
      fromStation: stationById.get(hold.fromStationId)?.name || null,
      toStation: stationById.get(hold.toStationId)?.name || null,
      seats: (hold.seatIds || [])
        .map((id) => seatById.get(id))
        .filter(Boolean)
        .map((seat) => ({
          id: seat.id,
          seatNumber: seat.seatNumber,
          coachCode: seat.coach?.coachCode || null,
        })),
    };
  });
}

module.exports = { create, release, expireDue, get, activeFor, findOr404, HOLD_STATUS };
