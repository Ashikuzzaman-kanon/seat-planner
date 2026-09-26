const express = require("express");
const { body, param, query } = require("express-validator");
const c = require("../controllers/inventoryController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { PERMISSIONS } = require("../constants/permissions");

const tripId = [param("id").isInt().withMessage("Departure id must be an integer")];
const seatId = [param("seatId").isInt().withMessage("Seat id must be an integer")];

const journeyRules = [
  ...tripId,
  query("fromStationId").isInt().withMessage("fromStationId is required"),
  query("toStationId").isInt().withMessage("toStationId is required"),
  query("coachClassId").optional().isInt(),
];

const ruleBody = [
  body("trainId").isInt().withMessage("A train is required"),
  body("coachClassId").isInt().withMessage("A coach class is required"),
  body("fromStationId").isInt().withMessage("An origin is required"),
  body("toStationId").isInt().withMessage("A destination is required"),
  body("quantity").isInt({ min: 1 }).withMessage("Quantity must be at least one seat"),
  body("releaseHoursBefore").optional().isInt({ min: 0, max: 8760 }),
  body("priority").optional().isInt({ min: 0, max: 10000 }),
  body("effectiveFrom").optional({ nullable: true }).isISO8601(),
  body("effectiveTo").optional({ nullable: true }).isISO8601(),
];

/* ---------------- Inventory hung off a departure ---------------- */
const tripInventory = express.Router();
tripInventory.use(authenticate);

const canView = requirePermission(PERMISSIONS.INVENTORY_VIEW);

tripInventory.get("/:id/availability", canView, journeyRules, validate, c.availability);
tripInventory.get("/:id/availability/matrix", canView, tripId, validate, c.matrix);

// Everything on the departure, sold and free alike. Separate from /availability
// because that answers "what can I sell" and this answers "what is going on" —
// and because a seat map wants the taken seats too, not only the sellable ones.
tripInventory.get(
  "/:id/occupancy",
  canView,
  [
    ...tripId,
    query("fromStationId").optional().isInt(),
    query("toStationId").optional().isInt(),
    query("coachClassId").optional().isInt(),
  ],
  validate,
  c.occupancy
);
tripInventory.get("/:id/seats/:seatId/timeline", canView, [...tripId, ...seatId], validate, c.seatTimeline);

tripInventory.get("/:id/quota", canView, tripId, validate, c.tripQuota);
tripInventory.post(
  "/:id/quota/release",
  requirePermission(PERMISSIONS.QUOTA_MANAGE),
  tripId,
  validate,
  c.releaseTripQuota
);

// Reserve one named seat for one named station pair.
tripInventory.put(
  "/:id/seats/:seatId/quota",
  requirePermission(PERMISSIONS.QUOTA_MANAGE),
  [
    ...tripId,
    ...seatId,
    body("fromStationId").isInt().withMessage("An origin is required"),
    body("toStationId").isInt().withMessage("A destination is required"),
    body("releaseHoursBefore").optional().isInt({ min: 0, max: 8760 }),
  ],
  validate,
  c.setSeatQuota
);
tripInventory.delete(
  "/:id/seats/:seatId/quota",
  requirePermission(PERMISSIONS.QUOTA_MANAGE),
  [...tripId, ...seatId],
  validate,
  c.clearSeatQuota
);

tripInventory.post(
  "/:id/seats/:seatId/block",
  requirePermission(PERMISSIONS.SEAT_BLOCK),
  [...tripId, ...seatId, body("reason").optional({ nullable: true }).isString().isLength({ max: 300 })],
  validate,
  c.blockSeat
);
tripInventory.delete(
  "/:id/seats/:seatId/block",
  requirePermission(PERMISSIONS.SEAT_BLOCK),
  [...tripId, ...seatId],
  validate,
  c.unblockSeat
);

/* ---------------- Standing distribution rules ---------------- */
const quota = express.Router();
quota.use(authenticate);

quota.get("/rules", canView, c.listRules);
quota.post("/rules", requirePermission(PERMISSIONS.QUOTA_MANAGE), ruleBody, validate, c.createRule);
quota.patch(
  "/rules/:id",
  requirePermission(PERMISSIONS.QUOTA_MANAGE),
  [param("id").isInt()],
  validate,
  c.updateRule
);
quota.delete(
  "/rules/:id",
  requirePermission(PERMISSIONS.QUOTA_MANAGE),
  [param("id").isInt()],
  validate,
  c.deleteRule
);

// Apply a train's rules across all of its upcoming departures.
quota.post(
  "/trains/:id/materialise",
  requirePermission(PERMISSIONS.QUOTA_MANAGE),
  [param("id").isInt(), body("replace").optional().isBoolean()],
  validate,
  c.materialiseTrain
);

module.exports = { tripInventory, quota };
