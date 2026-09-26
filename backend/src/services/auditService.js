const AuditEvent = require("../models/mongo/AuditEvent");
const { isMongoConnected } = require("../config/mongo");
const { getContext } = require("../utils/requestContext");

/**
 * Writes to the audit log.
 *
 * Auditing must never be the reason a legitimate action fails, so `record` is
 * deliberately non-throwing: if MongoDB is unavailable the event is dropped
 * with a warning and the caller proceeds. That is the same graceful-degradation
 * stance the rest of the document features take.
 */
async function record({ action, entity, before, after, outcome = "success", message }) {
  if (!isMongoConnected()) {
    console.warn(`[audit] skipped "${action}" — document store unavailable`);
    return null;
  }

  const ctx = getContext();

  try {
    return await AuditEvent.create({
      action,
      actor: {
        id: ctx.actor?.id ?? null,
        email: ctx.actor?.email ?? null,
        roles: ctx.actor?.roles ?? [],
      },
      entity: {
        type: entity?.type ?? null,
        id: entity?.id != null ? String(entity.id) : null,
        label: entity?.label ?? null,
      },
      before: before ?? null,
      after: after ?? null,
      outcome,
      message: message ?? null,
      context: {
        requestId: ctx.requestId ?? null,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        method: ctx.method ?? null,
        path: ctx.path ?? null,
      },
    });
  } catch (err) {
    console.error(`[audit] failed to record "${action}": ${err.message}`);
    return null;
  }
}

/** Paginated, filterable read of the log, newest first. */
async function query({ page = 1, limit = 25, action, actorId, entityType, entityId, excludeTests } = {}) {
  if (!isMongoConnected()) {
    return { events: [], pagination: { page, limit, total: 0, pages: 0 }, available: false };
  }

  const filter = {};
  if (action) filter.action = action;
  if (actorId) filter["actor.id"] = Number(actorId);
  if (entityType) filter["entity.type"] = entityType;
  if (entityId) filter["entity.id"] = String(entityId);

  // The automated suites run as dedicated `unittest-` accounts precisely so
  // their noise can be told apart from what people actually did.
  if (excludeTests) filter["actor.email"] = { $not: /^unittest-/ };

  const [events, total] = await Promise.all([
    AuditEvent.find(filter)
      .sort({ at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditEvent.countDocuments(filter),
  ]);

  return {
    events,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    available: true,
  };
}

module.exports = { record, query };
