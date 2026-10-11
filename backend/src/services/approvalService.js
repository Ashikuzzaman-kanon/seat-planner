const { Op } = require("sequelize");
const { sequelize, ApprovalRequest, User } = require("../models");
const { APPROVAL_TYPE, APPROVAL_STATUS } = require("../models/ApprovalRequest");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { approvalReference, unique } = require("../utils/reference");
const audit = require("./auditService");
const notify = require("./notificationService");
const inbox = require("./inboxService");

/**
 * The one approval mechanism (§16.1).
 *
 * Every kind of request registers a handler here. The handler owns the parts
 * that differ — whether the request is allowed to be made at all, and what
 * actually happens when someone says yes — and this module owns everything
 * that does not: the queue, the reference, who decided and when, the audit
 * trail, and the guarantee that two reviewers clicking approve at the same
 * moment cannot both act on it.
 *
 * That last point is why deciding runs inside a transaction with the row
 * locked. An approval that pays out money must happen once; a second reviewer
 * arriving a moment later gets a clear "already decided", not a second payout.
 *
 * A handler looks like:
 *
 *   register(type, {
 *     permission,                       // who may decide it
 *     describe(request) -> string,      // one line for the queue
 *     onApprove(request, ctx) -> any,   // inside the deciding transaction
 *     onReject(request, ctx) -> any,    // optional
 *   })
 */

const handlers = new Map();

function register(type, handler) {
  if (!Object.values(APPROVAL_TYPE).includes(type)) {
    throw new Error(`Unknown approval type: ${type}`);
  }
  handlers.set(type, handler);
}

function handlerFor(type) {
  const handler = handlers.get(type);
  if (!handler) throw new Error(`No handler registered for approval type "${type}"`);
  return handler;
}

/** What each queue is called and who may work it — for building the UI. */
function catalogue() {
  return [...handlers.entries()].map(([type, handler]) => ({
    type,
    label: handler.label || type,
    description: handler.description || null,
    permission: handler.permission,
  }));
}

/* ------------------------------------------------------------------ *
 * Raising a request
 * ------------------------------------------------------------------ */

/**
 * Open a request for someone to decide.
 *
 * `subject` identifies what it is about and carries a label, so the queue still
 * reads sensibly after the subject itself is gone.
 */
async function open({ type, subject, requestedById, reason, payload }) {
  const handler = handlerFor(type); // fail fast on an unregistered type

  const reference = await unique(approvalReference, async (candidate) =>
    Boolean(await ApprovalRequest.findOne({ where: { reference: candidate } }))
  );

  const request = await ApprovalRequest.create({
    reference,
    type,
    status: APPROVAL_STATUS.PENDING,
    subjectType: subject.type,
    subjectId: String(subject.id),
    subjectLabel: subject.label || null,
    requestedById,
    reason: reason || null,
    payload: payload || null,
  });

  await audit.record({
    action: AUDIT_ACTIONS.APPROVAL_REQUEST,
    entity: { type: "approval_request", id: request.id, label: request.reference },
    after: { type, subject: `${subject.type}:${subject.id}`, reason },
    message: `${type.replace(/_/g, " ")} requested for ${subject.label || subject.id}`,
  });

  // Everyone who can decide it, so it does not sit unseen in a queue nobody opened.
  const what = type.replace(/_/g, " ");
  await inbox.toHolders(
    handler.permission,
    {
      type: "approval.requested",
      category: inbox.CATEGORY.APPROVAL,
      tone: "info",
      title: `${what[0].toUpperCase()}${what.slice(1)} waiting for a decision — ${request.reference}`,
      body: [subject.label, reason && `“${reason}”`].filter(Boolean).join(" · "),
      link: "/dashboard/requests",
    },
    { except: [requestedById] }
  );

  return request;
}

/** Whether this subject already has a request waiting on someone. */
async function openRequestFor(type, subjectId) {
  return ApprovalRequest.findOne({
    where: { type, subjectId: String(subjectId), status: APPROVAL_STATUS.PENDING },
  });
}

/* ------------------------------------------------------------------ *
 * Deciding
 * ------------------------------------------------------------------ */

/**
 * Approve or reject, once.
 *
 * The row is locked and re-checked inside the transaction, so the decision and
 * whatever it triggers commit together. If the handler throws — an approved
 * withdrawal the wallet can no longer cover, say — the request stays pending
 * rather than being marked approved with nothing having happened.
 */
