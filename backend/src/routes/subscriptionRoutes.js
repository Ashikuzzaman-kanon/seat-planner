const express = require("express");
const { body, param, query } = require("express-validator");
const c = require("../controllers/subscriptionController");
const authenticate = require("../middleware/auth");
const validate = require("../middleware/validate");
const { requirePermission } = require("../middleware/authorize");
const { PERMISSIONS } = require("../constants/permissions");
const { loginRules } = require("../validators/authValidators");
const { SUBSCRIPTION_STATUS } = require("../models/UserSubscription");
const { MAX_DAYS, isCalendarDate } = require("../utils/subscriptionPeriod");

/**
 * Subscriptions.
 *
 * Three kinds of caller:
 *   - anyone signed in sees what there is, asks for one, and ends their own;
 *   - `subscription:manage` creates, renames, closes and deletes them;
 *   - `subscription:approve` works the requests and the subscriber list.
 *
 * And one with no session at all: POST /check takes an email and password
 * and says which subscriptions that account holds.
 */
const router = express.Router();

// Before `authenticate`: its callers are outside the app and have no token.
router.post("/check", loginRules, validate, c.check);

router.use(authenticate);

const manage = requirePermission(PERMISSIONS.SUBSCRIPTION_MANAGE);
const approve = requirePermission(PERMISSIONS.SUBSCRIPTION_APPROVE);

const id = [param("id").isInt({ min: 1 }).withMessage("Invalid id")];
const text = (field, max) =>
  body(field)
    .optional({ values: "null" })
    .isString()
    .isLength({ max })
    .withMessage(`${field} must be at most ${max} characters`);

// How long: a number of days from today, or a last day. The service decides
// which was given and whether it makes sense today.
const period = [
  body("days").optional().isInt({ min: 1, max: MAX_DAYS }).withMessage(`days must be 1 to ${MAX_DAYS}`).toInt(),
  body("lastDay")
    .optional()
    .custom((value) => isCalendarDate(value))
    .withMessage("lastDay must be a date, as YYYY-MM-DD"),
  body().custom((value) => {
    if (value?.days === undefined && !value?.lastDay) throw new Error("Give days or lastDay");
    return true;
  }),
];

router.get("/", c.list);
router.get("/mine", c.mine);

router.post(
  "/",
  manage,
  [
    body("name").isString().trim().isLength({ min: 1, max: 100 }).withMessage("A name of up to 100 characters is required"),
    text("description", 500),
    body("code")
      .optional({ values: "falsy" })
      .isLength({ max: 40 })
      .matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .withMessage("A code is lowercase letters, digits and single hyphens, up to 40 characters"),
  ],
  validate,
  c.create
);

/* Requests and subscribers — above "/:id" so "members" is not read as an id. */

router.get(
  "/members",
  approve,
  [
    query("status").optional().isIn(Object.values(SUBSCRIPTION_STATUS)),
    query("subscriptionId").optional().isInt({ min: 1 }),
    query("search").optional().isString().isLength({ max: 100 }),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  c.members
);
router.get("/members/pending-count", approve, c.pendingCount);

router.post("/members/:id/approve", approve, [...id, ...period, text("note", 500)], validate, c.approve);
router.post("/members/:id/decline", approve, [...id, text("note", 500)], validate, c.decline);
router.patch("/members/:id", approve, [...id, ...period], validate, c.extend);
// The subscriber ends their own; a reviewer ends anyone's. The service tells them apart.
router.post("/members/:id/cancel", [...id, text("reason", 500)], validate, c.cancel);

router.patch(
  "/:id",
  manage,
  [
    ...id,
    body("name").optional().isString().trim().isLength({ min: 1, max: 100 }).withMessage("A name of up to 100 characters"),
    text("description", 500),
    body("isOpen").optional().isBoolean().withMessage("isOpen must be true or false").toBoolean(),
    body().custom((value) => {
      if (!["name", "description", "isOpen"].some((key) => value?.[key] !== undefined)) {
        throw new Error("Nothing to change");
      }
      return true;
    }),
  ],
  validate,
  c.update
);
router.delete("/:id", manage, id, validate, c.remove);

router.post("/:id/requests", id, validate, c.request);

module.exports = router;
