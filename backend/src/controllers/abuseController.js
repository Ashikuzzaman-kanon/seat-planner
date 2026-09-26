const asyncHandler = require("../utils/asyncHandler");
const abuseService = require("../services/abuseService");

/**
 * Reports, scores and holds (§14).
 *
 * Thin, like the rest. The one thing decided here rather than in the service is
 * the status on a successful report: 201, because a report creates a record —
 * and deliberately *only* a record. Nothing about the response should suggest
 * that raising one has done anything to anybody.
 */

const reportTicket = asyncHandler(async (req, res) => {
  const report = await abuseService.report({
    ticketNumber: req.body.ticketNumber,
    kind: req.body.kind,
    detail: req.body.detail,
    stationId: req.body.stationId,
    reportedById: req.user.id,
  });
  res.status(201).json({
    message: "Reported. A reviewer will look at this; nothing has changed for the passenger yet.",
    report,
  });
});

const listReports = asyncHandler(async (req, res) => {
  res.json(
    await abuseService.queue({
      status: req.query.status || "open",
      page: Number(req.query.page) || 1,
      limit: Math.min(Number(req.query.limit) || 25, 100),
    })
  );
});

const reviewReport = asyncHandler(async (req, res) => {
  const result = await abuseService.review({
    reference: req.params.reference,
    uphold: req.body.decision === "uphold",
    note: req.body.note,
    reviewedById: req.user.id,
  });
  res.json({
    message: `Report ${result.report.status}`,
    ...result,
  });
});

/* ---------------- Accounts ---------------- */

const accountStanding = asyncHandler(async (req, res) => {
  res.json(await abuseService.standingFor(req.params.userId));
});

const heldAccounts = asyncHandler(async (req, res) => {
  res.json(
    await abuseService.heldAccounts({
      page: Number(req.query.page) || 1,
      limit: Math.min(Number(req.query.limit) || 25, 100),
    })
  );
});

const holdAccount = asyncHandler(async (req, res) => {
  const result = await abuseService.hold({
    userId: req.params.userId,
    reason: req.body.reason || abuseService.HOLD_REASON.MANUAL,
    detail: req.body.detail,
    placedById: req.user.id,
  });
  res.status(result.alreadyHeld ? 200 : 201).json({
    message: result.alreadyHeld ? "That account was already on hold" : "Account held",
    ...result,
  });
});

const releaseAccount = asyncHandler(async (req, res) => {
  const hold = await abuseService.release({
    userId: req.params.userId,
    releasedById: req.user.id,
    note: req.body.note,
  });
  res.json({ message: "Hold lifted", hold });
});

module.exports = {
  reportTicket,
  listReports,
  reviewReport,
  accountStanding,
  heldAccounts,
  holdAccount,
  releaseAccount,
};
