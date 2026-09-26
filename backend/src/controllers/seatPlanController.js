const asyncHandler = require("../utils/asyncHandler");
const seatPlanService = require("../services/seatPlanService");

// Visibility inside the service depends on what the caller may do, so the
// resolved permission set travels with the user on every call.
const actor = (req) => ({ user: req.user, permissions: req.permissions });

const listPlans = asyncHandler(async (req, res) => {
  const plans = await seatPlanService.listPlans({
    ...actor(req),
    status: req.query.status,
    search: req.query.search || "",
    mine: req.query.mine === "1" || req.query.mine === "true",
    templates: req.query.templates === "1" || req.query.templates === "true",
    trainNameId: req.query.trainNameId,
  });
  res.json({ plans });
});

const getPlan = asyncHandler(async (req, res) => {
  const plan = await seatPlanService.getPlan({ ...actor(req), id: req.params.id });
  res.json({ plan });
});

const createPlan = asyncHandler(async (req, res) => {
  const plan = await seatPlanService.createPlan({ ...actor(req), data: req.body });
  res.status(201).json({ message: "Plan created", plan });
});

const updatePlan = asyncHandler(async (req, res) => {
  const plan = await seatPlanService.updatePlan({
    ...actor(req),
    id: req.params.id,
    data: req.body,
  });
  res.json({ message: "Plan updated", plan });
});

const submitPlan = asyncHandler(async (req, res) => {
  const plan = await seatPlanService.submitPlan({ ...actor(req), id: req.params.id });
  res.json({ message: "Plan submitted", plan });
});

const approvePlan = asyncHandler(async (req, res) => {
  const plan = await seatPlanService.approvePlan({ ...actor(req), id: req.params.id });
  res.json({ message: "Plan approved", plan });
});

const rejectPlan = asyncHandler(async (req, res) => {
  const plan = await seatPlanService.rejectPlan({
    ...actor(req),
    id: req.params.id,
    reason: req.body.reason,
  });
  res.json({ message: "Plan rejected", plan });
});

const deletePlan = asyncHandler(async (req, res) => {
  await seatPlanService.deletePlan({ id: req.params.id });
  res.json({ message: "Plan deleted" });
});

module.exports = {
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  submitPlan,
  approvePlan,
  rejectPlan,
  deletePlan,
};
