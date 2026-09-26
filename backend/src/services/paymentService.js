const { Payment } = require("../models");
const { PROVIDER, PAYMENT_STATUS } = require("../models/Payment");
const ApiError = require("../utils/ApiError");
const money = require("../utils/money");
const { gatewayReference } = require("../utils/reference");
const walletService = require("./walletService");

/**
 * Payment providers, behind one interface.
 *
 * Booking never names a provider; it asks this module to cover an amount and
 * gets back the captured payments. That is what lets a real gateway replace the
 * simulation later without the booking transaction changing at all — and what
 * lets wallet-plus-card work without either source knowing about the other.
 *
 * Every provider implements:
 *   capture({ userId, amountMinor, bookingId, context }, options) -> { reference }
 *   reverse({ payment, userId }, options)
 */

const walletProvider = {
  name: PROVIDER.WALLET,
  label: "Wallet",

  async capture({ userId, amountMinor, bookingId }, options) {
    const result = await walletService.charge(
      { userId, amountMinor, bookingId, description: "Ticket purchase" },
      options
    );
    return { reference: `WTX-${result.entry.id}` };
  },

  async reverse({ payment, userId }, options) {
    await walletService.refund(
      {
        userId,
        amountMinor: payment.amountMinor,
        bookingId: payment.bookingId,
        description: "Reversal",
      },
      options
    );
  },
};

/**
 * A stand-in for bKash, SSLCommerz or a card processor.
 *
 * It succeeds unless handed the token `fail`, which exists so the unhappy path
 * can be exercised deliberately rather than only in production. Everything a
 * real provider would do — network call, redirect, webhook — happens here, so
 * swapping one in touches this file and nothing else.
 */
const gatewayProvider = {
  name: PROVIDER.GATEWAY,
  label: "Card / mobile banking (simulated)",

  async capture({ amountMinor, context }) {
    if (context?.gatewayToken === "fail") {
      throw ApiError.badRequest("The payment was declined by the provider");
    }
    if (amountMinor <= 0) {
      throw ApiError.badRequest("Nothing to charge");
    }
    return { reference: gatewayReference() };
  },

  async reverse() {
    // A real provider would call its refund endpoint here.
    return;
  },
};

const PROVIDERS = { [PROVIDER.WALLET]: walletProvider, [PROVIDER.GATEWAY]: gatewayProvider };

/**
 * Cover `totalMinor` for a booking, drawing on the wallet first when asked.
 *
 * Splitting is the default rather than an option because it is what a person
 * expects: spend the credit they already have, put the rest on a card. The
 * split arithmetic lives in the money module, where it is unit-tested.
 *
 * Runs inside the caller's transaction — the booking's — so a provider failure
 * rolls the whole purchase back, seats included.
 */
async function collect({ userId, bookingId, totalMinor, method = "wallet", context = {} }, options = {}) {
  if (totalMinor <= 0) throw ApiError.badRequest("Nothing to pay");

  const wallet = await walletService.forUser(userId, options);
  const available = method === "gateway" ? 0 : Number(wallet.balanceMinor);
  const { fromFirst: fromWallet, remainder: fromGateway } = money.split(totalMinor, available);

  if (method === "wallet" && fromGateway > 0) {
    throw ApiError.badRequest(
      `Wallet balance is ${money.format(available)}, which is short of ${money.format(totalMinor)}. ` +
        `Top up, or choose to split the payment.`
    );
  }

  const captured = [];

  for (const [provider, amountMinor] of [
    [PROVIDER.WALLET, fromWallet],
    [PROVIDER.GATEWAY, fromGateway],
  ]) {
    if (amountMinor <= 0) continue;

    const { reference } = await PROVIDERS[provider].capture(
      { userId, amountMinor, bookingId, context },
      options
    );

    captured.push(
      await Payment.create(
        {
          bookingId,
          provider,
          amountMinor,
          status: PAYMENT_STATUS.CAPTURED,
          reference,
        },
        { transaction: options.transaction }
      )
    );
  }

  const total = money.sum(captured.map((p) => p.amountMinor));
  if (total !== totalMinor) {
    // Belt and braces: if this ever fires, the split arithmetic is wrong and
    // the transaction must not commit.
    throw new Error(`Payment total ${total} does not match the ${totalMinor} owed`);
  }

  return captured;
}

/** What a passenger can choose from, and whether their wallet covers it. */
async function methodsFor({ userId, totalMinor }) {
  const wallet = await walletService.forUser(userId);
  const balance = Number(wallet.balanceMinor);

  return {
    walletBalanceMinor: balance,
    walletBalance: money.format(balance),
    options: [
      {
        method: "wallet",
        label: "Wallet",
        available: balance >= totalMinor,
        detail:
          balance >= totalMinor
            ? `${money.format(balance)} available`
            : `Short by ${money.format(totalMinor - balance)}`,
      },
      {
        method: "split",
        label: "Wallet, then card",
        available: balance > 0 && balance < totalMinor,
        detail:
          balance > 0 && balance < totalMinor
            ? `${money.format(balance)} from wallet, ${money.format(totalMinor - balance)} on card`
            : "Only when the wallet covers part of the fare",
      },
      {
        method: "gateway",
        label: "Card / mobile banking",
        available: true,
        detail: `${money.format(totalMinor)} on card`,
      },
    ],
  };
}

module.exports = { collect, methodsFor, PROVIDERS, PROVIDER };
