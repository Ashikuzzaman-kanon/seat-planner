const { Op } = require("sequelize");
const {
  sequelize,
  SeatPlan,
  TrainName,
  TrainCoach,
  CoachType,
  CoachClass,
  User,
} = require("../models");
const audit = require("./auditService");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
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
  { model: SeatPlan, as: "revision", attributes: ["id", "status", "rejectionReason"] },
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

/** The trains whose coaches use a plan, by name. */
async function trainsUsing(planId) {
  const rows = await TrainCoach.findAll({
    where: { seatPlanId: planId },
    include: [{ model: TrainName, as: "train", attributes: ["name"] }],
  });
  return [...new Set(rows.map((r) => r.train?.name).filter(Boolean))];
}

/**
 * A train has one plan per coach number: EKOTA EXPRESS (705), coach KA. An
 * editable copy of a plan stands for that plan, so it is not a second one;
 * a template is never one at all.
 *
 * The refusal names the plan in the way (code PLAN_COACH_TAKEN), so the
 * editor can offer what to do about it: replace it, move it to templates,
 * change its details, or keep the new one as a template.
 */
async function assertCoachFree(plan) {
  if (plan.isTemplate) return;
  const coachNo = coachNoOrNull(plan.coachNo);
  if (!plan.trainNameId || !coachNo) return;
  const self = plan.revisionOfId || plan.id || 0;
  const other = await SeatPlan.findOne({
    where: { trainNameId: plan.trainNameId, coachNo, revisionOfId: null, isTemplate: false, id: { [Op.ne]: self } },
    include: [
      { model: TrainName, as: "trainName", attributes: ["name"] },
      { model: SeatPlan, as: "revision", attributes: ["id", "status"] },
    ],
  });
  if (other) {
    const error = ApiError.conflict(`${other.trainName?.name || "That train"} already has a seat plan for coach ${coachNo}`);
    error.code = "PLAN_COACH_TAKEN";
    error.details = {
      plan: {
        id: other.id,
        status: other.status,
        coachNo: other.coachNo,
        trainNameId: other.trainNameId,
        trainName: other.trainName?.name || null,
        revision: other.revision ? { id: other.revision.id, status: other.revision.status } : null,
      },
      usedBy: await trainsUsing(other.id),
    };
    throw error;
  }
}

/** A template is not a plan in service: no submitting, approving or copies to change it through. */
function assertNotTemplate(plan, action) {
  if (plan.isTemplate) {
    throw ApiError.badRequest(`A template is never ${action} — it is not used by trains. Move it back to plans first.`);
  }
}

const planEntity = (plan) => ({ type: "seat_plan", id: plan.id, label: planLabel(plan) });

async function findPlanOr404(id) {
  const plan = await SeatPlan.findByPk(id, { include: INCLUDES });
  if (!plan) throw ApiError.notFound("Plan not found");
  return plan;
}

