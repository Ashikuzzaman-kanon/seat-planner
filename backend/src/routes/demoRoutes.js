const express = require("express");
const c = require("../controllers/demoController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const { PERMISSIONS } = require("../constants/permissions");

/**
 * Demo data: fill the system with demonstration accounts, trains, departures
 * and bookings, and take them away again. See `services/demoService`.
 *
 * One permission for all three. Seeing what the demo holds is only useful to
 * whoever can act on it, and deleting it removes every booking on a demo
 * departure — not something to hand out separately from populating.
 */
const router = express.Router();
router.use(authenticate, requirePermission(PERMISSIONS.DEMO_MANAGE));

router.get("/", c.status);
router.post("/populate", c.populate);
router.post("/clear", c.clear);

module.exports = router;
