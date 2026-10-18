const express = require("express");
const { param } = require("express-validator");
const validate = require("../middleware/validate");
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
// Check the server against what the railway publishes now; then apply a check after reviewing it.
router.post("/check", c.check);
router.post("/sync/:id/apply", [param("id").isInt({ min: 1 }).withMessage("Invalid id")], validate, c.applySync);

module.exports = router;
