const { Op } = require("sequelize");
const { sequelize, Wallet, WalletTransaction, User } = require("../models");
const { WALLET_STATUS } = require("../models/Wallet");
const { DIRECTION, REASON } = require("../models/WalletTransaction");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const money = require("../utils/money");
const settings = require("./settingService");
const audit = require("./auditService");

/**
 * The wallet ledger.
 *
 * Two rules hold everything else up:
 *
 *   1. **Nothing is ever edited.** Every movement appends a row. A mistake is
 *      corrected by appending its opposite, so the record of what happened
 *      survives the correction.
 *   2. **The balance is only ever changed under a row lock**, in the same
 *      transaction that appends the entry. Two concurrent debits therefore
 *      queue rather than both reading the same starting balance — which is how
 *      a wallet gets overdrawn in systems that skip this.
 */

/** Every user has exactly one wallet; it is created the first time it is needed. */
async function forUser(userId, options = {}) {
  const [wallet] = await Wallet.findOrCreate({
    where: { userId: Number(userId) },
    defaults: { userId: Number(userId), balanceMinor: 0 },
    transaction: options.transaction,
  });
  return wallet;
}

/**
 * Append one entry and move the balance, atomically.
 *
 * `SELECT … FOR UPDATE` on the wallet row is the whole trick: concurrent
 * callers serialise on it, so each one reads a balance that already includes
 * everything committed before it.
 */
async function post(
  { userId, direction, amountMinor, reason, referenceType, referenceId, description, allowOverdraft = false },
  options = {}
) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw ApiError.badRequest("A wallet movement must be a positive whole number of poisha");
  }

  const run = async (transaction) => {
    const wallet = await forUser(userId, { transaction });

    // Re-read under a lock. Anything committed between findOrCreate and here
    // is now visible, and nobody else can move this balance until we commit.
    const locked = await Wallet.findByPk(wallet.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const current = Number(locked.balanceMinor);
    const delta = direction === DIRECTION.CREDIT ? amountMinor : -amountMinor;
    const next = current + delta;

    if (direction === DIRECTION.DEBIT) {
      if (locked.status === WALLET_STATUS.FROZEN) {
        throw ApiError.badRequest("This wallet is frozen and cannot be spent from");
      }
      if (next < 0 && !allowOverdraft) {
        throw ApiError.badRequest(
          `Not enough wallet balance: ${money.format(current)} available, ${money.format(amountMinor)} needed`
        );
      }
    }

    if (direction === DIRECTION.CREDIT) {
      const cap = money.toMinor(settings.get("wallet.max_balance"));
      if (cap > 0 && next > cap) {
        throw ApiError.badRequest(
          `That would take the wallet past its ${money.format(cap)} limit ` +
            `(currently ${money.format(current)})`
        );
      }
    }

    const entry = await WalletTransaction.create(
      {
        walletId: locked.id,
        direction,
        amountMinor,
        balanceAfterMinor: next,
        reason,
        referenceType: referenceType || null,
        referenceId: referenceId != null ? String(referenceId) : null,
        description: description || null,
      },
      { transaction }
    );

    await locked.update({ balanceMinor: next }, { transaction });

    return { wallet: locked, entry, balanceMinor: next };
  };

  return options.transaction ? run(options.transaction) : sequelize.transaction(run);
}

/* ------------------------------------------------------------------ *
 * The named movements
 * ------------------------------------------------------------------ */

/** Add credit. In this build the gateway is simulated; the ledger is not. */
async function topUp({ userId, amountMinor, reference, actorLabel }) {
  const minimum = money.toMinor(settings.get("wallet.min_topup"));
  if (amountMinor < minimum) {
    throw ApiError.badRequest(`The smallest top-up is ${money.format(minimum)}`);
  }

  const result = await post({
    userId,
    direction: DIRECTION.CREDIT,
    amountMinor,
    reason: REASON.TOPUP,
    referenceType: "gateway",
    referenceId: reference,
    description: "Wallet top-up",
  });

  await audit.record({
    action: AUDIT_ACTIONS.WALLET_TOPUP,
    entity: { type: "wallet", id: result.wallet.id, label: `User ${userId}` },
    after: { amount: money.format(amountMinor), balance: money.format(result.balanceMinor) },
    message: `${actorLabel || "top-up"} of ${money.format(amountMinor)}`,
  });

  return result;
}

