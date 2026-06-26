const { body, param } = require("express-validator");

const nameRules = [
  body("name")
    .isString()
    .withMessage("Name is required")
    .bail()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Name must be 1–100 characters"),
];

const idRule = [param("id").isInt().withMessage("Invalid id")];

module.exports = { nameRules, idRule };
