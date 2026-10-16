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
 *   - anyone signed in sees what there is, asks for one, ends their own, and
 *     looks at their own devices;
 *   - `subscription:manage` creates, renames, closes and deletes subscriptions,
 *     and the platforms they can be used on;
 *   - `subscription:approve` works the requests and the subscriber list, sets
 *     how many devices each subscription allows, and looks after devices;
 *   - `subscription:versions` decides, for each subscription, which versions
 *     of the apps it accepts.
 *
 * And one with no session at all: POST /check takes an email and password,
 * the device the call came from and the version of the app making it, and
 * says which subscriptions that account holds on it.
 */
const router = express.Router();

// Before `authenticate`: their callers are outside the app and have no token.
router.post("/check", loginRules, validate, c.check);

const SAY = Object.freeze({
  train: "Name the train, or give its number",
  class: "class is a class code, such as S_CHAIR",
  coach: "coach is a coach letter, such as KA",
});
router.post(
  "/seat-plans",
  loginRules,
  [
    // One message per field, however it is wrong: missing, not text, or too long.
    body("train").isString().withMessage(SAY.train).bail().trim().isLength({ min: 1, max: 100 }).withMessage(SAY.train),
    body("class").optional({ values: "null" }).isString().withMessage(SAY.class).bail().isLength({ max: 40 }).withMessage(SAY.class),
    body("coach").optional({ values: "null" }).isString().withMessage(SAY.coach).bail().isLength({ max: 40 }).withMessage(SAY.coach),
  ],
  validate,
  c.seatPlans
);

router.use(authenticate);

const manage = requirePermission(PERMISSIONS.SUBSCRIPTION_MANAGE);
const approve = requirePermission(PERMISSIONS.SUBSCRIPTION_APPROVE);
const versionsPermission = requirePermission(PERMISSIONS.SUBSCRIPTION_VERSIONS);

const id = [param("id").isInt({ min: 1 }).withMessage("Invalid id")];
const text = (field, max) =>
  body(field)
    .optional({ values: "null" })
    .isString()
    .isLength({ max })
    .withMessage(`${field} must be at most ${max} characters`);

// How long: a number of days from today, or a last day. The service decides
// which was given and whether it makes sense today.
const days = body("days").optional().isInt({ min: 1, max: MAX_DAYS }).withMessage(`days must be 1 to ${MAX_DAYS}`).toInt();
const lastDay = body("lastDay")
  .optional()
  .custom((value) => isCalendarDate(value))
  .withMessage("lastDay must be a date, as YYYY-MM-DD");

// How many devices of each platform: { "<platform value>": count }. Only its
// shape is checked here; which platforms exist is the service's to say.
const deviceCounts = body("devices")
  .optional({ values: "null" })
  .custom((value) => typeof value === "object" && !Array.isArray(value))
  .withMessage("devices must list a count for each platform");

const given = (...fields) =>
  body().custom((value) => {
    if (!fields.some((field) => value?.[field] !== undefined && value[field] !== null && value[field] !== "")) {
      throw new Error(`Give ${fields.join(" or ")}`);
    }
    return true;
  });

router.get("/", c.list);
router.get("/mine", c.mine);

router.post(
  "/",
  manage,
  [
    body("name").isString().trim().isLength({ min: 1, max: 100 }).withMessage("A name of up to 100 characters is required"),
    text("description", 500),
    body("includesSeatPlans").optional().isBoolean().withMessage("includesSeatPlans must be true or false").toBoolean(),
    body("code")
      .optional({ values: "falsy" })
      .isLength({ max: 40 })
      .matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .withMessage("A code is lowercase letters, digits and single hyphens, up to 40 characters"),
  ],
  validate,
  c.create
);

/*
 * Everything below with a word for its first segment sits above "/:id", so
 * that word is never read as a subscription's id.
 */

/* ---------------- Platforms ---------------- */

