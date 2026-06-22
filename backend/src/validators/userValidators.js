const { body, param } = require("express-validator");
const { ALL_ROLES } = require("../constants/roles");

const changeRoleRules = [
  param("id").isInt().withMessage("User id must be an integer"),
  body("role")
    .isIn(ALL_ROLES)
    .withMessage(`Role must be one of: ${ALL_ROLES.join(", ")}`),
];

module.exports = { changeRoleRules };
