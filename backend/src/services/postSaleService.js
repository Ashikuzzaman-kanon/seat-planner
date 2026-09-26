const { sequelize, Ticket, Booking, Wallet, User } = require("../models");
const { TICKET_STATUS } = require("../models/Ticket");
const { APPROVAL_TYPE } = require("../models/ApprovalRequest");
const { PERMISSIONS } = require("../constants/permissions");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const ApiError = require("../utils/ApiError");
const money = require("../utils/money");
const approvals = require("./approvalService");
const walletService = require("./walletService");
const audit = require("./auditService");

/**
 * The two things a passenger can ask for that a person has to agree to.
 *
 * Both are registered against the one approval mechanism rather than built as
 * features of their own, which is what §16.1 meant by the fourth costing
 * nothing: this file is entirely "what makes this request legitimate" and
 * "what happens when it is granted". The queue, the locking, the audit trail
 * and the reference all come from `approvalService`.
 *
 * ## Why these two need a human
 *
 * A **transfer** rewrites whose National ID a ticket belongs to. Automate it
 * and a ticket becomes a bearer instrument — buy cheap seats early, transfer
 * them to whoever pays most later. The approval is the friction that keeps a
 * ticket attached to a person.
 *
 * A **withdrawal** is the only way money leaves the system (§8.1). Everything
 * else moves credit around inside it. That makes this the one place where
 * someone cycling purchases and refunds to launder value has to be looked at
 * by a person.
 */

const NID = /^\d{10,17}$/;

/* ------------------------------------------------------------------ *
 * Ticket transfer
 * ------------------------------------------------------------------ */

async function requestTransfer({ ticketId, toNid, toName, reason, userId }) {
  const ticket = await Ticket.findByPk(ticketId, { include: [{ model: Booking, as: "booking" }] });
  if (!ticket) throw ApiError.notFound("Ticket not found");
  if (ticket.booking.userId !== userId) throw ApiError.notFound("Ticket not found");

  if (ticket.status !== TICKET_STATUS.VALID) {
    throw ApiError.badRequest(`That ticket is ${ticket.status} and cannot be transferred.`);
  }

  const nid = String(toNid || "").trim();
  const name = String(toName || "").trim();

  if (!NID.test(nid)) throw ApiError.badRequest("The new National ID must be 10 to 17 digits");
  if (name.length < 2) throw ApiError.badRequest("Give the new passenger's full name");
  if (nid === ticket.passengerNid) {
    throw ApiError.badRequest("That ticket is already in that National ID");
  }

  const existing = await approvals.openRequestFor(APPROVAL_TYPE.TICKET_TRANSFER, ticket.id);
  if (existing) {
    throw ApiError.conflict(
      `A transfer for that ticket is already waiting for a decision (${existing.reference}).`
    );
  }

  const request = await approvals.open({
    type: APPROVAL_TYPE.TICKET_TRANSFER,
    subject: {
      type: "ticket",
      id: ticket.id,
      label: `${ticket.ticketNumber} — ${ticket.passengerName}, seat ${ticket.seatNumber}`,
    },
    requestedById: userId,
    reason,
    payload: {
      fromName: ticket.passengerName,
      fromNid: ticket.passengerNid,
      toName: name,
      toNid: nid,
      ticketNumber: ticket.ticketNumber,
      seatNumber: ticket.seatNumber,
      coachCode: ticket.coachCode,
    },
  });

  return request.toPublicJSON();
}

approvals.register(APPROVAL_TYPE.TICKET_TRANSFER, {
  label: "Ticket transfers",
  description: "Moving a ticket into a different passenger's National ID.",
  permission: PERMISSIONS.APPROVAL_DECIDE_TRANSFER,

  describe: (request) => {
    const p = request.payload || {};
    return `${p.ticketNumber}: ${p.fromName} (…${String(p.fromNid || "").slice(-4)}) → ${
      p.toName
    } (…${String(p.toNid || "").slice(-4)})`;
  },

  /**
   * Rewrite the passenger on the ticket.
   *
   * Re-checked inside the deciding transaction: the ticket may have been used
   * or returned in the days the request sat in the queue, and approving then
   * would hand someone a ticket that no longer exists.
   */
  async onApprove(request, { transaction }) {
    const ticket = await Ticket.findByPk(request.subjectId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!ticket) throw ApiError.conflict("That ticket no longer exists.");
    if (ticket.status !== TICKET_STATUS.VALID) {
      throw ApiError.conflict(
        `That ticket became ${ticket.status} while the request was waiting, so it cannot be transferred.`
      );
    }

    const before = { name: ticket.passengerName, nid: ticket.passengerNid };
    const { toName, toNid } = request.payload || {};

    await ticket.update({ passengerName: toName, passengerNid: toNid }, { transaction });

    await audit.record({
      action: AUDIT_ACTIONS.TICKET_TRANSFER,
      entity: { type: "ticket", id: ticket.id, label: ticket.ticketNumber },
      before,
      after: { name: toName, nid: toNid },
      message: `${ticket.ticketNumber} transferred to ${toName}`,
    });

    return { ticketNumber: ticket.ticketNumber, passengerName: toName };
  },
});

