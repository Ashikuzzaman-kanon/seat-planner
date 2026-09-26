const asyncHandler = require("../utils/asyncHandler");
const refundService = require("../services/refundService");
const approvalService = require("../services/approvalService");
const postSaleService = require("../services/postSaleService");
const standingService = require("../services/standingService");
const money = require("../utils/money");
const { PERMISSIONS } = require("../constants/permissions");

/**
 * Everything that happens after a ticket has been paid for.
 *
 * The permission checks here are about *scope*, not access: the route guard has
 * already decided the caller may be here at all, and these decide whether they
 * are looking at their own tickets or everyone's.
 */

const canSeeAllRefunds = (req) => req.permissions.has(PERMISSIONS.REFUND_VIEW_ALL);

/* ---------------- Refunds ---------------- */

/** Both policies priced side by side, which is the choice being made. */
const quoteRefund = asyncHandler(async (req, res) => {
  res.json(
    await refundService.quote({
      ticketId: req.params.ticketId,
      userId: req.user.id,
      canViewAll: canSeeAllRefunds(req),
    })
  );
});

const requestRefund = asyncHandler(async (req, res) => {
  const refund = await refundService.request({
    ticketId: req.params.ticketId,
    type: req.body.type,
    userId: req.user.id,
    canViewAll: canSeeAllRefunds(req),
  });

  res.status(201).json({
    message:
      refund.status === "settled"
        ? `${refund.refundedFormatted} credited to your wallet.`
        : `Seat back on sale. Up to ${refund.maximumFormatted} will be credited as it resells.`,
    refund,
  });
});

const listRefunds = asyncHandler(async (req, res) => {
  const all = canSeeAllRefunds(req) && (req.query.all === "1" || req.query.all === "true");
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);

  res.json(
    await refundService.list({
      userId: all ? null : req.user.id,
      canViewAll: canSeeAllRefunds(req),
      page,
    })
  );
});

const getRefund = asyncHandler(async (req, res) => {
  res.json({
    refund: await refundService.byReference(req.params.reference, {
      userId: req.user.id,
      canViewAll: canSeeAllRefunds(req),
    }),
  });
});

/* ---------------- Requests that need a person ---------------- */

const requestTransfer = asyncHandler(async (req, res) => {
  const request = await postSaleService.requestTransfer({
    ticketId: req.params.ticketId,
    toNid: req.body.toNid,
    toName: req.body.toName,
    reason: req.body.reason,
    userId: req.user.id,
  });

  res.status(201).json({
    message:
      `Transfer requested (${request.reference}). ` +
      "It needs approval before the ticket changes hands.",
    request,
  });
});

const requestWithdrawal = asyncHandler(async (req, res) => {
  const request = await postSaleService.requestWithdrawal({
    amountMinor: money.toMinor(req.body.amount),
    destination: req.body.destination,
    reason: req.body.reason,
    userId: req.user.id,
  });

  res.status(201).json({
    message: `Withdrawal requested (${request.reference}). It needs approval before the money moves.`,
    request,
  });
});

const myRequests = asyncHandler(async (req, res) => {
  res.json(
    await postSaleService.myRequests({
      userId: req.user.id,
      page: Math.max(parseInt(req.query.page || "1", 10), 1),
    })
  );
});

/* ---------------- Connecting standing ---------------- */

/** What could be added to this seated ticket, priced, both directions. */
const standingOptions = asyncHandler(async (req, res) => {
  res.json(
    await standingService.options({
      ticketId: req.params.ticketId,
      userId: req.user.id,
      canViewAll: req.permissions.has(PERMISSIONS.BOOKING_VIEW_ALL),
    })
  );
});

const buyStanding = asyncHandler(async (req, res) => {
  const result = await standingService.purchase({
    ticketId: req.params.ticketId,
    fromStationId: req.body.fromStationId,
    toStationId: req.body.toStationId,
    method: req.body.method,
    gatewayToken: req.body.gatewayToken,
    userId: req.user.id,
  });

  res.status(201).json({
    message:
      `Standing ticket added ${result.position} your seat. ` +
      `${result.remaining} place(s) left standing in that coach.`,
    ...result,
  });
});

/* ---------------- The queue ---------------- */

const listApprovals = asyncHandler(async (req, res) => {
  res.json(
    await approvalService.list({
      type: req.query.type,
      status: req.query.status,
      page: Math.max(parseInt(req.query.page || "1", 10), 1),
    })
  );
});

const getApproval = asyncHandler(async (req, res) => {
  res.json({
    request: await approvalService.get(req.params.reference, {
      userId: req.user.id,
      canViewAll: req.permissions.has(PERMISSIONS.APPROVAL_VIEW),
    }),
  });
});

const queues = asyncHandler(async (req, res) => {
  const catalogue = approvalService.catalogue();
  const counts = await approvalService.pendingCounts();

  res.json({
    queues: catalogue.map((queue) => ({
      ...queue,
      pending: counts[queue.type] || 0,
      // Whether *this* caller may act on it, so the screen can show a queue
      // read-only rather than hiding it.
      canDecide: req.permissions.has(queue.permission),
    })),
  });
});

/**
 * Approve or reject.
 *
 * The permission needed depends on which queue the request is in, so it is
 * checked here rather than on the route — one endpoint serving several queues
 * cannot know in advance which permission applies.
 */
const decide = asyncHandler(async (req, res) => {
  const existing = await approvalService.get(req.params.reference, { canViewAll: true });
  const queue = approvalService.catalogue().find((q) => q.type === existing.type);

  if (!queue || !req.permissions.has(queue.permission)) {
    return res.status(403).json({
      error: {
        message: `You do not have permission to decide ${queue?.label || "requests"} of this kind.`,
      },
    });
  }

  const approve = req.body.decision === "approve";
  const { request } = await approvalService.decide({
    reference: req.params.reference,
    approve,
    decidedBy: req.user,
    note: req.body.note,
  });

  res.json({
    message: `Request ${request.reference} ${request.status}.`,
    request: request.toPublicJSON(),
  });
});

const cancelRequest = asyncHandler(async (req, res) => {
  const request = await approvalService.cancel({
    reference: req.params.reference,
    userId: req.user.id,
  });
  res.json({ message: "Request withdrawn.", request: request.toPublicJSON() });
});

module.exports = {
  quoteRefund,
  requestRefund,
  listRefunds,
  getRefund,
  requestTransfer,
  requestWithdrawal,
  standingOptions,
  buyStanding,
  myRequests,
  listApprovals,
  getApproval,
  queues,
  decide,
  cancelRequest,
};
