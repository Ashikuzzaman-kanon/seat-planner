const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { setRolesRules } = require("../validators/userValidators");
const { PERMISSIONS } = require("../constants/permissions");

// Every route here requires a logged-in user.
router.use(authenticate);

router.get("/", requirePermission(PERMISSIONS.USER_VIEW), userController.listUsers);
router.get("/:id", requirePermission(PERMISSIONS.USER_VIEW), userController.getUser);

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
