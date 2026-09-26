const asyncHandler = require("../utils/asyncHandler");
const stationService = require("../services/stationService");
const trainService = require("../services/trainService");
const fareService = require("../services/fareService");
const seatAttributeService = require("../services/seatAttributeService");

const truthy = (v) => v === "1" || v === "true";

/* ---------------- Stations ---------------- */

const listStations = asyncHandler(async (req, res) => {
  res.json({
    stations: await stationService.list({
      search: req.query.search || "",
      includeInactive: truthy(req.query.includeInactive),
    }),
  });
});

const getStation = asyncHandler(async (req, res) => {
  res.json({ station: await stationService.get(req.params.id) });
});

const createStation = asyncHandler(async (req, res) => {
  res.status(201).json({ message: "Station created", station: await stationService.create(req.body) });
});

const updateStation = asyncHandler(async (req, res) => {
  res.json({ message: "Station updated", station: await stationService.update(req.params.id, req.body) });
});

const deleteStation = asyncHandler(async (req, res) => {
  await stationService.remove(req.params.id);
  res.json({ message: "Station deleted" });
});

/* ---------------- Trains & routes ---------------- */

const listTrains = asyncHandler(async (req, res) => {
  res.json({
    trains: await trainService.list({
      search: req.query.search || "",
      includeInactive: truthy(req.query.includeInactive),
    }),
  });
});

const getTrain = asyncHandler(async (req, res) => {
  res.json({ train: await trainService.get(req.params.id) });
});

const createTrain = asyncHandler(async (req, res) => {
  res.status(201).json({ message: "Train created", train: await trainService.create(req.body) });
});

const updateTrain = asyncHandler(async (req, res) => {
  res.json({ message: "Train updated", train: await trainService.update(req.params.id, req.body) });
});

const setRoute = asyncHandler(async (req, res) => {
  const train = await trainService.setRoute(req.params.id, req.body.stops);
  res.json({
    message: `Route saved — ${train.stops.length} stops, ${train.segments.length} segments`,
    train,
  });
});

const deleteTrain = asyncHandler(async (req, res) => {
  await trainService.remove(req.params.id);
  res.json({ message: "Train deleted" });
});

/* ---------------- Fares ---------------- */

const listFareRules = asyncHandler(async (req, res) => {
  res.json({
    rules: await fareService.listRules({
      trainId: req.query.trainId,
      coachClassId: req.query.coachClassId,
    }),
  });
});

const createFareRule = asyncHandler(async (req, res) => {
  res.status(201).json({ message: "Fare rule created", rule: await fareService.createRule(req.body) });
});

const updateFareRule = asyncHandler(async (req, res) => {
  res.json({ message: "Fare rule updated", rule: await fareService.updateRule(req.params.id, req.body) });
});

const deleteFareRule = asyncHandler(async (req, res) => {
  await fareService.deleteRule(req.params.id);
  res.json({ message: "Fare rule deleted" });
});

const setFareTable = asyncHandler(async (req, res) => {
  res.json({
    message: "Price table saved",
    rule: await fareService.setTableEntries(req.params.id, req.body.entries),
  });
});

const quoteFare = asyncHandler(async (req, res) => {
  res.json({
    fare: await fareService.resolveFare({
      trainId: req.query.trainId,
      coachClassId: req.query.coachClassId,
      fromStationId: req.query.fromStationId,
      toStationId: req.query.toStationId,
    }),
  });
});

const fareMatrix = asyncHandler(async (req, res) => {
  res.json(
    await fareService.fareMatrix({
      trainId: req.query.trainId,
      coachClassId: req.query.coachClassId,
    })
  );
});

/* ---------------- Seat attributes ---------------- */

const listSeatAttributes = asyncHandler(async (req, res) => {
  res.json({
    attributes: await seatAttributeService.list({
      includeInactive: truthy(req.query.includeInactive),
    }),
  });
});

const createSeatAttribute = asyncHandler(async (req, res) => {
  res.status(201).json({
    message: "Seat attribute created",
    attribute: await seatAttributeService.create(req.body),
  });
});

const updateSeatAttribute = asyncHandler(async (req, res) => {
  res.json({
    message: "Seat attribute updated",
    attribute: await seatAttributeService.update(req.params.id, req.body),
  });
});

const deleteSeatAttribute = asyncHandler(async (req, res) => {
  await seatAttributeService.remove(req.params.id);
  res.json({ message: "Seat attribute deleted" });
});

module.exports = {
  listStations, getStation, createStation, updateStation, deleteStation,
  listTrains, getTrain, createTrain, updateTrain, setRoute, deleteTrain,
  listFareRules, createFareRule, updateFareRule, deleteFareRule, setFareTable,
  quoteFare, fareMatrix,
  listSeatAttributes, createSeatAttribute, updateSeatAttribute, deleteSeatAttribute,
};
