const express = require("express");
const router = express.Router();
const roleController = require("../controllers/roleController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const rules = require("../validators/roleValidators");
const { PERMISSIONS } = require("../constants/permissions");

router.use(authenticate);

router.get("/", requirePermission(PERMISSIONS.ROLE_VIEW), roleController.listRoles);

// The catalogue, annotated with what this caller may actually grant.
router.get(
  "/permissions",
  requirePermission(PERMISSIONS.ROLE_VIEW),
  roleController.listPermissions
);

router.get("/:id", requirePermission(PERMISSIONS.ROLE_VIEW), rules.roleIdRule, validate, roleController.getRole);

router.post(
  "/",
  requirePermission(PERMISSIONS.ROLE_CREATE),
  rules.createRoleRules,
  validate,
  roleController.createRole
);

router.patch(
  "/:id",
  requirePermission(PERMISSIONS.ROLE_UPDATE),
  rules.updateRoleRules,
  validate,
  roleController.updateRole
);

router.delete(
  "/:id",
  requirePermission(PERMISSIONS.ROLE_DELETE),
  rules.roleIdRule,
  validate,
  roleController.deleteRole
);

module.exports = router;
