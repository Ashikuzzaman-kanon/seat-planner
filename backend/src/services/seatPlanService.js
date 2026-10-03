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
const { countSeats } = require("../utils/seatMaterializer");
const { PLAN_STATUS } = require("../constants/planStatus");
const { PERMISSIONS } = require("../constants/permissions");
const inbox = require("./inboxService");

/** "Ekota 705 · S_CHAIR-92", or as much of it as a draft has. */
const planLabel = (plan) => [plan.coachNo, plan.trainName?.name].filter(Boolean).join(" · ") || `plan #${plan.id}`;

/** Tell a plan's author what happened to it — unless they did it themselves. */
async function tellAuthor(plan, actor, notification) {
  if (!plan.createdById || plan.createdById === actor?.id) return;
  await inbox.tryAdd(plan.createdById, { category: inbox.CATEGORY.PLAN, link: `/dashboard/plans/${plan.id}`, ...notification });
}

// Eager-load reference names and authors for full plan responses.
const INCLUDES = [
  { model: TrainName, as: "trainName" },
  { model: CoachType, as: "coachType" },
  { model: CoachClass, as: "coachClass" },
  { model: User, as: "createdBy" },
  { model: User, as: "approvedBy" },
];

// Visibility follows permissions, not role names — `permissions` is the Set
// resolved per request by the auth middleware.
function canSeeAll(permissions) {
  // Anyone who can create plans can also see ones that aren't approved yet.
  return permissions.has(PERMISSIONS.PLAN_CREATE);
}

function canApprove(permissions) {
  return permissions.has(PERMISSIONS.PLAN_APPROVE);
}

/** Confirms whichever of train/type/class were chosen actually exist. Empty ones are a draft's business. */
async function assertRefsExist({ trainNameId, coachTypeId, coachClassId }) {
  const [train, type, klass] = await Promise.all([
    trainNameId == null ? true : TrainName.findByPk(trainNameId),
    coachTypeId == null ? true : CoachType.findByPk(coachTypeId),
    coachClassId == null ? true : CoachClass.findByPk(coachClassId),
  ]);
  if (!train) throw ApiError.badRequest("Selected train name does not exist");
  if (!type) throw ApiError.badRequest("Selected coach type does not exist");
  if (!klass) throw ApiError.badRequest("Selected coach class does not exist");
}

/** "" and whitespace are no coach number at all. */
const coachNoOrNull = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * What a plan still lacks before it can be submitted, in words. A draft may
 * be saved with any of these missing; a plan going to — or already in — the
 * approval queue may not, because an approved layout is what departures sell.
 */
function missingForSubmit(plan) {
  const missing = [];
  if (!plan.trainNameId) missing.push("a train");
  if (!plan.coachTypeId) missing.push("a coach type");
  if (!plan.coachClassId) missing.push("a coach class");
  if (!coachNoOrNull(plan.coachNo)) missing.push("a coach number");
  try {
    if (!countSeats(plan.layout)) missing.push("at least one numbered seat");
  } catch (err) {
    missing.push(`a layout without errors (${err.message})`);
  }
  return missing;
}

function assertComplete(plan, action) {
  const missing = missingForSubmit(plan);
  if (missing.length) {
    throw ApiError.badRequest(`Before it can be ${action}, this plan needs ${listInWords(missing)}.`);
  }
}

const listInWords = (items) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

async function findPlanOr404(id) {
  const plan = await SeatPlan.findByPk(id, { include: INCLUDES });
  if (!plan) throw ApiError.notFound("Plan not found");
  return plan;
}

