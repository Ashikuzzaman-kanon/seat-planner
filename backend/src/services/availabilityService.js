const {
  TripSeat,
  TripCoach,
  TripSeatQuota,
  SeatPlan,
  CoachClass,
  Station,
  SeatSegmentBooking,
  Ticket,
  Booking,
  SeatHold,
} = require("../models");
const { SEGMENT_SOURCE } = require("../models/SeatSegmentBooking");
const { TRIP_STATUS } = require("../models/Trip");
const { TRIP_COACH_STATUS } = require("../models/TripCoach");
const ApiError = require("../utils/ApiError");
const { computeAvailability, summarise, quotaPermits } = require("../utils/availability");
const inventory = require("./inventoryService");

/**
 * Reading the inventory.
 *
 * Every answer is computed in memory from three cheap indexed reads — the
 * departure's seats, its occupied segments, and its quota rows. The alternative
 * is a query per seat, and a departure carries hundreds of seats across
 * dozens of station pairs.
 */

const SEAT_ATTRIBUTES = [
  "id", "tripCoachId", "coachClassId", "seatNumber", "rowIndex", "cellIndex",
  "isWindow", "windowType", "chargingPort", "fan", "note", "attributes",
];

/** Seats on a departure, excluding any coach that has been taken off. */
async function sellableSeats(tripId, coachClassId) {
  const where = { tripId: Number(tripId) };
  if (coachClassId) where.coachClassId = Number(coachClassId);

  return TripSeat.findAll({
    where,
    attributes: SEAT_ATTRIBUTES,
    include: [
      {
        model: TripCoach,
        as: "coach",
        attributes: ["id", "coachCode", "position", "status"],
        where: { status: TRIP_COACH_STATUS.ACTIVE },
        required: true,
      },
    ],
    order: [
      [{ model: TripCoach, as: "coach" }, "position", "ASC"],
      ["rowIndex", "ASC"],
      ["cellIndex", "ASC"],
    ],
  });
}

/**
 * A coach as it is actually laid out, with what is free marked on it.
 *
 * ## Why the plan and not a list of free seats
 *
 * A passenger choosing a seat by hand is asking a spatial question: which end
 * of the coach, which side of the aisle, next to whom. A list of the seats that
 * happen to be free cannot answer it — the free ones drawn shoulder to shoulder
 * look like a full coach, and "4C" means nothing without the shape around it.
 * The seat plan already holds that shape (rows, aisles, blanks, which end is
 * the front), drawn by the planner and approved; this returns it.
 *
 * ## What a passenger is and is not told
 *
 * Every seat is shown, taken ones included — that is what makes it look like a
 * coach. But a taken seat says only `available: false`. Why it is unavailable —
 * sold, held by someone mid-checkout, reserved under a quota, blocked for
 * maintenance — is operational detail, and the seat-map screen behind
 * `inventory:view` is where it belongs. That split already exists for
 * occupancy; this keeps it.
 */
async function coachLayouts(tripId, { coachClassId, availableIds } = {}) {
  const where = { tripId: Number(tripId), status: TRIP_COACH_STATUS.ACTIVE };
  if (coachClassId) where.coachClassId = Number(coachClassId);

  const coaches = await TripCoach.findAll({
    where,
    include: [{ model: SeatPlan, as: "seatPlan", attributes: ["id", "coachNo", "layout"] }],
    order: [["position", "ASC"]],
  });
  if (!coaches.length) return [];

  const seats = await TripSeat.findAll({
    where: { tripCoachId: coaches.map((c) => c.id) },
    attributes: SEAT_ATTRIBUTES,
  });

  // Keyed by where the seat sits, which is how a plan cell finds its seat.
  const seatAt = new Map(
    seats.map((seat) => [`${seat.tripCoachId}:${seat.rowIndex}:${seat.cellIndex}`, seat])
  );
  const free = availableIds instanceof Set ? availableIds : new Set(availableIds || []);

  return coaches.map((coach) => {
    const layout = coach.seatPlan?.layout || {};
    const rows = Array.isArray(layout.rows) ? layout.rows : [];

    return {
      tripCoachId: coach.id,
      coachCode: coach.coachCode,
      coachClassId: coach.coachClassId,
      position: coach.position,
      // The plan this coach was built from, for tracing a layout back to it.
      planCoachNo: coach.seatPlan?.coachNo || null,
      columns: layout.columns || Math.max(1, ...rows.map((r) => (r.cells || []).length)),
      /*
       * Which way the coach faces, and where the split is. A passenger who
       * cares about facing forwards cannot work that out from seat numbers, and
       * the planner already recorded it.
       */
      direction: layout.direction || null,
      rows: rows.map((row, rowIndex) => ({
        cells: (row.cells || []).map((cell, cellIndex) => {
          if (cell.kind !== "seat") {
            // Aisles and gaps are what make the drawing read as a coach.
            return { kind: cell.kind || "blank" };
          }

          const seat = seatAt.get(`${coach.id}:${rowIndex}:${cellIndex}`);
          return {
            kind: "seat",
            tripSeatId: seat?.id ?? null,
            // The seat row is authoritative; the plan's number is the fallback
            // for a cell that somehow never became a seat.
            seatNumber: seat?.seatNumber ?? cell.number ?? null,
            isWindow: Boolean(cell.isWindow),
            chargingPort: Boolean(cell.chargingPort),
            fan: Boolean(cell.fan),
            note: cell.note || null,
            // No reason given. See the note above.
            available: Boolean(seat && free.has(seat.id)),
          };
        }),
      })),
    };
  });
}

