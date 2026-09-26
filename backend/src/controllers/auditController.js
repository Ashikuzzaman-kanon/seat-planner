const asyncHandler = require("../utils/asyncHandler");
const auditService = require("../services/auditService");
const { AUDIT_ACTIONS } = require("../constants/auditActions");

const listEvents = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "25", 10), 1), 100);

  const result = await auditService.query({
    page,
    limit,
    action: req.query.action,
    actorId: req.query.actorId,
    entityType: req.query.entityType,
    entityId: req.query.entityId,
    excludeTests: req.query.excludeTests === "1" || req.query.excludeTests === "true",
  });

  res.json({
    ...result,
    // Lets the UI populate a filter dropdown without hardcoding the list.
    actions: Object.values(AUDIT_ACTIONS),
  });
});

module.exports = { listEvents };