/** List plans with permission-based visibility and optional filters. */
async function listPlans({ user, permissions, status, search = "", mine, templates, trainNameId }) {
  const where = {};

  if (!canSeeAll(permissions)) {
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

async function getPlan({ user, permissions, id }) {
  const plan = await findPlanOr404(id);
  if (!canSeeAll(permissions) && plan.status !== PLAN_STATUS.APPROVED) {
    throw ApiError.notFound("Plan not found");
  }
  return plan.toPublicJSON();
}

/** Every field is optional: a new plan is a draft. */
async function createPlan({ user, permissions, data }) {
  const fields = {
    coachNo: coachNoOrNull(data.coachNo),
    trainNameId: data.trainNameId ?? null,
    coachTypeId: data.coachTypeId ?? null,
    coachClassId: data.coachClassId ?? null,
  };
  await assertRefsExist(fields);
  const plan = await SeatPlan.create({
    ...fields,
    layout: normalizeLayout(data.layout),
    status: PLAN_STATUS.DRAFT,
    createdById: user.id,
  });
  return getPlan({ user, permissions, id: plan.id });
}

async function updatePlan({ user, permissions, id, data }) {
  const plan = await findPlanOr404(id);

  const next = {
    trainNameId: data.trainNameId !== undefined ? data.trainNameId : plan.trainNameId,
    coachTypeId: data.coachTypeId !== undefined ? data.coachTypeId : plan.coachTypeId,
    coachClassId: data.coachClassId !== undefined ? data.coachClassId : plan.coachClassId,
  };
  await assertRefsExist(next);

  if (data.coachNo !== undefined) plan.coachNo = coachNoOrNull(data.coachNo);
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

  // A draft or a sent-back plan may be left incomplete; one in the approval
  // queue may not be emptied out from under the reviewer.
  if (plan.status === PLAN_STATUS.PENDING) assertComplete(plan, "sent for approval");

  await plan.save();
  return getPlan({ user, permissions, id: plan.id });
}

/** Planner submits a draft/rejected plan for approval (admins auto-approve). */
async function submitPlan({ user, permissions, id }) {
  const plan = await findPlanOr404(id);
  if (![PLAN_STATUS.DRAFT, PLAN_STATUS.REJECTED].includes(plan.status)) {
    throw ApiError.badRequest("Only draft or rejected plans can be submitted");
  }
  assertComplete(plan, "submitted");

  plan.rejectionReason = null;
  if (canApprove(permissions)) {
    plan.status = PLAN_STATUS.APPROVED;
    plan.approvedById = user.id;
    plan.approvedAt = new Date();
  } else {
    plan.status = PLAN_STATUS.PENDING;
  }

  await plan.save();

  if (plan.status === PLAN_STATUS.PENDING) {
    await inbox.toHolders(
      PERMISSIONS.PLAN_APPROVE,
      {
        type: "plan.submitted",
        category: inbox.CATEGORY.PLAN,
        tone: "info",
        title: `Seat plan waiting for approval — ${planLabel(plan)}`,
        body: `${user.fullName || user.email} submitted it${plan.coachClass ? ` (${plan.coachClass.name})` : ""}.`,
        link: "/dashboard/approvals",
      },
      { except: [user.id] }
    );
  }

  return getPlan({ user, permissions, id: plan.id });
}

async function approvePlan({ user, permissions, id }) {
  const plan = await findPlanOr404(id);
  if (plan.status !== PLAN_STATUS.PENDING) {
    throw ApiError.badRequest("Only pending plans can be approved");
  }
  assertComplete(plan, "approved");
  plan.status = PLAN_STATUS.APPROVED;
  plan.approvedById = user.id;
  plan.approvedAt = new Date();
  plan.rejectionReason = null;
  await plan.save();
  await tellAuthor(plan, user, {
    type: "plan.approved",
    tone: "success",
    title: `Seat plan approved — ${planLabel(plan)}`,
    body: `Approved by ${user.fullName || user.email}. Coaches built from it now carry its seats on new departures.`,
  });
  return getPlan({ user, permissions, id: plan.id });
}

async function rejectPlan({ user, permissions, id, reason }) {
  const plan = await findPlanOr404(id);
  if (plan.status !== PLAN_STATUS.PENDING) {
    throw ApiError.badRequest("Only pending plans can be rejected");
  }
  plan.status = PLAN_STATUS.REJECTED;
  plan.rejectionReason = reason.trim();
  plan.approvedById = null;
  plan.approvedAt = null;
  await plan.save();
  await tellAuthor(plan, user, {
    type: "plan.rejected",
    tone: "warning",
    title: `Seat plan sent back — ${planLabel(plan)}`,
    body: `${user.fullName || user.email}: “${plan.rejectionReason}” Fix it and submit it again.`,
    link: `/dashboard/plans/${plan.id}/edit`,
  });
  return getPlan({ user, permissions, id: plan.id });
}

async function deletePlan({ id }) {
  const plan = await SeatPlan.findByPk(id);
  if (!plan) throw ApiError.notFound("Plan not found");
  await plan.destroy();
  return { id: plan.id };
}

module.exports = {
  missingForSubmit,
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  submitPlan,
  approvePlan,
  rejectPlan,
  deletePlan,
};