/* ------------------------------------------------------------------ *
 * Wallet withdrawal
 * ------------------------------------------------------------------ */

/**
 * Ask to take credit out.
 *
 * The balance is checked now and again at approval. Checking twice is not
 * redundant: a passenger can spend between asking and being answered, and
 * paying out on a balance that has since been spent would overdraw the wallet.
 */
async function requestWithdrawal({ amountMinor, destination, reason, userId }) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw ApiError.badRequest("Enter an amount to withdraw");
  }

  const wallet = await walletService.forUser(userId);
  if (Number(wallet.balanceMinor) < amountMinor) {
    throw ApiError.badRequest(
      `Your balance is ${money.format(wallet.balanceMinor)}, which is less than the ` +
        `${money.format(amountMinor)} you asked to withdraw.`
    );
  }

  const account = String(destination || "").trim();
  if (account.length < 4) {
    throw ApiError.badRequest("Say where the money should go — an account or mobile number");
  }

  const pending = await approvals.openRequestFor(APPROVAL_TYPE.WALLET_WITHDRAWAL, wallet.id);
  if (pending) {
    throw ApiError.conflict(
      `You already have a withdrawal waiting for a decision (${pending.reference}).`
    );
  }

  const user = await User.findByPk(userId, { attributes: ["email"] });

  const request = await approvals.open({
    type: APPROVAL_TYPE.WALLET_WITHDRAWAL,
    subject: { type: "wallet", id: wallet.id, label: user?.email || `Wallet ${wallet.id}` },
    requestedById: userId,
    reason,
    payload: {
      amountMinor,
      amountFormatted: money.format(amountMinor),
      destination: account,
      balanceAtRequestMinor: Number(wallet.balanceMinor),
    },
  });

  return request.toPublicJSON();
}

approvals.register(APPROVAL_TYPE.WALLET_WITHDRAWAL, {
  label: "Wallet withdrawals",
  description: "Taking stored credit out of the system — the only exit for money.",
  permission: PERMISSIONS.APPROVAL_DECIDE_WITHDRAWAL,

  describe: (request) => {
    const p = request.payload || {};
    return `${p.amountFormatted} to ${p.destination}`;
  },

  /**
   * Debit the wallet.
   *
   * The debit happens inside the deciding transaction, so a wallet that can no
   * longer cover it throws and the request stays pending — the reviewer sees
   * why rather than the system recording an approval that paid out nothing.
   */
  async onApprove(request, { transaction, decidedBy }) {
    const { amountMinor, destination } = request.payload || {};

    const result = await walletService.post(
      {
        userId: request.requestedById,
        direction: walletService.DIRECTION.DEBIT,
        amountMinor,
        reason: walletService.REASON.WITHDRAWAL,
        referenceType: "approval",
        referenceId: request.reference,
        description: `Withdrawal to ${destination}, approved by ${decidedBy.email}`,
      },
      { transaction }
    );

    await audit.record({
      action: AUDIT_ACTIONS.WALLET_WITHDRAW,
      entity: { type: "wallet", id: request.subjectId, label: request.subjectLabel },
      after: {
        amount: money.format(amountMinor),
        destination,
        balance: money.format(result.balanceMinor),
      },
      message: `${money.format(amountMinor)} withdrawn to ${destination}`,
    });

    return { balanceMinor: result.balanceMinor };
  },
});

/* ------------------------------------------------------------------ *
 * What a passenger sees
 * ------------------------------------------------------------------ */

/** A passenger's own requests, whatever kind. */
async function myRequests({ userId, page = 1 }) {
  return approvals.list({ userId, page });
}

module.exports = { requestTransfer, requestWithdrawal, myRequests };
