const asyncHandler = require("../utils/asyncHandler");
const auditService = require("../services/auditService");
const analysis = require("../services/auditAnalysisService");
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

/** The log analysed: counted by operation, person, time… (services/auditAnalysisService). */
const analyse = asyncHandler(async (req, res) => {
  res.json(await analysis.analyse(req.query));
});

const analysisSheet = asyncHandler(async (req, res) => {
  const text = await analysis.csv(req.query);
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", 'attachment; filename="audit-analysis.csv"');
  res.send(text);
});

/** People in the log, found by part of a name or email. */
const people = asyncHandler(async (req, res) => {
  res.json({ people: await analysis.people(req.query.q) });
});

module.exports = { listEvents, analyse, analysisSheet, people };
