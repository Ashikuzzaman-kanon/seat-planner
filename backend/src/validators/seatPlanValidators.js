const { body, param } = require("express-validator");
const { ALL_PLAN_STATUSES } = require("../constants/planStatus");

const idRule = [param("id").isInt().withMessage("Invalid plan id")];

/*
 * A plan is saved as a draft, so nothing is required here: a layout can be
 * kept before anyone knows its train, type, class or coach number. Submitting
 * for approval is where those become required (seatPlanService). What is sent
 * must still be the right shape; null clears a field.
 */
const planFieldRules = [
  body("coachNo").optional({ values: "null" }).isString().bail().trim().isLength({ max: 50 })
    .withMessage("Coach number must be at most 50 characters"),
  body("trainNameId").optional({ values: "null" }).isInt().withMessage("Invalid train name"),
  body("coachTypeId").optional({ values: "null" }).isInt().withMessage("Invalid coach type"),
  body("coachClassId").optional({ values: "null" }).isInt().withMessage("Invalid coach class"),
  body("layout").optional().isObject().withMessage("Layout must be an object"),
];

const createPlanRules = planFieldRules;

// Deep layout shape is checked in the service.
const updatePlanRules = planFieldRules;

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
