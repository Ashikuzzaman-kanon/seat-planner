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

const createPlanRules = [
  ...planFieldRules,
  body("isTemplate").optional().isBoolean().withMessage("isTemplate is true or false"),
];

/** Plans to move to templates: one or several ids. */
const templateRules = [
  body("ids").isArray({ min: 1, max: 100 }).withMessage("ids is a list of plan ids, 1 to 100"),
  body("ids.*").isInt({ min: 1 }).withMessage("Each id is a plan's id"),
];

/** A plan's train or coach, changed to make room for another. */
const detailsRules = [
  body("coachNo").optional({ values: "null" }).isString().bail().trim().isLength({ max: 50 })
    .withMessage("Coach number must be at most 50 characters"),
  body("trainNameId").optional({ values: "null" }).isInt().withMessage("Invalid train name"),
];

/** A new layout for a plan in use: the plan as the editor has it, and the draft it was saved as, if any. */
const replaceRules = [...planFieldRules, body("planId").optional({ values: "null" }).isInt().withMessage("Invalid plan id")];

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
  templateRules,
  detailsRules,
  replaceRules,
  updatePlanRules,
  rejectRules,
  statusRule,
};
