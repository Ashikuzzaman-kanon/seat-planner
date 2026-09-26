const { body, param } = require("express-validator");

const setRolesRules = [
  param("id").isInt().withMessage("User id must be an integer"),
  body("roleIds")
    .isArray()
    .withMessage("roleIds must be an array of role ids"),
  body("roleIds.*").isInt().withMessage("Each role id must be an integer"),
];

module.exports = { setRolesRules };
