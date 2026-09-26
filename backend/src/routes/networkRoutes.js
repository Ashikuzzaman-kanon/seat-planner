const express = require("express");
const c = require("../controllers/networkController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const r = require("../validators/networkValidators");
const { PERMISSIONS } = require("../constants/permissions");

/**
 * The network: stations, trains and their routes, the fare rule chain, and the
 * seat attribute catalogue.
 *
 * Reading is one permission (`network:view`); each kind of change is its own,
 * so an operator who maintains timetables need not also be able to reprice.
 */
const canView = requirePermission(PERMISSIONS.NETWORK_VIEW);

/* ---------------- Stations ---------------- */
const stations = express.Router();
stations.use(authenticate);
stations.get("/", canView, c.listStations);
stations.get("/:id", canView, r.idParam, validate, c.getStation);
stations.post("/", requirePermission(PERMISSIONS.STATION_MANAGE), r.createStationRules, validate, c.createStation);
stations.patch("/:id", requirePermission(PERMISSIONS.STATION_MANAGE), r.updateStationRules, validate, c.updateStation);
stations.delete("/:id", requirePermission(PERMISSIONS.STATION_MANAGE), r.idParam, validate, c.deleteStation);

/* ---------------- Trains & routes ---------------- */
const trains = express.Router();
trains.use(authenticate);
trains.get("/", canView, c.listTrains);
trains.get("/:id", canView, r.idParam, validate, c.getTrain);
trains.post("/", requirePermission(PERMISSIONS.TRAIN_MANAGE), r.createTrainRules, validate, c.createTrain);
trains.patch("/:id", requirePermission(PERMISSIONS.TRAIN_MANAGE), r.updateTrainRules, validate, c.updateTrain);
trains.delete("/:id", requirePermission(PERMISSIONS.TRAIN_MANAGE), r.idParam, validate, c.deleteTrain);
// The route is replaced as a whole — a sequence is only coherent as a set.
trains.put("/:id/route", requirePermission(PERMISSIONS.ROUTE_MANAGE), r.setRouteRules, validate, c.setRoute);

/* ---------------- Fares ---------------- */
const fares = express.Router();
fares.use(authenticate);
fares.get("/rules", canView, c.listFareRules);
fares.get("/quote", canView, r.quoteFareRules, validate, c.quoteFare);
fares.get("/matrix", canView, r.fareMatrixRules, validate, c.fareMatrix);
fares.post("/rules", requirePermission(PERMISSIONS.FARE_MANAGE), r.createFareRuleRules, validate, c.createFareRule);
fares.patch("/rules/:id", requirePermission(PERMISSIONS.FARE_MANAGE), r.updateFareRuleRules, validate, c.updateFareRule);
fares.delete("/rules/:id", requirePermission(PERMISSIONS.FARE_MANAGE), r.idParam, validate, c.deleteFareRule);
fares.put("/rules/:id/table", requirePermission(PERMISSIONS.FARE_MANAGE), r.setFareTableRules, validate, c.setFareTable);

/* ---------------- Seat attributes ---------------- */
const seatAttributes = express.Router();
seatAttributes.use(authenticate);
seatAttributes.get("/", canView, c.listSeatAttributes);
seatAttributes.post("/", requirePermission(PERMISSIONS.SEAT_ATTRIBUTE_MANAGE), r.createSeatAttributeRules, validate, c.createSeatAttribute);
seatAttributes.patch("/:id", requirePermission(PERMISSIONS.SEAT_ATTRIBUTE_MANAGE), r.updateSeatAttributeRules, validate, c.updateSeatAttribute);
seatAttributes.delete("/:id", requirePermission(PERMISSIONS.SEAT_ATTRIBUTE_MANAGE), r.idParam, validate, c.deleteSeatAttribute);

module.exports = { stations, trains, fares, seatAttributes };
