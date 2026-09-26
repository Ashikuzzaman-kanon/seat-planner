const { body, param, query } = require("express-validator");

const idParam = [param("id").isInt().withMessage("Id must be an integer")];

/* ---------------- Stations ---------------- */

const createStationRules = [
  body("code")
    .isString().trim().isLength({ min: 2, max: 10 })
    .withMessage("Station code must be 2–10 characters"),
  body("name")
    .isString().trim().isLength({ min: 2, max: 100 })
    .withMessage("Station name must be 2–100 characters"),
  body("district").optional({ nullable: true }).isString().isLength({ max: 100 }),
];

const updateStationRules = [
  ...idParam,
  body("code").optional().isString().trim().isLength({ min: 2, max: 10 }),
  body("name").optional().isString().trim().isLength({ min: 2, max: 100 }),
  body("district").optional({ nullable: true }).isString().isLength({ max: 100 }),
  body("isActive").optional().isBoolean(),
];

/* ---------------- Trains ---------------- */

const createTrainRules = [
  body("name")
    .isString().trim().isLength({ min: 2, max: 100 })
    .withMessage("Train name must be 2–100 characters"),
  body("code").optional({ nullable: true }).isString().isLength({ max: 20 }),
  body("upCode").optional({ nullable: true }).isString().isLength({ max: 20 }),
  body("downCode").optional({ nullable: true }).isString().isLength({ max: 20 }),
  body("notes").optional({ nullable: true }).isString().isLength({ max: 500 }),
];

const updateTrainRules = [
  ...idParam,
  body("name").optional().isString().trim().isLength({ min: 2, max: 100 }),
  body("code").optional({ nullable: true }).isString().isLength({ max: 20 }),
  body("upCode").optional({ nullable: true }).isString().isLength({ max: 20 }),
  body("downCode").optional({ nullable: true }).isString().isLength({ max: 20 }),
  body("notes").optional({ nullable: true }).isString().isLength({ max: 500 }),
  body("isActive").optional().isBoolean(),
];

// Structural checks only — the coherence of the sequence as a whole (times
// moving forward across day boundaries, distances increasing) is decided by
// validateRoute in the service, where it can be unit-tested on its own.
const setRouteRules = [
  ...idParam,
  body("stops").isArray({ min: 2 }).withMessage("A route needs at least two stops"),
  body("stops.*.stationId").isInt().withMessage("Each stop needs a station"),
  body("stops.*.arrivalTime")
    .optional({ nullable: true })
    .matches(/^\d{2}:\d{2}(:\d{2})?$/)
    .withMessage("Arrival must look like HH:MM"),
  body("stops.*.departureTime")
    .optional({ nullable: true })
    .matches(/^\d{2}:\d{2}(:\d{2})?$/)
    .withMessage("Departure must look like HH:MM"),
  body("stops.*.dayOffset").optional().isInt({ min: 0, max: 5 }),
  body("stops.*.distanceKm").optional({ nullable: true }).isFloat({ min: 0 }),
  body("stops.*.haltMinutes").optional({ nullable: true }).isInt({ min: 0, max: 720 }),
];

/* ---------------- Fares ---------------- */

const createFareRuleRules = [
  body("name").isString().trim().isLength({ min: 2, max: 120 }),
  body("kind").isIn(["table", "distance"]).withMessage("Kind must be table or distance"),
  body("coachClassId").isInt().withMessage("A coach class is required"),
  body("trainId").optional({ nullable: true }).isInt(),
  body("priority").optional().isInt({ min: 0, max: 10000 }),
  body("ratePerKm").optional({ nullable: true }).isFloat({ min: 0 }),
  body("minFare").optional({ nullable: true }).isFloat({ min: 0 }),
];

const updateFareRuleRules = [
  ...idParam,
  body("name").optional().isString().trim().isLength({ min: 2, max: 120 }),
  body("coachClassId").optional().isInt(),
  body("trainId").optional({ nullable: true }).isInt(),
  body("priority").optional().isInt({ min: 0, max: 10000 }),
  body("ratePerKm").optional({ nullable: true }).isFloat({ min: 0 }),
  body("minFare").optional({ nullable: true }).isFloat({ min: 0 }),
  body("isActive").optional().isBoolean(),
];

const setFareTableRules = [
  ...idParam,
  body("entries").isArray().withMessage("entries must be an array"),
  body("entries.*.fromStationId").isInt(),
  body("entries.*.toStationId").isInt(),
  body("entries.*.amount").isFloat({ min: 0 }),
];

const quoteFareRules = [
  query("trainId").isInt().withMessage("trainId is required"),
  query("coachClassId").isInt().withMessage("coachClassId is required"),
  query("fromStationId").isInt().withMessage("fromStationId is required"),
  query("toStationId").isInt().withMessage("toStationId is required"),
];

const fareMatrixRules = [
  query("trainId").isInt().withMessage("trainId is required"),
  query("coachClassId").isInt().withMessage("coachClassId is required"),
];

/* ---------------- Seat attributes ---------------- */

const createSeatAttributeRules = [
  body("key").isString().trim().isLength({ min: 2, max: 50 }),
  body("label").isString().trim().isLength({ min: 2, max: 100 }),
  body("description").optional({ nullable: true }).isString().isLength({ max: 300 }),
  body("valueType").optional().isIn(["boolean", "enum"]),
  body("options").optional({ nullable: true }).isArray(),
  body("icon").optional({ nullable: true }).isString().isLength({ max: 60 }),
  body("isFilterable").optional().isBoolean(),
  body("sortOrder").optional().isInt({ min: 0, max: 10000 }),
];

const updateSeatAttributeRules = [
  ...idParam,
  body("key").optional().isString().trim().isLength({ min: 2, max: 50 }),
  body("label").optional().isString().trim().isLength({ min: 2, max: 100 }),
  body("description").optional({ nullable: true }).isString().isLength({ max: 300 }),
  body("valueType").optional().isIn(["boolean", "enum"]),
  body("options").optional({ nullable: true }).isArray(),
  body("icon").optional({ nullable: true }).isString().isLength({ max: 60 }),
  body("isFilterable").optional().isBoolean(),
  body("isActive").optional().isBoolean(),
  body("sortOrder").optional().isInt({ min: 0, max: 10000 }),
];

module.exports = {
  idParam,
  createStationRules,
  updateStationRules,
  createTrainRules,
  updateTrainRules,
  setRouteRules,
  createFareRuleRules,
  updateFareRuleRules,
  setFareTableRules,
  quoteFareRules,
  fareMatrixRules,
  createSeatAttributeRules,
  updateSeatAttributeRules,
};
