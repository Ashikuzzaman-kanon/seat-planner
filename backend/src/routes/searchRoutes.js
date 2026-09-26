const express = require("express");
const { param, query } = require("express-validator");
const c = require("../controllers/searchController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { PERMISSIONS } = require("../constants/permissions");

/**
 * Shopping, as distinct from operating.
 *
 * Every route here is gated on `booking:create` — the permission to buy — and
 * none on the operational ones. A passenger can find a train and see what is
 * free without being able to see the departure board's generation status, the
 * quota rules behind it, or anyone else's bookings.
 */
const search = express.Router();
search.use(authenticate);

const canBuy = requirePermission(PERMISSIONS.BOOKING_CREATE);

search.get("/stations", canBuy, c.listStations);

search.get("/dates", canBuy, [query("days").optional().isInt({ min: 1, max: 60 })], validate, c.dates);

search.get(
  "/departures",
  canBuy,
  [
    query("fromStationId").isInt().withMessage("Where are you travelling from?"),
    query("toStationId").isInt().withMessage("Where are you travelling to?"),
    query("date").optional().matches(/^\d{4}-\d{2}-\d{2}$/).withMessage("Use a YYYY-MM-DD date"),
    query("coachClassId").optional().isInt(),
  ],
  validate,
  c.listDepartures
);

search.get(
  "/departures/:id/route",
  canBuy,
  [param("id").isInt()],
  validate,
  c.tripRoute
);

// "How far can I get on this train?" — the question a passenger on a busy
// service has, which a single sold-out figure cannot answer.
search.get(
  "/departures/:id/matrix",
  canBuy,
  [param("id").isInt(), query("coachClassId").optional().isInt()],
  validate,
  c.matrix
);

search.get(
  "/departures/:id/seats",
  canBuy,
  [
    param("id").isInt(),
    query("fromStationId").isInt(),
    query("toStationId").isInt(),
    query("coachClassId").optional().isInt(),
    query("filters").optional().isString(),
  ],
  validate,
  c.seats
);

module.exports = search;
