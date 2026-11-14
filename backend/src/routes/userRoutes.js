const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { setRolesRules } = require("../validators/userValidators");
const { body, param, query } = require("express-validator");
const { PERMISSIONS } = require("../constants/permissions");

// Every route here requires a logged-in user.
router.use(authenticate);

const id = [param("id").isInt({ min: 1 }).withMessage("Invalid account id")];
const reason = body("reason").isString().trim().isLength({ min: 1, max: 500 }).withMessage("A reason of up to 500 characters is required");
const note = body("note").optional({ values: "null" }).isString().isLength({ max: 500 }).withMessage("A note of up to 500 characters");
const userIds = body("userIds").isArray({ min: 1, max: 100 }).withMessage("userIds must list 1 to 100 accounts");
const eachId = body("userIds.*").isInt({ min: 1 }).withMessage("Every account id must be a number");
const restrict = requirePermission(PERMISSIONS.USER_RESTRICT);

router.get(
  "/",
  requirePermission(PERMISSIONS.USER_VIEW),
  [query("status").optional().isIn(["restricted", "active"]).withMessage("status is restricted or active")],
  validate,
  userController.listUsers
);

// Several accounts at once — above "/:id" so the words are never read as an id.
router.post("/restrict", restrict, [userIds, eachId, reason], validate, userController.restrictMany);
router.post("/lift-restriction", restrict, [userIds, eachId, note], validate, userController.liftMany);

router.get("/:id", requirePermission(PERMISSIONS.USER_VIEW), userController.getUser);
// No permission: anyone signed in sees a name and roles; the service decides the rest.
router.get("/:id/profile", id, validate, userController.getProfile);
router.post("/:id/restrict", restrict, [...id, reason], validate, userController.restrict);
router.post("/:id/lift-restriction", restrict, [...id, note], validate, userController.liftRestriction);

// Replace the roles a user holds. Bounded by the escalation guard: a caller can
// only grant or revoke roles whose permissions they already hold themselves.
router.put(
  "/:id/roles",
  requirePermission(PERMISSIONS.USER_MANAGE_ROLES),
  setRolesRules,
  validate,
  userController.setRoles
);

module.exports = router;
