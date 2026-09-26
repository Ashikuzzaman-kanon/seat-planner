const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const availabilityService = require("../services/availabilityService");
const inventoryService = require("../services/inventoryService");
const quotaService = require("../services/quotaService");
const { PERMISSIONS } = require("../constants/permissions");

/**
 * Seat feature filters arrive as a JSON object so the catalogue stays the only
 * place attributes are defined — a new attribute is filterable the moment it
 * exists, with no parameter to add here.
 */
function parseFilters(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw ApiError.badRequest('filters must be a JSON object, e.g. {"window":true}');
  }
}

/* ---------------- Availability ---------------- */

const availability = asyncHandler(async (req, res) => {
  res.json(
    await availabilityService.forJourney({
      tripId: req.params.id,
      fromStationId: req.query.fromStationId,
      toStationId: req.query.toStationId,
      coachClassId: req.query.coachClassId,
      filters: parseFilters(req.query.filters),
    })
  );
});

const matrix = asyncHandler(async (req, res) => {
  res.json(
    await availabilityService.matrix({
      tripId: req.params.id,
      coachClassId: req.query.coachClassId,
    })
  );
});

const seatTimeline = asyncHandler(async (req, res) => {
  res.json(
    await availabilityService.seatTimeline({
      tripId: req.params.id,
      tripSeatId: req.params.seatId,
    })
  );
});

/* ---------------- Blocks ---------------- */

/**
 * Every seat on a departure and what is holding the taken ones.
 *
 * Passenger identity rides on a separate permission from seat occupancy. An
 * operator working a seat map needs to know a seat is sold and over which
 * stretch; they do not need the passenger's name to do that, and handing it out
 * by default would spread personal data across a screen that does not need it.
 */
const occupancy = asyncHandler(async (req, res) => {
  res.json(
    await availabilityService.occupancy({
      tripId: req.params.id,
      fromStationId: req.query.fromStationId,
      toStationId: req.query.toStationId,
      coachClassId: req.query.coachClassId,
      includePassenger: req.permissions.has(PERMISSIONS.BOOKING_VIEW_ALL),
    })
  );
});

const blockSeat = asyncHandler(async (req, res) => {
  const result = await inventoryService.blockSeat({
    tripId: req.params.id,
    tripSeatId: req.params.seatId,
    fromStationId: req.body.fromStationId,
    toStationId: req.body.toStationId,
    reason: req.body.reason,
  });
  res.json({ message: `Seat blocked over ${result.reserved} segment(s)`, ...result });
});

const unblockSeat = asyncHandler(async (req, res) => {
  const result = await inventoryService.unblockSeat({
    tripId: req.params.id,
    tripSeatId: req.params.seatId,
  });
  res.json({ message: "Seat returned to sale", ...result });
});

/* ---------------- Quota ---------------- */

const listRules = asyncHandler(async (req, res) => {
  res.json({ rules: await quotaService.listRules({ trainId: req.query.trainId }) });
});

const createRule = asyncHandler(async (req, res) => {
  res.status(201).json({ message: "Quota rule created", rule: await quotaService.createRule(req.body) });
});

const updateRule = asyncHandler(async (req, res) => {
  res.json({ message: "Quota rule updated", rule: await quotaService.updateRule(req.params.id, req.body) });
});

const deleteRule = asyncHandler(async (req, res) => {
  await quotaService.deleteRule(req.params.id);
  res.json({ message: "Quota rule deleted" });
});

const materialiseTrain = asyncHandler(async (req, res) => {
  const result = await quotaService.materialiseForTrain(req.params.id, { replace: req.body.replace === true });
  res.json({
    message: `${result.assigned} seats reserved across ${result.trips} departures`,
    ...result,
  });
});

const tripQuota = asyncHandler(async (req, res) => {
  res.json({ quota: await quotaService.forTrip(req.params.id) });
});

/** Hold one named seat for one named station pair. */
const setSeatQuota = asyncHandler(async (req, res) => {
  const result = await quotaService.setSeatQuota({
    tripId: req.params.id,
    tripSeatId: req.params.seatId,
    fromStationId: req.body.fromStationId,
    toStationId: req.body.toStationId,
    releaseHoursBefore: req.body.releaseHoursBefore,
  });
  res.json({ message: `Seat ${result.seatNumber} held for that station pair`, quota: result });
});

const clearSeatQuota = asyncHandler(async (req, res) => {
  const result = await quotaService.clearSeatQuota({
    tripId: req.params.id,
    tripSeatId: req.params.seatId,
  });
  res.json({ message: `Seat ${result.seatNumber} returned to open sale`, ...result });
});

const releaseTripQuota = asyncHandler(async (req, res) => {
  const result = await quotaService.releaseTrip(req.params.id);
  res.json({ message: `${result.released} seats returned to open sale`, ...result });
});

module.exports = {
  occupancy,
  availability,
  matrix,
  seatTimeline,
  blockSeat,
  unblockSeat,
  listRules,
  createRule,
  updateRule,
  deleteRule,
  materialiseTrain,
  tripQuota,
  releaseTripQuota,
  setSeatQuota,
  clearSeatQuota,
};
