const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { changeRoleRules } = require("../validators/userValidators");
const { PERMISSIONS } = require("../constants/roles");

// Every route here requires a logged-in user.
router.use(authenticate);

// List / inspect users — admins and super admins.
router.get("/", requirePermission(PERMISSIONS.USER_VIEW), userController.listUsers);
router.get("/:id", requirePermission(PERMISSIONS.USER_VIEW), userController.getUser);

// Change a user's role — super admins only.
router.patch(
  "/:id/role",
  requirePermission(PERMISSIONS.USER_MANAGE_ROLES),
  changeRoleRules,
  validate,
  userController.changeRole
);

module.exports = router;