async function quotaFor(tripId) {
  const rows = await TripSeatQuota.findAll({ where: { tripId: Number(tripId) } });
  return new Map(rows.map((r) => [r.tripSeatId, r]));
}

/**
 * Which seats can be sold for one journey, and why the rest cannot.
 */
async function forJourney({ tripId, fromStationId, toStationId, coachClassId, filters }) {
  const index = await inventory.routeIndex(tripId);

  if (index.trip.status === TRIP_STATUS.CANCELLED) {
    throw ApiError.badRequest("This departure is cancelled — nothing can be sold on it");
  }

  const journey = inventory.segmentsForJourney(index, fromStationId, toStationId);

  const [seats, { occupancy, blockedSegments }, quotas] = await Promise.all([
    sellableSeats(tripId, coachClassId),
    inventory.occupancyFor(tripId, { segments: journey.segments }),
    quotaFor(tripId),
  ]);

  const result = computeAvailability({
    seats: seats.map((s) => s.toPublicJSON()),
    occupancy,
    quotas,
    blocked: inventory.blockedForSegments(blockedSegments, journey.segments),
    fromSequence: journey.fromSequence,
    toSequence: journey.toSequence,
    fromStationId,
    toStationId,
    // Lets a reservation be compared as a stretch of route, not two opaque ids.
    sequenceOf: index.sequenceOf,
    filters,
  });

  const byClass = result.available.reduce((acc, seat) => {
    acc[seat.coachClassId] = (acc[seat.coachClassId] || 0) + 1;
    return acc;
  }, {});

  return {
    tripId: Number(tripId),
    departureDate: index.trip.departureDate,
    fromStationId: Number(fromStationId),
    toStationId: Number(toStationId),
    segments: result.segments,
    totalSeats: seats.length,
    availableCount: result.available.length,
    available: result.available,
    withheld: summarise(result.unavailable),
    availableByClass: byClass,
  };
}

/**
 * Every forward station pair on a departure, with how many seats each has.
 *
 * This is the screen that makes segment inventory obvious: sell the middle of a
 * route and watch both ends stay on sale. Computed from a single pass over the
 * occupancy rather than one query per pair.
 */
async function matrix({ tripId, coachClassId }) {
  const index = await inventory.routeIndex(tripId);

  const [seats, { occupancy, blockedSegments }, quotas, stations, classes] = await Promise.all([
    sellableSeats(tripId, coachClassId),
    inventory.occupancyFor(tripId),
    quotaFor(tripId),
    Station.findAll({ where: { id: index.stops.map((s) => s.stationId) } }),
    CoachClass.findAll(),
  ]);

  const stationById = new Map(stations.map((s) => [s.id, s.toPublicJSON()]));
  const classById = new Map(classes.map((c) => [c.id, c.name]));
  const plainSeats = seats.map((s) => s.toPublicJSON());

  const pairs = [];
  for (let i = 0; i < index.stops.length - 1; i++) {
    for (let j = i + 1; j < index.stops.length; j++) {
      const fromStop = index.stops[i];
      const toStop = index.stops[j];

      const result = computeAvailability({
        seats: plainSeats,
        occupancy,
        quotas,
        blocked: inventory.blockedForSegments(
          blockedSegments,
          Array.from({ length: j - i }, (_, k) => i + k)
        ),
        fromSequence: fromStop.sequence,
        toSequence: toStop.sequence,
        fromStationId: fromStop.stationId,
        toStationId: toStop.stationId,
        sequenceOf: index.sequenceOf,
      });

      pairs.push({
        fromStationId: fromStop.stationId,
        toStationId: toStop.stationId,
        fromStation: stationById.get(fromStop.stationId),
        toStation: stationById.get(toStop.stationId),
        fromSequence: fromStop.sequence,
        toSequence: toStop.sequence,
        segments: result.segments,
        available: result.available.length,
        total: plainSeats.length,
        withheld: summarise(result.unavailable),
      });
    }
  }

  return {
    tripId: Number(tripId),
    departureDate: index.trip.departureDate,
    status: index.trip.status,
    stops: index.stops.map((s) => ({
      sequence: s.sequence,
      stationId: s.stationId,
      station: stationById.get(s.stationId),
    })),
    segmentCount: index.segmentCount,
    totalSeats: plainSeats.length,
    classes: [...new Set(plainSeats.map((s) => s.coachClassId))].map((id) => ({
      id,
      name: classById.get(id) || "Unknown",
    })),
    pairs,
  };
}

