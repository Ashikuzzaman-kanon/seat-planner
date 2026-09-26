const express = require("express");
const { body, param, query } = require("express-validator");
const c = require("../controllers/departureController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { PERMISSIONS } = require("../constants/permissions");

const idParam = [param("id").isInt().withMessage("Id must be an integer")];

const compositionRules = [
  ...idParam,
  body("coaches").isArray().withMessage("coaches must be an array"),
  body("coaches.*.coachCode").isString().trim().isLength({ min: 1, max: 10 }),
  body("coaches.*.seatPlanId").isInt().withMessage("Each coach needs a seat plan"),
];

const scheduleRules = [
  ...idParam,
  body("schedules").isArray().withMessage("schedules must be an array"),
  body("schedules.*.runsOn").isArray().withMessage("runsOn must be an array of weekdays"),
  body("schedules.*.runsOn.*").isInt({ min: 0, max: 6 }),
  body("schedules.*.effectiveFrom").optional({ nullable: true }).isISO8601(),
  body("schedules.*.effectiveTo").optional({ nullable: true }).isISO8601(),
];

const generateRules = [
  body("days").optional().isInt({ min: 1, max: 120 }),
  body("trainId").optional({ nullable: true }).isInt(),
];

const listRules = [
  query("trainId").optional().isInt(),
  query("from").optional().isISO8601(),
  query("to").optional().isISO8601(),
  query("status").optional().isIn(["scheduled", "cancelled", "departed", "completed"]),
];

/* ---------------- Composition and schedule, hung off a train ---------------- */
const trainPlanning = express.Router();
trainPlanning.use(authenticate);
trainPlanning.get("/:id/composition", requirePermission(PERMISSIONS.NETWORK_VIEW), idParam, validate, c.getComposition);
trainPlanning.put("/:id/composition", requirePermission(PERMISSIONS.COMPOSITION_MANAGE), compositionRules, validate, c.setComposition);
trainPlanning.get("/:id/schedule", requirePermission(PERMISSIONS.NETWORK_VIEW), idParam, validate, c.getSchedule);
trainPlanning.put("/:id/schedule", requirePermission(PERMISSIONS.SCHEDULE_MANAGE), scheduleRules, validate, c.setSchedule);

/* ---------------- Departures ---------------- */
const trips = express.Router();
trips.use(authenticate);
trips.get("/", requirePermission(PERMISSIONS.TRIP_VIEW), listRules, validate, c.listTrips);
trips.get("/jobs", requirePermission(PERMISSIONS.TRIP_VIEW), c.jobStatus);
trips.get("/:id", requirePermission(PERMISSIONS.TRIP_VIEW), idParam, validate, c.getTrip);
trips.get("/:id/seats", requirePermission(PERMISSIONS.TRIP_VIEW), idParam, validate, c.getTripSeats);
trips.post("/generate", requirePermission(PERMISSIONS.TRIP_MANAGE), generateRules, validate, c.generate);
trips.post("/:id/rebuild", requirePermission(PERMISSIONS.TRIP_MANAGE), idParam, validate, c.rebuildTrip);
/*
 * Cancelling refunds every passenger on the departure. That is a different
 * size of decision from rebuilding one nobody has booked, and §14.1 puts it
 * with a higher-privileged role — so it has its own permission rather than
 * riding along with `trip:manage`. Reinstating sits with it: undoing a
 * cancellation is the same authority as making one.
 */
trips.post("/:id/cancel", requirePermission(PERMISSIONS.TRIP_CANCEL), idParam, validate, c.cancelTrip);
trips.post("/:id/reinstate", requirePermission(PERMISSIONS.TRIP_CANCEL), idParam, validate, c.reinstateTrip);

/* ---------------- Coaches on one departure (§14.1) ---------------- */

const coachParam = [...idParam, param("coachId").isInt().withMessage("Which coach?")];

trips.get("/:id/coaches", requirePermission(PERMISSIONS.TRIP_VIEW), idParam, validate, c.listCoaches);

trips.post(
  "/:id/coaches",
  requirePermission(PERMISSIONS.TRIP_MANAGE),
  [
    ...idParam,
    body("seatPlanId").isInt().withMessage("Which seat plan?"),
    body("coachCode").isString().trim().isLength({ min: 1, max: 10 })
      .withMessage("Give the coach a code, such as KA"),
    body("position").optional({ nullable: true }).isInt({ min: 1 }),
  ],
  validate,
  c.addCoach
);

// Removal is refused outright for a coach anyone has used — see coachService.
// The permission is the ordinary one because what it permits harms nobody.
trips.delete(
  "/:id/coaches/:coachId",
  requirePermission(PERMISSIONS.TRIP_MANAGE),
  coachParam,
  validate,
  c.removeCoach
);

trips.post(
  "/:id/coaches/:coachId/cancel",
  requirePermission(PERMISSIONS.TRIP_CANCEL),
  [
    ...coachParam,
    // Every passenger on the coach is emailed this, so it has to be a reason.
    body("reason").isString().trim().isLength({ min: 5, max: 500 })
      .withMessage("Say why — every passenger on this coach will be told"),
  ],
  validate,
  c.cancelCoach
);

trips.post(
  "/:id/coaches/:coachId/reinstate",
  requirePermission(PERMISSIONS.TRIP_CANCEL),
  [...coachParam, body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 500 })],
  validate,
  c.reinstateCoach
);

// Separate from TRIP_MANAGE: deciding a train does not run is an operational
// call, while deciding how its tickets may be returned is a commercial one, and
// they are not always the same person.
trips.patch(
  "/:id/standing",
  requirePermission(PERMISSIONS.TRIP_MANAGE),
  [...idParam, body("enabled").isBoolean().withMessage("On or off?")],
  validate,
  c.setStanding
);

trips.patch(
  "/:id/refund-options",
  requirePermission(PERMISSIONS.REFUND_CONFIGURE),
  [
    ...idParam,
    body("convenient").optional().isBoolean(),
    body("demand").optional().isBoolean(),
  ],
  validate,
  c.setRefundOptions
);

module.exports = { trainPlanning, trips };