/** List plans with permission-based visibility and optional filters. */
async function listPlans({ user, permissions, status, search = "", mine, templates, kind, trainNameId }) {
  const where = {};

  if (!canSeeAll(permissions)) {
    // Regular users only ever see approved plans — never templates.
    where.status = PLAN_STATUS.APPROVED;
    where.isTemplate = false;
  } else if (templates) {
    // What a new plan can start from: every template, any approved plan, or
    // the planner's own — not an editable copy, which is a plan being changed.
    where[Op.or] = [{ isTemplate: true }, { status: PLAN_STATUS.APPROVED }, { createdById: user.id }];
    where.revisionOfId = null;
  } else {
    // The plans, or (kind=templates) the templates.
    where.isTemplate = kind === "templates";
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
  if (!canSeeAll(permissions) && (plan.status !== PLAN_STATUS.APPROVED || plan.isTemplate)) {
    throw ApiError.notFound("Plan not found");
  }
  return plan.toPublicJSON();
}

/** Every field is optional: a new plan is a draft — or a template, saved as it is. */
async function createPlan({ user, permissions, data }) {
  const fields = {
    coachNo: coachNoOrNull(data.coachNo),
    trainNameId: data.trainNameId ?? null,
    coachTypeId: data.coachTypeId ?? null,
    coachClassId: data.coachClassId ?? null,
    isTemplate: Boolean(data.isTemplate),
  };
  await assertRefsExist(fields);
  await assertCoachFree(fields);
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
  // A template is changed as it is: nothing uses it.
  if (plan.status === PLAN_STATUS.APPROVED && !plan.isTemplate) {
    throw ApiError.conflict(
      "An approved plan is changed through an editable copy, so it keeps working until the changes are approved. Open one with Edit."
    );
  }

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
  if (data.trainNameId !== undefined || data.coachNo !== undefined) await assertCoachFree(plan);

  // A draft or a sent-back plan may be left incomplete; one in the approval
  // queue may not be emptied out from under the reviewer.
  if (plan.status === PLAN_STATUS.PENDING) assertComplete(plan, "sent for approval");

  await plan.save();
  return getPlan({ user, permissions, id: plan.id });
}

/**
 * Open an editable copy of an approved plan — or the one already open.
 *
 * The approved plan keeps being used (new departures, coaches added on the
 * day) while the copy is drafted and reviewed; approving the copy puts its
 * content into the plan, under the plan's own id, and the copy goes.
 */
async function revise({ user, permissions, id }) {
  const plan = await findPlanOr404(id);
  assertNotTemplate(plan, "changed through a copy");
  if (plan.revisionOfId) throw ApiError.badRequest("This is already an editable copy of an approved plan");
  if (plan.status !== PLAN_STATUS.APPROVED) {
    throw ApiError.badRequest("Only an approved plan is changed through a copy. This one can be edited as it is.");
  }
  if (plan.revision) return { plan: await getPlan({ user, permissions, id: plan.revision.id }), opened: false };

  let copy;
  try {
    copy = await SeatPlan.create({
      coachNo: plan.coachNo,
      trainNameId: plan.trainNameId,
      coachTypeId: plan.coachTypeId,
      coachClassId: plan.coachClassId,
      layout: plan.layout,
      status: PLAN_STATUS.DRAFT,
      createdById: user.id,
      revisionOfId: plan.id,
    });
  } catch (err) {
    // Opened by somebody else a moment ago: that one is the copy.
    if (err.name !== "SequelizeUniqueConstraintError") throw err;
    copy = await SeatPlan.findOne({ where: { revisionOfId: plan.id } });
    return { plan: await getPlan({ user, permissions, id: copy.id }), opened: false };
  }
  return { plan: await getPlan({ user, permissions, id: copy.id }), opened: true };
}

/**
 * Put a plan into service. A plan of its own is simply approved. An editable
 * copy is folded into the plan it copies — same id, so every train and
 * departure that uses the plan keeps pointing at it — and then removed.
 * Returns the plan now in service.
 */
async function putIntoService(plan, approver) {
  if (!plan.revisionOfId) {
    plan.status = PLAN_STATUS.APPROVED;
    plan.approvedById = approver.id;
    plan.approvedAt = new Date();
    plan.rejectionReason = null;
    await plan.save();
    return plan;
  }

  await assertCoachFree(plan);
  return sequelize.transaction(async (transaction) => {
    const original = await SeatPlan.findByPk(plan.revisionOfId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!original) throw ApiError.notFound("The plan this copy changes no longer exists");
    original.set({
      coachNo: plan.coachNo,
      trainNameId: plan.trainNameId,
      coachTypeId: plan.coachTypeId,
      coachClassId: plan.coachClassId,
      layout: plan.layout,
      status: PLAN_STATUS.APPROVED,
      approvedById: approver.id,
      approvedAt: new Date(),
      rejectionReason: null,
    });
    await original.save({ transaction });
    await plan.destroy({ transaction });
    return original;
  });
}

/** Planner submits a draft/rejected plan for approval (admins auto-approve). */
async function submitPlan({ user, permissions, id }) {
  const plan = await findPlanOr404(id);
  assertNotTemplate(plan, "submitted");
  if (![PLAN_STATUS.DRAFT, PLAN_STATUS.REJECTED].includes(plan.status)) {
    throw ApiError.badRequest("Only draft or rejected plans can be submitted");
  }
  assertComplete(plan, "submitted");
  await assertCoachFree(plan);

  plan.rejectionReason = null;
  if (canApprove(permissions)) {
    const inService = await putIntoService(plan, user);
    return getPlan({ user, permissions, id: inService.id });
  }

  plan.status = PLAN_STATUS.PENDING;
  await plan.save();

  const changes = Boolean(plan.revisionOfId);
  await inbox.toHolders(
    PERMISSIONS.PLAN_APPROVE,
    {
      type: "plan.submitted",
      category: inbox.CATEGORY.PLAN,
      tone: "info",
      title: `${changes ? "Changes to a seat plan" : "Seat plan"} waiting for approval — ${planLabel(plan)}`,
      body: `${user.fullName || user.email} submitted ${changes ? "changes to an approved plan" : "it"}${plan.coachClass ? ` (${plan.coachClass.name})` : ""}.`,
      link: "/dashboard/approvals",
    },
    { except: [user.id] }
  );

  return getPlan({ user, permissions, id: plan.id });
}

async function approvePlan({ user, permissions, id }) {
  const plan = await findPlanOr404(id);
  if (plan.status !== PLAN_STATUS.PENDING) {
    throw ApiError.badRequest("Only pending plans can be approved");
  }
  assertComplete(plan, "approved");
  const changes = Boolean(plan.revisionOfId);
  const inService = await putIntoService(plan, user);
  await tellAuthor(plan, user, {
    type: "plan.approved",
    tone: "success",
    title: `${changes ? "Changes to a seat plan" : "Seat plan"} approved — ${planLabel(plan)}`,
    body: changes
      ? `Approved by ${user.fullName || user.email}. The plan now has your changes; new departures carry them, and departures already generated keep their seats.`
      : `Approved by ${user.fullName || user.email}. Coaches built from it now carry its seats on new departures.`,
    link: `/dashboard/plans/${inService.id}`,
  });
  return getPlan({ user, permissions, id: inService.id });
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

/* ------------------------------------------------------------------ *
 * Templates, and plans that clash
 * ------------------------------------------------------------------ */

/**
 * Move plans to templates — one or several. Each on its own: one refused does
 * not stop the rest. Refused: a plan a train's coaches use (replace it there
 * first), one with changes waiting, an editable copy, and — without the right
 * to approve — one in service.
 */
async function moveToTemplates({ user, permissions, ids }) {
  const results = [];
  for (const id of [...new Set(ids.map(Number))]) {
    try {
      const plan = await findPlanOr404(id);
      if (plan.isTemplate) {
        results.push({ id, ok: true, label: planLabel(plan), note: "already a template" });
        continue;
      }
      if (plan.revisionOfId) throw ApiError.badRequest("This is an editable copy of a plan — throw it away instead");
      if (plan.revision) throw ApiError.conflict("It has changes waiting — finish them or throw them away first");
      if (plan.status === PLAN_STATUS.APPROVED && !canApprove(permissions)) {
        throw ApiError.forbidden("Taking an approved plan out of use needs the right to approve plans");
      }
      const trains = await trainsUsing(plan.id);
      if (trains.length) {
        throw ApiError.conflict(`${trains.join(", ")} ${trains.length === 1 ? "has" : "have"} it among ${trains.length === 1 ? "its" : "their"} coaches — put another plan there first`);
      }
      const before = { status: plan.status, isTemplate: false };
      plan.isTemplate = true;
      // Out of the approval queue: a template is never approved.
      if (plan.status === PLAN_STATUS.PENDING) plan.status = PLAN_STATUS.DRAFT;
      await plan.save();
      await audit.record({
        action: AUDIT_ACTIONS.PLAN_TEMPLATE,
        entity: planEntity(plan),
        before,
        after: { status: plan.status, isTemplate: true },
        message: `${planLabel(plan)} moved to templates by ${user.fullName || user.email}`,
      });
      results.push({ id, ok: true, label: planLabel(plan) });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      results.push({ id, ok: false, reason: err.message });
    }
  }
  return results;
}

/** A template back among the plans — where its train and coach must be free. */
async function restoreFromTemplates({ user, permissions, id }) {
  const plan = await findPlanOr404(id);
  if (!plan.isTemplate) throw ApiError.badRequest("This is a plan already, not a template");
  if (plan.status === PLAN_STATUS.APPROVED && !canApprove(permissions)) {
    throw ApiError.forbidden("Putting an approved plan back into use needs the right to approve plans");
  }
  plan.isTemplate = false;
  await assertCoachFree(plan);
  await plan.save();
  await audit.record({
    action: AUDIT_ACTIONS.PLAN_RESTORE,
    entity: planEntity(plan),
    before: { isTemplate: true },
    after: { isTemplate: false, status: plan.status },
    message: `${planLabel(plan)} moved back to plans by ${user.fullName || user.email}`,
  });
  return getPlan({ user, permissions, id: plan.id });
}

/**
 * Change a plan's train or coach number, to make room for another. A plan in
 * use keeps every train and departure that has it (they point at its id);
 * changing one needs the right to approve plans. Changes waiting on it follow.
 */
async function changeDetails({ user, permissions, id, data }) {
  const plan = await findPlanOr404(id);
  if (plan.revisionOfId) throw ApiError.badRequest("Change the plan itself, not its editable copy");
  if (plan.status === PLAN_STATUS.APPROVED && !plan.isTemplate && !canApprove(permissions)) {
    throw ApiError.forbidden("Changing an approved plan's train or coach needs the right to approve plans");
  }
  const next = {
    id: plan.id,
    isTemplate: plan.isTemplate,
    coachNo: data.coachNo !== undefined ? coachNoOrNull(data.coachNo) : plan.coachNo,
    trainNameId: data.trainNameId !== undefined ? data.trainNameId : plan.trainNameId,
  };
  if (next.coachNo === plan.coachNo && next.trainNameId === plan.trainNameId) {
    throw ApiError.badRequest("Nothing would change — give it another coach number or train");
  }
  await assertRefsExist({ trainNameId: next.trainNameId, coachTypeId: plan.coachTypeId, coachClassId: plan.coachClassId });
  await assertCoachFree(next);
  const before = { coachNo: plan.coachNo, train: plan.trainName?.name || null };
  await sequelize.transaction(async (transaction) => {
    await plan.update({ coachNo: next.coachNo, trainNameId: next.trainNameId }, { transaction });
    if (plan.revision) {
      await SeatPlan.update({ coachNo: next.coachNo, trainNameId: next.trainNameId }, { where: { id: plan.revision.id }, transaction });
    }
  });
  const after = await findPlanOr404(plan.id);
  await audit.record({
    action: AUDIT_ACTIONS.PLAN_DETAILS,
    entity: planEntity(after),
    before,
    after: { coachNo: after.coachNo, train: after.trainName?.name || null },
    message: `${planLabel(after)} (was ${[before.coachNo, before.train].filter(Boolean).join(" · ")}) — changed to make room`,
  });
  return after.toPublicJSON();
}

/**
 * Replace a plan in use with a new layout: the new one becomes the plan's
 * editable copy, so it goes through approval as any change does, and on
 * approval takes the plan's place under the plan's own id — every train and
 * departure keeps it. The plan as it is now is kept as a template.
 *
 * `data` is the new plan, as the editor has it; `planId` a draft of it
 * already saved, which becomes the copy rather than a new one.
 */
async function replaceWith({ user, permissions, id, data, planId }) {
  const original = await findPlanOr404(id);
  if (original.isTemplate || original.revisionOfId) throw ApiError.badRequest("Only a plan in use is replaced this way");
  if (original.status !== PLAN_STATUS.APPROVED) {
    throw ApiError.badRequest("Only an approved plan is replaced through approval — move this one to templates instead");
  }
  if (original.revision) throw ApiError.conflict("It has changes waiting already — open those instead");

  const fields = {
    coachNo: original.coachNo,
    trainNameId: original.trainNameId,
    coachTypeId: data.coachTypeId !== undefined ? data.coachTypeId ?? null : original.coachTypeId,
    coachClassId: data.coachClassId !== undefined ? data.coachClassId ?? null : original.coachClassId,
    layout: normalizeLayout(data.layout),
  };
  await assertRefsExist(fields);

  const draft = planId ? await findPlanOr404(planId) : null;
  if (draft) {
    if (draft.isTemplate || draft.revisionOfId || ![PLAN_STATUS.DRAFT, PLAN_STATUS.REJECTED].includes(draft.status)) {
      throw ApiError.badRequest("Only a draft can become the new layout of a plan");
    }
  }

  let copy;
  let kept;
  try {
    await sequelize.transaction(async (transaction) => {
      kept = await SeatPlan.create(
        {
          coachNo: original.coachNo,
          trainNameId: original.trainNameId,
          coachTypeId: original.coachTypeId,
          coachClassId: original.coachClassId,
          layout: original.layout,
          status: PLAN_STATUS.DRAFT,
          isTemplate: true,
          createdById: user.id,
        },
        { transaction }
      );
      if (draft) {
        copy = await draft.update({ ...fields, revisionOfId: original.id, status: PLAN_STATUS.DRAFT, rejectionReason: null }, { transaction });
      } else {
        copy = await SeatPlan.create(
          { ...fields, status: PLAN_STATUS.DRAFT, createdById: user.id, revisionOfId: original.id },
          { transaction }
        );
      }
    });
  } catch (err) {
    if (err.name !== "SequelizeUniqueConstraintError") throw err;
    throw ApiError.conflict("Somebody has just opened changes to it — open those instead");
  }

  await audit.record({
    action: AUDIT_ACTIONS.PLAN_REPLACE,
    entity: planEntity(original),
    after: { copyId: copy.id, templateId: kept.id },
    message: `a new layout for ${planLabel(original)} waits for approval; the one in use is kept as a template`,
  });
  return { plan: await getPlan({ user, permissions, id: copy.id }), templateId: kept.id };
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
  revise,
  submitPlan,
  approvePlan,
  rejectPlan,
  deletePlan,
  moveToTemplates,
  restoreFromTemplates,
  changeDetails,
  replaceWith,
};
