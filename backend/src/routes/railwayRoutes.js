const express = require("express");
const c = require("../controllers/railwayController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const { PERMISSIONS } = require("../constants/permissions");

/**
 * The real railway: load Bangladesh Railway's timetable and the seat plans
 * transcribed for its trains. See `services/railwayService`.
 */
const router = express.Router();
router.use(authenticate, requirePermission(PERMISSIONS.RAILWAY_MANAGE));

router.get("/", c.status);
router.post("/load", c.load);

module.exports = router;
