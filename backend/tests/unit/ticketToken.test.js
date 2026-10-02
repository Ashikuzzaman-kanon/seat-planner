const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";
process.env.DB_NAME = process.env.DB_NAME || "seat_planner";
process.env.DB_USER = process.env.DB_USER || "root";

const { issue, verify, qrContent } = require("../../src/utils/ticketToken");

const TICKET = {
  ticketNumber: "TKT4H7K2M9",
  seatNumber: "12",
  coachCode: "KA",
  passengerName: "Rahim Uddin",
  passengerNid: "1990123456789",
};

const BOOKING = {
  reference: "K4M9YT",
  tripId: 77,
  fromStationId: 1,
  toStationId: 4,
  trip: { departureDate: "2026-10-02" },
};

test("a freshly issued token verifies", () => {
  const result = verify(issue(TICKET, BOOKING));
  assert.equal(result.valid, true, result.message);
});

test("it carries what a checker needs to judge the ticket", () => {
  const { ticket } = verify(issue(TICKET, BOOKING));
  assert.equal(ticket.ticketNumber, "TKT4H7K2M9");
  assert.equal(ticket.bookingReference, "K4M9YT");
  assert.equal(ticket.seatNumber, "12");
  assert.equal(ticket.coachCode, "KA");
  assert.equal(ticket.tripId, 77);
  assert.equal(ticket.departureDate, "2026-10-02");
  assert.equal(ticket.passengerName, "Rahim Uddin");
});

test("only the last four NID digits travel on the ticket", () => {
  const { ticket, payload } = verify(issue(TICKET, BOOKING));
  assert.equal(ticket.nidLastFour, "6789");
  assert.doesNotMatch(JSON.stringify(payload), /1990123456789/);
});

test("a tampered seat number is rejected", () => {
  const token = issue(TICKET, BOOKING);
  const [body, signature] = token.split(".");

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  payload.s = "1"; // a cheaper seat, upgraded by hand
  const forged = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const result = verify(`${forged}.${signature}`);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "bad_signature");
});

test("a re-signed payload from the wrong key is rejected", () => {
  const crypto = require("crypto");
  const body = Buffer.from(JSON.stringify({ v: 1, t: "FAKE" })).toString("base64url");
  const signature = crypto.createHmac("sha256", "not-the-real-secret").update(body).digest("base64url");

  const result = verify(`${body}.${signature}`);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "bad_signature");
});

test("a truncated signature is rejected rather than crashing", () => {
  const token = issue(TICKET, BOOKING);
  const result = verify(token.slice(0, token.length - 6));
  assert.equal(result.valid, false);
  assert.equal(result.reason, "bad_signature");
});

test("nonsense input is refused politely", () => {
  for (const input of ["", null, undefined, "hello", "a.b.c.d"]) {
    const result = verify(input);
    assert.equal(result.valid, false, `accepted ${JSON.stringify(input)}`);
    assert.ok(result.message, "no message for the checker to read");
  }
});

test("a payload with valid base64 but no JSON inside is refused", () => {
  const crypto = require("crypto");
  const body = Buffer.from("not json at all").toString("base64url");
  const signature = crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(body)
    .digest("base64url");

  const result = verify(`${body}.${signature}`);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "malformed");
});

test("a future format version is refused by name, not silently accepted", () => {
  const crypto = require("crypto");
  const body = Buffer.from(JSON.stringify({ v: 99, t: "X" })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(body)
    .digest("base64url");

  const result = verify(`${body}.${signature}`);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "version");
  assert.match(result.message, /v99/);
});

test("the token stays short enough to scan reliably", () => {
  // Well inside what a version-10 QR at medium correction holds. A long
  // passenger name is the realistic worst case.
  const token = issue({ ...TICKET, passengerName: "Mohammad Abdur Rahman Chowdhury" }, BOOKING);
  assert.ok(token.length < 300, `token is ${token.length} characters`);
});

test("two tickets never produce the same token", () => {
  const a = issue(TICKET, BOOKING);
  const b = issue({ ...TICKET, ticketNumber: "TKT9P2R4W7", seatNumber: "13" }, BOOKING);
  assert.notEqual(a, b);
});

test("qrContent encodes a scannable URL when one is configured", () => {
  const env = require("../../src/config/env");
  const original = env.ticket.verifyUrl;

  env.ticket.verifyUrl = "https://rail.example/verify";
  const token = issue(TICKET, BOOKING);
  assert.equal(qrContent(token), `https://rail.example/verify?t=${encodeURIComponent(token)}`);

  env.ticket.verifyUrl = "https://rail.example/verify?lang=bn";
  assert.match(qrContent(token), /\?lang=bn&t=/);

  env.ticket.verifyUrl = "";
  assert.equal(qrContent(token), token, "with no URL configured the bare token is encoded");

  env.ticket.verifyUrl = original;
});

test("a missing coach code does not break the token", () => {
  const result = verify(issue({ ...TICKET, coachCode: null }, BOOKING));
  assert.equal(result.valid, true);
  assert.equal(result.ticket.coachCode, "");
});
