const express = require("express");
const { param, query } = require("express-validator");
const c = require("../controllers/jobController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { PERMISSIONS } = require("../constants/permissions");
const { JOB_STATUS } = require("../models/Job");

/**
 * Background jobs (Phase 8B): what is running after the request that started
 * it, how far it has got, and what failed.
 *
 * Reading is split from retrying. Watching a mass refund is harmless; sending
 * a failed one round again moves money, so it is its own permission.
 */
const router = express.Router();
router.use(authenticate);

router.get(
  "/",
  requirePermission(PERMISSIONS.JOB_VIEW),
  [
    query("status").optional().isIn([...Object.values(JOB_STATUS), "all"]),
    query("type").optional().isString().trim().isLength({ max: 80 }),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  c.list
);

// No permission guard: the controller admits `job:view` or the job's creator.
router.get("/:id", [param("id").isInt({ min: 1 })], validate, c.get);

router.post(
  "/:id/retry",
  requirePermission(PERMISSIONS.JOB_MANAGE),
  [param("id").isInt({ min: 1 })],
  validate,
  c.retry
);

module.exports = router;