/**
 * The occupancy of one seat across the whole route — the per-seat view that
 * shows why a seat is free at one end and sold in the middle.
 */
async function seatTimeline({ tripId, tripSeatId }) {
  const index = await inventory.routeIndex(tripId);
  const seat = await TripSeat.findOne({ where: { id: tripSeatId, tripId } });
  if (!seat) throw ApiError.notFound("That seat is not on this departure");

  const { rows } = await inventory.occupancyFor(tripId);
  const mine = rows.filter((r) => r.tripSeatId === Number(tripSeatId));
  const bySegment = new Map(mine.map((r) => [r.segmentIndex, r.source]));

  const quota = await TripSeatQuota.findOne({ where: { tripSeatId } });

  return {
    seat: seat.toPublicJSON(),
    quota: quota ? quota.toPublicJSON() : null,
    segments: Array.from({ length: index.segmentCount }, (_, i) => ({
      index: i,
      fromStationId: index.stops[i].stationId,
      toStationId: index.stops[i + 1].stationId,
      occupiedBy: bySegment.get(i) || null,
    })),
  };
}

/**
 * Every seat on a departure, free or not, and what is holding the taken ones.
 *
 * The availability view answers "what can I sell"; this answers "what is going
 * on". They are different jobs. An operator looking at a stretch that will not
 * sell needs to know *why* — and for segment-sold seats the reason is rarely
 * "this seat is sold". It is "this seat is sold Tangail to Santahar", which
 * overlaps the stretch being asked about and would not overlap a slightly
 * different one.
 *
 * So each taken seat carries the journeys actually occupying it, with their own
 * origins and destinations, rather than a flat "unavailable".
 *
 * Passenger identity is a separate question from seat occupancy, and is only
 * included when the caller holds the permission to see bookings. A seat-map
 * operator needs to know a seat is sold; they do not need the passenger's name
 * to do their job.
 */