async function decide({ reference, approve, decidedBy, note }) {
  const outcome = await sequelize.transaction(async (transaction) => {
    const request = await ApprovalRequest.findOne({
      where: { reference },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!request) throw ApiError.notFound("No such request");
    if (request.status !== APPROVAL_STATUS.PENDING) {
      throw ApiError.conflict(
        `That request was already ${request.status}` +
          (request.decidedAt ? ` on ${new Date(request.decidedAt).toISOString().slice(0, 10)}` : "") +
          "."
      );
    }

    const handler = handlerFor(request.type);
    const context = { transaction, decidedBy, note };

    const result = approve
      ? await handler.onApprove?.(request, context)
      : await handler.onReject?.(request, context);

    await request.update(
      {
        status: approve ? APPROVAL_STATUS.APPROVED : APPROVAL_STATUS.REJECTED,
        decidedById: decidedBy.id,
        decidedAt: new Date(),
        decisionNote: note || null,
      },
      { transaction }
    );

    return { request, result };
  });

  await audit.record({
    action: approve ? AUDIT_ACTIONS.APPROVAL_APPROVE : AUDIT_ACTIONS.APPROVAL_REJECT,
    entity: {
      type: "approval_request",
      id: outcome.request.id,
      label: outcome.request.reference,
    },
    after: { status: outcome.request.status, note },
    message: `${outcome.request.type.replace(/_/g, " ")} ${outcome.request.status}${
      note ? ` — ${note}` : ""
    }`,
  });

  /*
   * Tell whoever raised it.
   *
   * One message for every approval type, because they are one mechanism
   * (§16.1) — the fourth type gets this for free. Sent after the transaction,
   * so nothing is announced that could still roll back, and the decision note
   * travels with it: "not approved" without a reason is the kind of message
   * that generates a support call instead of closing one.
   */
  notify.approvalDecided({
    userId: outcome.request.requestedById,
    request: outcome.request,
    approved: approve,
    note,
    decidedBy: decidedBy?.fullName || decidedBy?.email || null,
  });

  return outcome;
}

/**
 * Withdraw a request before anyone has acted on it.
 *
 * Only the person who raised it, and only while it is still open — a decided
 * request is a record, not a draft.
 */
async function cancel({ reference, userId }) {
  const request = await ApprovalRequest.findOne({ where: { reference } });
  if (!request) throw ApiError.notFound("No such request");

  if (request.requestedById !== userId) {
    throw ApiError.forbidden("That request belongs to someone else");
  }
  if (request.status !== APPROVAL_STATUS.PENDING) {
    throw ApiError.conflict(`That request was already ${request.status} and cannot be withdrawn.`);
  }

  const handler = handlerFor(request.type);
  await handler.onCancel?.(request);

  await request.update({ status: APPROVAL_STATUS.CANCELLED });

  await audit.record({
    action: AUDIT_ACTIONS.APPROVAL_CANCEL,
    entity: { type: "approval_request", id: request.id, label: request.reference },
    after: { status: request.status },
    message: `${request.type.replace(/_/g, " ")} withdrawn by the requester`,
  });

  return request;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const WITH_PEOPLE = [
  { model: User, as: "requestedBy", attributes: ["id", "email", "fullName"] },
  { model: User, as: "decidedBy", attributes: ["id", "email", "fullName"] },
];

async function list({ type, status, userId, page = 1, limit = 25 } = {}) {
  const where = {};
  if (type) where.type = type;
  if (status) where.status = status;
  if (userId) where.requestedById = Number(userId);

  const { rows, count } = await ApprovalRequest.findAndCountAll({
    where,
    include: WITH_PEOPLE,
    // Oldest open request first: a queue people work through, not a feed.
    order: [
      [sequelize.literal(`CASE WHEN status = '${APPROVAL_STATUS.PENDING}' THEN 0 ELSE 1 END`), "ASC"],
      ["createdAt", "ASC"],
    ],
    limit,
    offset: (page - 1) * limit,
  });

  return {
    requests: rows.map((r) => {
      const json = r.toPublicJSON();
      const handler = handlers.get(r.type);
      return { ...json, summary: handler?.describe ? handler.describe(r) : null };
    }),
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
  };
}

async function get(reference, { userId, canViewAll = false } = {}) {
  const request = await ApprovalRequest.findOne({ where: { reference }, include: WITH_PEOPLE });
  if (!request) throw ApiError.notFound("No such request");

  if (!canViewAll && userId && request.requestedById !== userId) {
    throw ApiError.notFound("No such request");
  }

  const handler = handlers.get(request.type);
  return { ...request.toPublicJSON(), summary: handler?.describe ? handler.describe(request) : null };
}

/** How many are waiting, per queue — the badge on the navigation. */
async function pendingCounts() {
  const rows = await ApprovalRequest.findAll({
    where: { status: APPROVAL_STATUS.PENDING },
    attributes: ["type", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
    group: ["type"],
    raw: true,
  });

  const counts = Object.fromEntries(Object.values(APPROVAL_TYPE).map((t) => [t, 0]));
  for (const row of rows) counts[row.type] = Number(row.count);
  return counts;
}

/** Requests a user raised recently — the abuse signal in §14 counts these. */
async function countRecentFor({ type, requestedById, sinceDays = 30 }) {
  return ApprovalRequest.count({
    where: {
      type,
      requestedById,
      createdAt: { [Op.gte]: new Date(Date.now() - sinceDays * 86_400_000) },
    },
  });
}

module.exports = {
  register,
  catalogue,
  open,
  openRequestFor,
  decide,
  cancel,
  list,
  get,
  pendingCounts,
  countRecentFor,
  APPROVAL_TYPE,
  APPROVAL_STATUS,
};
