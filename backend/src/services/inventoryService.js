const { Op } = require("sequelize");
const {
  sequelize,
  SeatSegmentBooking,
  TripSeat,
  Trip,
  RouteStop,
  Station,
} = require("../models");
const { SEGMENT_SOURCE } = require("../models/SeatSegmentBooking");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { segmentsBetween } = require("../utils/availability");
const audit = require("./auditService");

/**
 * Writing to the inventory.
 *
 * Everything that occupies a seat goes through `reserveSegments`, whether it is
 * a ticket, a checkout hold, or an operational block. One path means one place
 * where the concurrency rule lives, and Phase 5's booking transaction will call
 * exactly this with a ticket id attached.
 */

/** Map stationId -> route stop sequence for a trip, with the stop rows. */
async function routeIndex(tripId) {
  const trip = await Trip.findByPk(tripId);
  if (!trip) throw ApiError.notFound("Departure not found");

  /*
   * Stations come along with the stops.
   *
   * Callers reach for `stop.station.name` — the standing dialog names each leg
   * with it, the seat map names what occupies a seat — and without the include
   * they got `undefined` and printed it. Two features shipped with that hole
   * before it was noticed, which is the argument for loading it here rather
   * than leaving each caller to remember.
   *
   * The cost is one join against a handful of rows, on a table this already
   * reads in full. Next to the seat and occupancy queries in the same request
   * it does not register.
   */
  const stops = await RouteStop.findAll({
    where: { trainId: trip.trainId },
    include: [{ model: Station, as: "station" }],
    order: [["sequence", "ASC"]],
  });
  if (stops.length < 2) {
    throw ApiError.badRequest("This train has no usable route, so nothing can be sold on it");
  }

  return {
    trip,
    stops,
    sequenceOf: new Map(stops.map((s) => [s.stationId, s.sequence])),
    segmentCount: stops.length - 1,
  };
}

/** Resolve a station pair into the segment indices a journey occupies. */
function segmentsForJourney(index, fromStationId, toStationId) {
  const from = index.sequenceOf.get(Number(fromStationId));
  const to = index.sequenceOf.get(Number(toStationId));

  if (!from) throw ApiError.badRequest("The origin is not on this train's route");
  if (!to) throw ApiError.badRequest("The destination is not on this train's route");
  if (to <= from) {
    throw ApiError.badRequest("The destination must come after the origin on the route");
  }

  return { fromSequence: from, toSequence: to, segments: segmentsBetween(from, to) };
}

/**
 * Occupy seats over a stretch of route.
 *
 * Runs in a transaction — the caller's, when one is supplied, so a booking can
 * reserve seats and take payment atomically. A clash surfaces as the unique
 * constraint failing, which is the point: no read-then-write gap for a
 * concurrent purchase to slip through.
 *
 * @param seats [{ tripSeatId, fromStationId, toStationId }]
 */
async function reserveSegments(
  { tripId, seats, source = SEGMENT_SOURCE.TICKET, ticketId = null, holdId = null, reason = null },
  options = {}
) {
  if (!seats?.length) throw ApiError.badRequest("No seats given to reserve");

  const index = await routeIndex(tripId);

  const rows = [];
  for (const request of seats) {
    const { segments } = segmentsForJourney(index, request.fromStationId, request.toStationId);
    for (const segmentIndex of segments) {
      rows.push({
        tripId: Number(tripId),
        tripSeatId: Number(request.tripSeatId),
        segmentIndex,
        source,
        ticketId,
        holdId,
        reason,
      });
    }
  }

  const run = async (transaction) => {
    try {
      return await SeatSegmentBooking.bulkCreate(rows, { transaction });
    } catch (err) {
      if (err.name === "SequelizeUniqueConstraintError") {
        // Someone else took one of these between the availability check and
        // now. That is exactly the race the constraint exists to lose safely.
        throw ApiError.conflict(
          "One of those seats was taken for part of this journey a moment ago. " +
            "Check availability again and pick another."
        );
      }
      throw err;
    }
  };

  const created = options.transaction
    ? await run(options.transaction)
    : await sequelize.transaction(run);

  return { reserved: created.length, seats: seats.length };
}

