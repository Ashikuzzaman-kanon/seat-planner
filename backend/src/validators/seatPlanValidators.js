const { body, param } = require("express-validator");
const { ALL_PLAN_STATUSES } = require("../constants/planStatus");

const idRule = [param("id").isInt().withMessage("Invalid plan id")];

const createPlanRules = [
  body("coachNo").isString().bail().trim().isLength({ min: 1, max: 50 })
    .withMessage("Coach number is required"),
  body("trainNameId").isInt().withMessage("Train name is required"),
  body("coachTypeId").isInt().withMessage("Coach type is required"),
  body("coachClassId").isInt().withMessage("Coach class is required"),
  body("layout").optional().isObject().withMessage("Layout must be an object"),
];

// On update every field is optional; deep layout shape is checked in the service.
const updatePlanRules = [
  body("coachNo").optional().isString().bail().trim().isLength({ min: 1, max: 50 })
    .withMessage("Coach number must be 1–50 characters"),
  body("trainNameId").optional().isInt().withMessage("Invalid train name"),
  body("coachTypeId").optional().isInt().withMessage("Invalid coach type"),
  body("coachClassId").optional().isInt().withMessage("Invalid coach class"),
  body("layout").optional().isObject().withMessage("Layout must be an object"),
];

const rejectRules = [
  body("reason").isString().bail().trim().isLength({ min: 1, max: 500 })
    .withMessage("A rejection reason is required"),
];

const statusRule = [
  body("status").optional().isIn(ALL_PLAN_STATUSES),
];

module.exports = {
  idRule,
  createPlanRules,
  updatePlanRules,
  rejectRules,
  statusRule,
};
