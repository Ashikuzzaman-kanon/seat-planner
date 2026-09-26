const crypto = require("crypto");

/**
 * Human-facing identifiers: booking references and ticket numbers.
 *
 * These get read aloud down a phone line, copied off a printed ticket, and
 * typed by a checker on a moving train. So the alphabet excludes every pair
 * people confuse — O/0, I/1/L, S/5, B/8 — which costs a little entropy and
 * saves a great deal of misreading.
 *
 * Uniqueness is guaranteed by the unique constraint in the database, not by
 * hope: the generator is random, and the caller retries on a collision.
 */

/** 27 characters: A–Z and 2–9, minus the ambiguous ones. */
const ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";

function randomCode(length) {
  // rejection-free: 25 divides evenly enough that modulo bias is negligible,
  // but a rejection loop keeps it exactly uniform.
  const out = [];
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      if (byte >= 250) continue; // 250 = 25 * 10, so the rest is unbiased
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === length) break;
    }
  }
  return out.join("");
}

/** A booking reference — the PNR a passenger quotes. Six characters. */
function bookingReference() {
  return randomCode(6);
}

/**
 * A ticket number. Prefixed so it is recognisable out of context, and grouped
 * so it can be read aloud in chunks.
 */
function ticketNumber() {
  return `T${randomCode(4)}-${randomCode(4)}`;
}

/** An opaque handle for a checkout in progress. */
function holdReference() {
  return `H${randomCode(10)}`;
}

/**
 * A returned ticket, and a request waiting on a human.
 *
 * Prefixed like the others so a reference quoted over a phone says what it is
 * before anyone looks it up.
 */
function refundReference() {
  return `R${randomCode(8)}`;
}

function approvalReference() {
  return `AP${randomCode(8)}`;
}

/** A place in a queue. */
function waitlistReference() {
  return `W${randomCode(8)}`;
}

/** A checker's report against a ticket. */
function reportReference() {
  return `RP${randomCode(8)}`;
}

/** A simulated payment gateway's own reference. */
function gatewayReference() {
  return `SIM-${Date.now().toString(36).toUpperCase()}-${randomCode(4)}`;
}

/**
 * Generate, then check for a clash, retrying a few times.
 *
 * A collision on six random characters is vanishingly unlikely, but "unlikely"
 * is not "impossible" and a duplicate PNR would be a genuinely confusing bug.
 */
async function unique(generate, exists, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const candidate = generate();
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error("Could not generate a unique reference after several attempts");
}

module.exports = {
  ALPHABET,
  randomCode,
  bookingReference,
  ticketNumber,
  holdReference,
  gatewayReference,
  refundReference,
  approvalReference,
  waitlistReference,
  reportReference,
  unique,
};
