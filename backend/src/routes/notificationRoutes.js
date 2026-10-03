const express = require("express");
const { body, param, query } = require("express-validator");
const c = require("../controllers/notificationController");
const authenticate = require("../middleware/auth");
const validate = require("../middleware/validate");

/**
 * The signed-in person's in-app notifications.
 *
 * No permission beyond being signed in: everyone has an inbox, and every call
 * is scoped to its owner in the service, so there is nothing to grant.
 */
const router = express.Router();
router.use(authenticate);

const id = [param("id").isInt({ min: 1 }).withMessage("Invalid notification id")];

router.get(
  "/",
  [
    query("before").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
    query("category").optional().isString().isLength({ max: 32 }),
  ],
  validate,
  c.list
);
router.get("/summary", c.summary);
router.post(
  "/read",
  [
    body("all").optional().isBoolean(),
    body("ids").optional().isArray({ min: 1, max: 200 }).withMessage("ids must be a list of up to 200"),
    body("ids.*").optional().isInt({ min: 1 }),
  ],
  validate,
  c.markRead
);
router.post("/:id/unread", id, validate, c.markUnread);
router.delete("/:id", id, validate, c.remove);

module.exports = router;
