const express = require("express");
const { body, param, query } = require("express-validator");
const router = express.Router();
const c = require("../controllers/featureController");
const authenticate = require("../middleware/auth");
const { requireSuperAdmin } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { SWITCH_STATES } = require("../constants/features");

/*
 * Feature switches (Settings → Features). Only the super admin: a switch
 * applies to the super admin too, so anybody else holding it could hide the
 * super admin's own tabs. Never refused by a switch itself.
 */
router.use(authenticate, requireSuperAdmin("Only the super admin can switch features on and off"));

router.get("/", c.list);
router.get("/people", [query("search").optional().isString().isLength({ max: 100 })], validate, c.people);

const idList = (field) =>
  body(field)
    .optional({ values: "null" })
    .isArray({ max: 500 })
    .withMessage(`${field} must be a list of ids`)
    .bail()
    .custom((list) => list.every((id) => Number.isInteger(Number(id)) && Number(id) > 0))
    .withMessage(`${field} must be a list of ids`);

router.put(
  "/:key",
  [
    param("key").isString().isLength({ min: 1, max: 40 }),
    body("state")
      .isIn(Object.values(SWITCH_STATES))
      .withMessage(`state must be one of ${Object.values(SWITCH_STATES).join(", ")}`),
    body("message")
      .optional({ values: "null" })
      .isString()
      .withMessage("message must be text")
      .bail()
      .isLength({ max: 300 })
      .withMessage("The message can be at most 300 characters"),
    idList("userIds"),
    idList("roleIds"),
  ],
  validate,
  c.set
);

module.exports = router;