/** Free everything a ticket or hold was holding. */
async function releaseByReference({ ticketId, holdId }, options = {}) {
  if (!ticketId && !holdId) throw ApiError.badRequest("Nothing given to release");
  const where = ticketId ? { ticketId } : { holdId };
  return SeatSegmentBooking.destroy({ where, transaction: options.transaction });
}

/* ------------------------------------------------------------------ *
 * Operational blocks
 * ------------------------------------------------------------------ */

/**
 * Take a seat out of sale for a stretch of route — maintenance, a defect, an
 * official hold. Modelled as an ordinary occupation so it obeys the same
 * constraint: a seat already sold cannot be blocked out from under a passenger.
 */
async function blockSeat({ tripId, tripSeatId, fromStationId, toStationId, reason }) {
  const seat = await TripSeat.findOne({ where: { id: tripSeatId, tripId } });
  if (!seat) throw ApiError.notFound("That seat is not on this departure");

  const index = await routeIndex(tripId);

  // Default to the whole route, which is what blocking usually means.
  const from = fromStationId || index.stops[0].stationId;
  const to = toStationId || index.stops[index.stops.length - 1].stationId;

  const result = await reserveSegments({
    tripId,
    seats: [{ tripSeatId, fromStationId: from, toStationId: to }],
    source: SEGMENT_SOURCE.BLOCK,
    reason: reason?.trim() || "Blocked",
  });

  await audit.record({
    action: AUDIT_ACTIONS.SEAT_BLOCK,
    entity: { type: "trip_seat", id: tripSeatId, label: `Seat ${seat.seatNumber}` },
    after: { tripId: Number(tripId), segments: result.reserved, reason: reason?.trim() || null },
    message: `seat ${seat.seatNumber} blocked over ${result.reserved} segment(s)`,
  });

  return result;
}

/** Lift a block. Only block rows are removed — a sold seat is never freed here. */
async function unblockSeat({ tripId, tripSeatId }) {
  const seat = await TripSeat.findOne({ where: { id: tripSeatId, tripId } });
  if (!seat) throw ApiError.notFound("That seat is not on this departure");

  const removed = await SeatSegmentBooking.destroy({
    where: { tripSeatId, source: SEGMENT_SOURCE.BLOCK },
  });

  if (!removed) throw ApiError.badRequest("That seat is not blocked");

  await audit.record({
    action: AUDIT_ACTIONS.SEAT_UNBLOCK,
    entity: { type: "trip_seat", id: tripSeatId, label: `Seat ${seat.seatNumber}` },
    after: { tripId: Number(tripId), segmentsFreed: removed },
    message: `seat ${seat.seatNumber} unblocked`,
  });

  return { released: removed };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/**
 * Occupancy for a departure, as Maps the availability rules consume.
 * One indexed query, not one per seat.
 */
async function occupancyFor(tripId, { segments } = {}) {
  const where = { tripId: Number(tripId) };
  if (segments?.length) {
    where.segmentIndex = { [Op.between]: [segments[0], segments[segments.length - 1]] };
  }

  const rows = await SeatSegmentBooking.findAll({
    where,
    attributes: ["tripSeatId", "segmentIndex", "source"],
    raw: true,
  });

  const occupancy = new Map();
  const blockedSegments = new Map();

  for (const row of rows) {
    if (!occupancy.has(row.tripSeatId)) occupancy.set(row.tripSeatId, new Set());
    occupancy.get(row.tripSeatId).add(row.segmentIndex);

    if (row.source === SEGMENT_SOURCE.BLOCK) {
      if (!blockedSegments.has(row.tripSeatId)) blockedSegments.set(row.tripSeatId, new Set());
      blockedSegments.get(row.tripSeatId).add(row.segmentIndex);
    }
  }

  return { occupancy, blockedSegments, rows };
}

/** Seat ids whose blocks intersect the segments asked about. */
function blockedForSegments(blockedSegments, segments) {
  const blocked = new Set();
  for (const [seatId, indices] of blockedSegments) {
    if (segments.some((s) => indices.has(s))) blocked.add(seatId);
  }
  return blocked;
}

module.exports = {
  routeIndex,
  segmentsForJourney,
  reserveSegments,
  releaseByReference,
  blockSeat,
  unblockSeat,
  occupancyFor,
  blockedForSegments,
  SEGMENT_SOURCE,
};
