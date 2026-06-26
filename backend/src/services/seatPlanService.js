const { Op } = require("sequelize");
const {
  SeatPlan,
  TrainName,
  CoachType,
  CoachClass,
  User,
} = require("../models");
const ApiError = require("../utils/ApiError");
const { normalizeLayout } = require("../utils/normalizeLayout");
const { PLAN_STATUS } = require("../constants/planStatus");
const { PERMISSIONS, roleHasPermission } = require("../constants/roles");

// Eager-load reference names and authors for full plan responses.
const INCLUDES = [
  { model: TrainName, as: "trainName" },
  { model: CoachType, as: "coachType" },
  { model: CoachClass, as: "coachClass" },
  { model: User, as: "createdBy" },
  { model: User, as: "approvedBy" },
];

function canSeeAll(user) {
  // Anyone who can create plans (planner+) can see non-approved plans.
  return roleHasPermission(user.role, PERMISSIONS.PLAN_CREATE);
}

function canApprove(user) {
  return roleHasPermission(user.role, PERMISSIONS.PLAN_APPROVE);
}

/** Confirms the chosen train/type/class actually exist before saving. */
async function assertRefsExist({ trainNameId, coachTypeId, coachClassId }) {
  const [train, type, klass] = await Promise.all([
    TrainName.findByPk(trainNameId),
    CoachType.findByPk(coachTypeId),
    CoachClass.findByPk(coachClassId),
  ]);
  if (!train) throw ApiError.badRequest("Selected train name does not exist");
  if (!type) throw ApiError.badRequest("Selected coach type does not exist");
  if (!klass) throw ApiError.badRequest("Selected coach class does not exist");
}

async function findPlanOr404(id) {
  const plan = await SeatPlan.findByPk(id, { include: INCLUDES });
  if (!plan) throw ApiError.notFound("Plan not found");
  return plan;
}

/** List plans with role-based visibility and optional filters. */
async function listPlans({ user, status, search = "", mine, templates, trainNameId }) {
  const where = {};

  if (!canSeeAll(user)) {
    // Regular users only ever see approved plans.
    where.status = PLAN_STATUS.APPROVED;
  } else if (templates) {
    // Templates = any approved plan OR the planner's own (any status).
    where[Op.or] = [{ status: PLAN_STATUS.APPROVED }, { createdById: user.id }];
  } else {
    if (status) where.status = status;
    if (mine) where.createdById = user.id;
  }

  if (search) where.coachNo = { [Op.like]: `%${search}%` };
  if (trainNameId) where.trainNameId = trainNameId;

  const rows = await SeatPlan.findAll({
    where,
    include: INCLUDES,
    order: [["updated_at", "DESC"]],
  });

  // Omit the (potentially large) layout from list responses.
  return rows.map((p) => {
    const json = p.toPublicJSON();
    delete json.layout;
    return json;
  });
}

async function getPlan({ user, id }) {
  const plan = await findPlanOr404(id);
  if (!canSeeAll(user) && plan.status !== PLAN_STATUS.APPROVED) {
    throw ApiError.notFound("Plan not found");
  }
  return plan.toPublicJSON();
}

async function createPlan({ user, data }) {
  await assertRefsExist(data);
  const plan = await SeatPlan.create({
    coachNo: data.coachNo.trim(),
    trainNameId: data.trainNameId,
    coachTypeId: data.coachTypeId,
    coachClassId: data.coachClassId,
    layout: normalizeLayout(data.layout),
    status: PLAN_STATUS.DRAFT,
    createdById: user.id,
  });
  return getPlan({ user, id: plan.id });
}

async function updatePlan({ user, id, data }) {
  const plan = await findPlanOr404(id);

  if (data.trainNameId || data.coachTypeId || data.coachClassId) {
    await assertRefsExist({
      trainNameId: data.trainNameId ?? plan.trainNameId,
      coachTypeId: data.coachTypeId ?? plan.coachTypeId,
      coachClassId: data.coachClassId ?? plan.coachClassId,
    });
  }

  if (data.coachNo !== undefined) plan.coachNo = data.coachNo.trim();
  if (data.trainNameId !== undefined) plan.trainNameId = data.trainNameId;
  if (data.coachTypeId !== undefined) plan.coachTypeId = data.coachTypeId;
  if (data.coachClassId !== undefined) plan.coachClassId = data.coachClassId;
  if (data.layout !== undefined) plan.layout = normalizeLayout(data.layout);

  // Editing an already-approved plan sends it back for re-approval.
  if (plan.status === PLAN_STATUS.APPROVED) {
    plan.status = PLAN_STATUS.PENDING;
    plan.approvedById = null;
    plan.approvedAt = null;
  }

  await plan.save();
  return getPlan({ user, id: plan.id });
}

/** Planner submits a draft/rejected plan for approval (admins auto-approve). */
async function submitPlan({ user, id }) {
  const plan = await findPlanOr404(id);
  if (![PLAN_STATUS.DRAFT, PLAN_STATUS.REJECTED].includes(plan.status)) {
    throw ApiError.badRequest("Only draft or rejected plans can be submitted");
  }

  plan.rejectionReason = null;
  if (canApprove(user)) {
    plan.status = PLAN_STATUS.APPROVED;
    plan.approvedById = user.id;
    plan.approvedAt = new Date();
  } else {
    plan.status = PLAN_STATUS.PENDING;
  }

  await plan.save();
  return getPlan({ user, id: plan.id });
}

async function approvePlan({ user, id }) {
  const plan = await findPlanOr404(id);
  if (plan.status !== PLAN_STATUS.PENDING) {
    throw ApiError.badRequest("Only pending plans can be approved");
  }
  plan.status = PLAN_STATUS.APPROVED;
  plan.approvedById = user.id;
  plan.approvedAt = new Date();
  plan.rejectionReason = null;
  await plan.save();
  return getPlan({ user, id: plan.id });
}

async function rejectPlan({ user, id, reason }) {
  const plan = await findPlanOr404(id);
  if (plan.status !== PLAN_STATUS.PENDING) {
    throw ApiError.badRequest("Only pending plans can be rejected");
  }
  plan.status = PLAN_STATUS.REJECTED;
  plan.rejectionReason = reason.trim();
  plan.approvedById = null;
  plan.approvedAt = null;
  await plan.save();
  return getPlan({ user, id: plan.id });
}

async function deletePlan({ id }) {
  const plan = await SeatPlan.findByPk(id);
  if (!plan) throw ApiError.notFound("Plan not found");
  await plan.destroy();
  return { id: plan.id };
}

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
