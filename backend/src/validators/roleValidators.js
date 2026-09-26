const { body, param } = require("express-validator");

const nameRule = body("name")
  .isString()
  .trim()
  .isLength({ min: 2, max: 60 })
  .withMessage("Role name must be 2–60 characters");

const descriptionRule = body("description")
  .optional({ nullable: true })
  .isString()
  .isLength({ max: 300 })
  .withMessage("Description must be 300 characters or fewer");

const permissionsRule = body("permissions")
  .isArray()
  .withMessage("permissions must be an array of permission keys");

const createRoleRules = [
  nameRule,
  descriptionRule,
  permissionsRule.optional(),
  body("permissions.*").isString().withMessage("Each permission must be a string key"),
];

const updateRoleRules = [
  param("id").isInt().withMessage("Role id must be an integer"),
  nameRule.optional(),
  descriptionRule,
  permissionsRule.optional(),
  body("permissions.*").isString().withMessage("Each permission must be a string key"),
];

const roleIdRule = [param("id").isInt().withMessage("Role id must be an integer")];

module.exports = { createRoleRules, updateRoleRules, roleIdRule };