/** Spend from the wallet. Called inside the booking transaction, never alone. */
async function charge({ userId, amountMinor, bookingId, description }, options = {}) {
  return post(
    {
      userId,
      direction: DIRECTION.DEBIT,
      amountMinor,
      reason: REASON.BOOKING,
      referenceType: "booking",
      referenceId: bookingId,
      description: description || "Ticket purchase",
    },
    options
  );
}

/** Put money back. Phase 6 refunds land here. */
async function refund({ userId, amountMinor, bookingId, description }, options = {}) {
  return post(
    {
      userId,
      direction: DIRECTION.CREDIT,
      amountMinor,
      reason: REASON.REFUND,
      referenceType: "booking",
      referenceId: bookingId,
      description: description || "Refund",
    },
    options
  );
}

/**
 * An administrative correction.
 *
 * Appends an entry like everything else — there is deliberately no way to edit
 * or delete history, so a correction is itself part of the record.
 */
async function adjust({ userId, amountMinor, direction, description, actingUser }) {
  const result = await post({
    userId,
    direction,
    amountMinor,
    reason: REASON.ADJUSTMENT,
    referenceType: "adjustment",
    referenceId: actingUser?.id,
    description: description || "Manual adjustment",
    // An adjustment is deliberate, so it may take a balance negative if that is
    // what the correction requires.
    allowOverdraft: true,
  });

  await audit.record({
    action: AUDIT_ACTIONS.WALLET_ADJUST,
    entity: { type: "wallet", id: result.wallet.id, label: `User ${userId}` },
    after: {
      direction,
      amount: money.format(amountMinor),
      balance: money.format(result.balanceMinor),
      description,
    },
    message: `${direction} of ${money.format(amountMinor)}: ${description || "no reason given"}`,
  });

  return result;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

async function summary(userId) {
  const wallet = await forUser(userId);
  return wallet.toPublicJSON();
}

async function history(userId, { page = 1, limit = 25 } = {}) {
  const wallet = await forUser(userId);

  const { rows, count } = await WalletTransaction.findAndCountAll({
    where: { walletId: wallet.id },
    order: [["id", "DESC"]],
    limit,
    offset: (page - 1) * limit,
  });

  return {
    wallet: wallet.toPublicJSON(),
    transactions: rows.map((r) => r.toPublicJSON()),
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
  };
}

/**
 * Re-sum the ledger and compare it against the cached balance.
 *
 * The cache exists so a balance can be read without summing a lifetime of
 * rows; this proves the two have not diverged. A mismatch means a balance was
 * written outside `post`, which is the bug worth finding immediately.
 */
async function verify(userId) {
  const wallet = await forUser(userId);

  const entries = await WalletTransaction.findAll({
    where: { walletId: wallet.id },
    attributes: ["direction", "amountMinor"],
    raw: true,
  });

  const ledgerMinor = entries.reduce(
    (total, e) => total + (e.direction === DIRECTION.CREDIT ? 1 : -1) * Number(e.amountMinor),
    0
  );

  const cachedMinor = Number(wallet.balanceMinor);

  return {
    walletId: wallet.id,
    entries: entries.length,
    ledgerMinor,
    cachedMinor,
    ledger: money.format(ledgerMinor),
    cached: money.format(cachedMinor),
    consistent: ledgerMinor === cachedMinor,
  };
}

/** Verify every wallet at once — the check a scheduled job would run. */
async function verifyAll() {
  const wallets = await Wallet.findAll({ attributes: ["userId"], raw: true });
  const results = [];
  for (const w of wallets) results.push(await verify(w.userId));

  return {
    checked: results.length,
    inconsistent: results.filter((r) => !r.consistent),
  };
}

module.exports = {
  forUser,
  post,
  topUp,
  charge,
  refund,
  adjust,
  summary,
  history,
  verify,
  verifyAll,
  DIRECTION,
  REASON,
};
