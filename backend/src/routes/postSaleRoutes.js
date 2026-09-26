const express = require("express");
const { body, param, query } = require("express-validator");
const c = require("../controllers/postSaleController");
const authenticate = require("../middleware/auth");
const { requirePermission, requireAnyPermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { PERMISSIONS } = require("../constants/permissions");
const { APPROVAL_TYPE, APPROVAL_STATUS } = require("../models/ApprovalRequest");

/**
 * After the sale.
 *
 * Two audiences on the same data. A passenger returns their own ticket and asks
 * for their own withdrawal; a reviewer works a queue of other people's
 * requests. The split is by permission rather than by path, so a support agent
 * who is also a passenger uses one set of endpoints for both.
 */

/* ---------------- Refunds ---------------- */
const refunds = express.Router();
refunds.use(authenticate);

const canReturn = requirePermission(PERMISSIONS.REFUND_REQUEST);
const canSeeRefunds = requireAnyPermission(
  PERMISSIONS.REFUND_REQUEST,
  PERMISSIONS.REFUND_VIEW_ALL
);

refunds.get(
  "/",
  canSeeRefunds,
  [query("page").optional().isInt({ min: 1 }), query("all").optional().isIn(["1", "true"])],
  validate,
  c.listRefunds
);

refunds.get(
  "/:reference",
  canSeeRefunds,
  [param("reference").isString().isLength({ min: 4, max: 20 })],
  validate,
  c.getRefund
);

/* ---------------- Returning a ticket ---------------- */
const tickets = express.Router();
tickets.use(authenticate);

// Priced before committing, because the two policies pay very differently
// depending on how close departure is.
tickets.get(
  "/:ticketId/refund-quote",
  canReturn,
  [param("ticketId").isInt()],
  validate,
  c.quoteRefund
);

tickets.post(
  "/:ticketId/refund",
  canReturn,
  [
    param("ticketId").isInt(),
    body("type").isIn(["convenient", "demand"]).withMessage("Choose a return type"),
  ],
  validate,
  c.requestRefund
);

/*
 * Connecting standing (§10).
 *
 * Hung off the seated ticket rather than off a trip, because that is the
 * prerequisite: standing is never sold on its own, and the seat decides which
 * coach you stand in, what the fare is a share of, and which legs even connect.
 */
tickets.get(
  "/:ticketId/standing",
  canReturn,
  [param("ticketId").isInt()],
  validate,
  c.standingOptions
);

tickets.post(
  "/:ticketId/standing",
  canReturn,
  [
    param("ticketId").isInt(),
    body("fromStationId").isInt().withMessage("Where would you board?"),
    body("toStationId").isInt().withMessage("Where would you get off?"),
    body("method").optional().isIn(["wallet", "gateway", "split"]),
  ],
  validate,
  c.buyStanding
);

tickets.post(
  "/:ticketId/transfer",
  canReturn,
  [
    param("ticketId").isInt(),
    body("toNid").matches(/^\d{10,17}$/).withMessage("The new National ID must be 10 to 17 digits"),
    body("toName").isString().trim().isLength({ min: 2, max: 120 }),
    body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  validate,
  c.requestTransfer
);

/* ---------------- Approvals ---------------- */
const approvals = express.Router();
approvals.use(authenticate);

// A passenger reaches their own requests here without holding APPROVAL_VIEW,
// which is the reviewer's permission.
approvals.get("/mine", c.myRequests);

approvals.get("/queues", requirePermission(PERMISSIONS.APPROVAL_VIEW), c.queues);

approvals.get(
  "/",
  requirePermission(PERMISSIONS.APPROVAL_VIEW),
  [
    query("type").optional().isIn(Object.values(APPROVAL_TYPE)),
    query("status").optional().isIn(Object.values(APPROVAL_STATUS)),
    query("page").optional().isInt({ min: 1 }),
  ],
  validate,
  c.listApprovals
);

approvals.get(
  "/:reference",
  requirePermission(PERMISSIONS.APPROVAL_VIEW),
  [param("reference").isString().isLength({ min: 4, max: 20 })],
  validate,
  c.getApproval
);

/*
 * Deciding needs the permission for the queue the request happens to be in, and
 * one endpoint cannot know that in advance — so the guard here only requires
 * being able to see the queue, and the controller checks the specific
 * permission once it knows the type.
 */
approvals.post(
  "/:reference/decide",
  requirePermission(PERMISSIONS.APPROVAL_VIEW),
  [
    param("reference").isString(),
    body("decision").isIn(["approve", "reject"]).withMessage("Approve or reject?"),
    body("note").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  validate,
  c.decide
);

// Withdrawing your own request needs no permission beyond having raised it.
approvals.post("/:reference/cancel", [param("reference").isString()], validate, c.cancelRequest);

module.exports = { refunds, tickets, approvals, requestWithdrawal: c.requestWithdrawal };
