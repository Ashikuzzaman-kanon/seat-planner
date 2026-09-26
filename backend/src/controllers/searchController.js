const asyncHandler = require("../utils/asyncHandler");
const searchService = require("../services/searchService");
const availabilityService = require("../services/availabilityService");
const { TripCoach } = require("../models");

/**
 * The passenger-facing read side.
 *
 * Everything here answers "which train, and is there room" — never "how is the
 * operation doing". That separation is why a passenger needs no operational
 * permission to shop.
 */

const listStations = asyncHandler(async (_req, res) => {
  res.json({ stations: await searchService.stations() });
});

const listDepartures = asyncHandler(async (req, res) => {
  res.json(
    await searchService.departures({
      fromStationId: req.query.fromStationId,
      toStationId: req.query.toStationId,
      date: req.query.date,
      coachClassId: req.query.coachClassId,
    })
  );
});

const tripRoute = asyncHandler(async (req, res) => {
  res.json(await searchService.route(req.params.id));
});

const dates = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days || "14", 10), 1), 60);
  res.json({ dates: searchService.upcomingDates(days) });
});

/**
 * The seats themselves, for picking one by hand.
 *
 * The same engine the inventory screen uses, reached with the permission to buy
 * rather than the permission to administer — a passenger choosing a window seat
 * is asking exactly the question availability answers.
 */
const seats = asyncHandler(async (req, res) => {
  let filters = null;
  if (req.query.filters) {
    try {
      filters = JSON.parse(req.query.filters);
    } catch {
      filters = null;
    }
  }

  const result = await availabilityService.forJourney({
    tripId: req.params.id,
    fromStationId: req.query.fromStationId,
    toStationId: req.query.toStationId,
    coachClassId: req.query.coachClassId,
    filters,
  });

  // Coach codes, so the seat map can label a coach "KA" rather than showing an
  // internal id. A seat row knows which coach it belongs to but not what that
  // coach is called.
  const coaches = await TripCoach.findAll({
    where: { tripId: req.params.id },
    attributes: ["id", "coachCode", "position"],
    raw: true,
  });
  const codeOf = new Map(coaches.map((c) => [c.id, c.coachCode]));
  const positionOf = new Map(coaches.map((c) => [c.id, c.position]));

  /*
   * The coaches as they are actually laid out.
   *
   * Choosing a seat by hand is a spatial question — which end, which side of
   * the aisle, is it a window — and a list of the free seats cannot answer it:
   * drawn shoulder to shoulder they look like a full coach, and a seat number
   * means nothing without the shape around it. So the approved seat plan is
   * returned with availability marked on it, aisles and all.
   *
   * Taken seats appear, because that is what makes it read as a coach. They say
   * only `available: false` — why a seat is unavailable is operational detail
   * and belongs to the seat-map screen behind `inventory:view`.
   */
  const coachLayouts = await availabilityService.coachLayouts(req.params.id, {
    coachClassId: req.query.coachClassId,
    availableIds: new Set(result.available.map((seat) => seat.id)),
  });

  // A passenger has no use for why each individual seat is unavailable, only
  // for what is free and how much is left.
  res.json({
    tripId: result.tripId,
    departureDate: result.departureDate,
    fromStationId: result.fromStationId,
    toStationId: result.toStationId,
    totalSeats: result.totalSeats,
    availableCount: result.availableCount,
    availableByClass: result.availableByClass,
    available: result.available.map((seat) => ({
      ...seat,
      coachCode: codeOf.get(seat.tripCoachId) || null,
      coachPosition: positionOf.get(seat.tripCoachId) ?? null,
    })),
    coaches: coachLayouts,
  });
});

/**
 * Where on this train there is still room.
 *
 * The same matrix the inventory screen uses, reached with the permission to buy
 * and stripped of what only an operator needs. It answers the question a
 * passenger on a full train actually has: not "is it full" but "how far *can*
 * I get on it" — a service sold out end to end very often has seats over the
 * stretch someone needs, because a seat is sold per segment.
 *
 * Total seats and per-pair counts stay; quota reasons and blocked-seat detail
 * do not, since a passenger can do nothing with them.
 */
const matrix = asyncHandler(async (req, res) => {
  const result = await availabilityService.matrix({
    tripId: req.params.id,
    coachClassId: req.query.coachClassId,
  });

  const byStation = new Map(result.stops.map((s) => [s.stationId, s.station]));

  res.json({
    tripId: result.tripId,
    departureDate: result.departureDate,
    stops: result.stops,
    totalSeats: result.totalSeats,
    classes: result.classes,
    pairs: result.pairs.map((pair) => ({
      fromStationId: pair.fromStationId,
      toStationId: pair.toStationId,
      fromStation: byStation.get(pair.fromStationId)?.name || pair.fromStation?.name,
      toStation: byStation.get(pair.toStationId)?.name || pair.toStation?.name,
      fromSequence: pair.fromSequence,
      toSequence: pair.toSequence,
      available: pair.available,
      total: pair.total,
    })),
  });
});

module.exports = { listStations, listDepartures, tripRoute, dates, seats, matrix };