router.get("/platforms", c.platforms);
router.post(
  "/platforms",
  manage,
  [
    body("value").isString().isLength({ min: 1, max: 40 }).withMessage("A value of up to 40 characters is required"),
    body("name").isString().trim().isLength({ min: 1, max: 60 }).withMessage("A name of up to 60 characters is required"),
  ],
  validate,
  c.createPlatform
);
router.patch(
  "/platforms/:id",
  manage,
  [
    ...id,
    body("name").optional().isString().trim().isLength({ min: 1, max: 60 }).withMessage("A name of up to 60 characters"),
    body("isActive").optional().isBoolean().withMessage("isActive must be true or false").toBoolean(),
    given("name", "isActive"),
  ],
  validate,
  c.updatePlatform
);
router.delete("/platforms/:id", manage, id, validate, c.removePlatform);

/* ---------------- App versions, per subscription and platform ---------------- */

const platformId = param("platformId").isInt({ min: 1 }).withMessage("Invalid platform id");

router.get("/:id/versions", versionsPermission, id, validate, c.versionPolicies);
router.patch(
  "/:id/versions/:platformId",
  versionsPermission,
  [
    ...id,
    platformId,
    body("versionRequired").optional().isBoolean().withMessage("versionRequired must be true or false").toBoolean(),
    body("minVersion").optional({ values: "null" }).isString().isLength({ max: 40 }).withMessage("minVersion must be a version, such as 1.4.2"),
    body().custom((value) => {
      if (value?.versionRequired === undefined && value?.minVersion === undefined) throw new Error("Give versionRequired or minVersion");
      return true;
    }),
  ],
  validate,
  c.setVersionPolicy
);
router.post(
  "/:id/versions/:platformId/blocked",
  versionsPermission,
  [
    ...id,
    platformId,
    body("version").isString().isLength({ min: 1, max: 40 }).withMessage("A version such as 1.4.2 is required"),
    text("note", 200),
  ],
  validate,
  c.blockVersion
);
router.delete(
  "/:id/versions/:platformId/blocked/:blockedId",
  versionsPermission,
  [...id, platformId, param("blockedId").isInt({ min: 1 }).withMessage("Invalid id")],
  validate,
  c.unblockVersion
);

/* ---------------- Devices ---------------- */

router.get("/devices/mine", c.myDevices);
router.get(
  "/users/:userId/devices",
  approve,
  [param("userId").isInt({ min: 1 }).withMessage("Invalid account id")],
  validate,
  c.userDevices
);
router.patch(
  "/devices/:id",
  approve,
  [
    ...id,
    text("note", 200),
    body("isBlocked").optional().isBoolean().withMessage("isBlocked must be true or false").toBoolean(),
    body().custom((value) => {
      if (value?.note === undefined && value?.isBlocked === undefined) throw new Error("Nothing to change");
      return true;
    }),
  ],
  validate,
  c.updateDevice
);
router.delete("/devices/:id", approve, id, validate, c.removeDevice);

/* ---------------- Requests and subscribers ---------------- */

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

router.post(
  "/members/:id/approve",
  approve,
  [...id, days, lastDay, given("days", "lastDay"), deviceCounts, text("note", 500)],
  validate,
  c.approve
);
router.post("/members/:id/decline", approve, [...id, text("note", 500)], validate, c.decline);
// A running subscription's last day, its device counts, or both.
router.patch(
  "/members/:id",
  approve,
  [...id, days, lastDay, deviceCounts, given("days", "lastDay", "devices")],
  validate,
  c.amend
);
// The subscriber ends their own; a reviewer ends anyone's. The service tells them apart.
router.post("/members/:id/cancel", [...id, text("reason", 500)], validate, c.cancel);

/* ---------------- One subscription ---------------- */

router.patch(
  "/:id",
  manage,
  [
    ...id,
    body("name").optional().isString().trim().isLength({ min: 1, max: 100 }).withMessage("A name of up to 100 characters"),
    text("description", 500),
    body("isOpen").optional().isBoolean().withMessage("isOpen must be true or false").toBoolean(),
    body("includesSeatPlans").optional().isBoolean().withMessage("includesSeatPlans must be true or false").toBoolean(),
    // Not `given`: a description may be sent empty, to clear it.
    body().custom((value) => {
      if (!["name", "description", "isOpen", "includesSeatPlans"].some((key) => value?.[key] !== undefined)) {
        throw new Error("Nothing to change");
      }
      return true;
    }),
  ],
  validate,
  c.update
);
router.delete("/:id", manage, id, validate, c.remove);

router.post("/:id/requests", [...id, deviceCounts], validate, c.request);

module.exports = router;
