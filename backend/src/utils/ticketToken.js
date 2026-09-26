const crypto = require("crypto");
const env = require("../config/env");

/**
 * The signed payload printed inside a ticket's QR code.
 *
 * A ticket checker on a moving train has no reliable network. So the QR carries
 * everything needed to judge the ticket — who, which seat, which stretch of
 * which departure — with a signature proving the railway issued it. A forged
 * ticket fails the signature; a real one verifies with no database at all.
 *
 * What this deliberately cannot tell you is whether the ticket has since been
 * cancelled or already scanned. That is mutable state, it lives in the
 * database, and no self-contained token can know it. Phase 7's checker
 * reconciles against a downloaded manifest when it has one and falls back to
 * signature-only when it does not.
 *
 * ## On the signature
 *
 * HMAC-SHA256, which is symmetric: anything that can verify a ticket can also
 * mint one. That is fine while only the server verifies. Handing the secret to
 * scanner hardware in the field would not be — at that point this becomes
 * Ed25519 and scanners get the public half. The payload shape does not change
 * when that happens, only `sign` and `verify` below.
 *
 * Kept small on purpose: a QR's error correction degrades as the payload grows,
 * and a ticket gets scanned in bad light on a crumpled page. Field names are
 * one or two characters for that reason, not to be clever.
 */

const VERSION = 1;
const ALGORITHM = "sha256";

const b64url = (buffer) => Buffer.from(buffer).toString("base64url");
const fromB64url = (text) => Buffer.from(String(text), "base64url");

function sign(body) {
  return crypto.createHmac(ALGORITHM, env.ticket.signingSecret).update(body).digest();
}

/**
 * Build the token for one ticket.
 *
 * @param ticket  the issued ticket
 * @param booking its booking, for the PNR and the journey
 */
function issue(ticket, booking) {
  const payload = {
    v: VERSION,
    t: ticket.ticketNumber,
    b: booking.reference,
    p: booking.tripId,
    s: ticket.seatNumber,
    c: ticket.coachCode || "",
    f: booking.fromStationId,
    o: booking.toStationId,
    // The day this passenger travels. For a leg joined after midnight that is
    // not the day the trip is filed under, and a checker comparing a ticket
    // against today's date has to see the one the passenger is travelling on.
    d: booking.boardingDate || booking.trip?.departureDate || null,
    n: ticket.passengerName,
    // Last four NID digits only. Enough for a checker to match against the card
    // in a passenger's hand; useless to anyone who photographs the ticket.
    i: String(ticket.passengerNid || "").slice(-4),
    a: Math.floor(Date.now() / 1000),
  };

  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(sign(body))}`;
}

/**
 * Check a token and return what it says.
 *
 * Compares signatures in constant time — a byte-by-byte comparison leaks how
 * much of a forged signature was right, which is enough to construct a valid
 * one given enough attempts.
 */
function verify(token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) {
    return { valid: false, reason: "malformed", message: "That is not a ticket code." };
  }

  const expected = sign(body);
  const given = fromB64url(signature);

  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { valid: false, reason: "bad_signature", message: "This ticket was not issued by us." };
  }

  let payload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed", message: "That is not a ticket code." };
  }

  if (payload.v !== VERSION) {
    return {
      valid: false,
      reason: "version",
      message: `This ticket uses format v${payload.v}, which this reader does not understand.`,
    };
  }

  return {
    valid: true,
    payload,
    ticket: {
      ticketNumber: payload.t,
      bookingReference: payload.b,
      tripId: payload.p,
      seatNumber: payload.s,
      coachCode: payload.c,
      fromStationId: payload.f,
      toStationId: payload.o,
      departureDate: payload.d,
      passengerName: payload.n,
      nidLastFour: payload.i,
      issuedAt: new Date(payload.a * 1000).toISOString(),
    },
  };
}

/** What the QR actually encodes: a URL when one is configured, else the token. */
function qrContent(token) {
  const base = env.ticket.verifyUrl;
  if (!base) return token;
  return `${base}${base.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
}

module.exports = { issue, verify, qrContent, VERSION };