async function occupancy({ tripId, fromStationId, toStationId, coachClassId, includePassenger = false }) {
  const index = await inventory.routeIndex(tripId);

  // A pair is optional: without one this is the whole departure, which is what
  // a seat map wants.
  const journey =
    fromStationId && toStationId
      ? inventory.segmentsForJourney(index, fromStationId, toStationId)
      : { segments: Array.from({ length: index.segmentCount }, (_, i) => i), fromSequence: null, toSequence: null };

  const [seats, { occupancy: occupied, blockedSegments }, quotas, coaches] = await Promise.all([
    sellableSeats(tripId, coachClassId),
    inventory.occupancyFor(tripId, { segments: journey.segments }),
    quotaFor(tripId),
    TripCoach.findAll({ where: { tripId }, attributes: ["id", "coachCode", "position"], raw: true }),
  ]);

  const codeOf = new Map(coaches.map((c) => [c.id, c.coachCode]));

  // Every reservation row touching this departure, so a taken seat can name the
  // journey that took it rather than merely reporting itself as taken.
  const rows = await SeatSegmentBooking.findAll({
    where: { tripId: Number(tripId) },
    order: [["tripSeatId", "ASC"], ["segmentIndex", "ASC"]],
  });

  const ticketIds = [...new Set(rows.map((r) => r.ticketId).filter(Boolean))];
  const tickets = ticketIds.length
    ? await Ticket.findAll({
        where: { id: ticketIds },
        include: [
          {
            model: Booking,
            as: "booking",
            include: [
              { model: Station, as: "fromStation" },
              { model: Station, as: "toStation" },
            ],
          },
        ],
      })
    : [];
  const ticketById = new Map(tickets.map((t) => [t.id, t]));

  const holdIds = [...new Set(rows.map((r) => r.holdId).filter(Boolean))];
  const holds = holdIds.length ? await SeatHold.findAll({ where: { id: holdIds } }) : [];
  const holdById = new Map(holds.map((h) => [h.id, h]));

  const rowsBySeat = rows.reduce((acc, row) => {
    (acc[row.tripSeatId] = acc[row.tripSeatId] || []).push(row);
    return acc;
  }, {});

  const stationName = (id) => index.stops.find((s) => s.stationId === id)?.station?.name || null;

  const result = seats.map((row) => {
    const seat = row.toPublicJSON();
    const mine = rowsBySeat[seat.id] || [];

    // What occupies this seat, grouped by the thing that took it rather than by
    // segment — one ticket over three segments is one fact, not three.
    const occupants = [];
    const seen = new Set();

    for (const segment of mine) {
      const key = segment.ticketId
        ? `t${segment.ticketId}`
        : segment.holdId
          ? `h${segment.holdId}`
          : `b${segment.segmentIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const segments = mine
        .filter((r) =>
          segment.ticketId
            ? r.ticketId === segment.ticketId
            : segment.holdId
              ? r.holdId === segment.holdId
              : r.source === SEGMENT_SOURCE.BLOCK && r.segmentIndex === segment.segmentIndex
        )
        .map((r) => r.segmentIndex);

      const ticket = segment.ticketId ? ticketById.get(segment.ticketId) : null;
      const hold = segment.holdId ? holdById.get(segment.holdId) : null;

      occupants.push({
        source: segment.source,
        segments,
        // The stretch this occupant actually holds, which is the thing an
        // operator is trying to see.
        fromStationId: ticket?.booking?.fromStationId ?? hold?.fromStationId ?? null,
        toStationId: ticket?.booking?.toStationId ?? hold?.toStationId ?? null,
        fromStation: ticket?.booking?.fromStation?.name ?? stationName(hold?.fromStationId) ?? null,
        toStation: ticket?.booking?.toStation?.name ?? stationName(hold?.toStationId) ?? null,
        reason: segment.reason || null,

        ticketNumber: ticket?.ticketNumber || null,
        ticketStatus: ticket?.status || null,
        bookingId: ticket?.bookingId || null,
        bookingReference: ticket?.booking?.reference || null,
        boardingDate: ticket?.booking?.boardingDate || null,
        soldAt: ticket?.createdAt || null,

        holdReference: hold?.reference || null,
        holdExpiresAt: hold?.expiresAt || null,

        // Only for callers who may see bookings. Occupancy is not identity.
        ...(includePassenger && ticket
          ? { passengerName: ticket.passengerName, passengerNid: ticket.passengerNid }
          : {}),
      });
    }

    const overlapping = occupants.filter((o) =>
      o.segments.some((i) => journey.segments.includes(i))
    );

    const quota = quotas.get(seat.id);
    const blocked = inventory.blockedForSegments(blockedSegments, journey.segments).has(seat.id);

    let state = "available";
    if (overlapping.some((o) => o.source === SEGMENT_SOURCE.TICKET)) state = "sold";
    else if (overlapping.some((o) => o.source === SEGMENT_SOURCE.HOLD)) state = "held";
    else if (blocked || overlapping.some((o) => o.source === SEGMENT_SOURCE.BLOCK)) state = "blocked";
    else if (
      quota &&
      !quotaPermits(quota, {
        fromStationId,
        toStationId,
        fromSequence: journey.fromSequence,
        toSequence: journey.toSequence,
        sequenceOf: index.sequenceOf,
      })
    ) {
      state = "reserved";
    }

    return {
      ...seat,
      coachCode: codeOf.get(seat.tripCoachId) || null,
      state,
      /** What takes this seat over the stretch asked about. */
      occupiedBy: overlapping,
      /** Everything on the seat, anywhere on the route — the fuller picture. */
      allOccupants: occupants,
      quota: quota ? quota.toPublicJSON() : null,
    };
  });

  const count = (state) => result.filter((s) => s.state === state).length;

  return {
    tripId: Number(tripId),
    departureDate: index.trip.departureDate,
    fromStationId: fromStationId ? Number(fromStationId) : null,
    toStationId: toStationId ? Number(toStationId) : null,
    segments: journey.segments,
    totalSeats: result.length,
    availableCount: count("available"),
    soldCount: count("sold"),
    heldCount: count("held"),
    blockedCount: count("blocked"),
    reservedCount: count("reserved"),
    seats: result,
  };
}

module.exports = {
  forJourney,
  matrix,
  seatTimeline,
  sellableSeats,
  occupancy,
  coachLayouts,
};
