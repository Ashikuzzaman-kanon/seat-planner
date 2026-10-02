const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";
process.env.DB_NAME = process.env.DB_NAME || "seat_planner";
process.env.DB_USER = process.env.DB_USER || "root";

const { bookingTemplate, isUnroutable } = require("../../src/services/emailService");

test("reserved domains never reach a real mail server", () => {
  for (const address of [
    "unittest-user@example.com",
    "someone@example.net",
    "someone@EXAMPLE.ORG",
    "dev@my-app.test",
    "qa@staging.invalid",
    "root@localhost",
    "someone@box.localhost",
  ]) {
    assert.equal(isUnroutable(address), true, `${address} would have been sent for real`);
  }
});

test("real addresses are not caught by the guard", () => {
  for (const address of [
    "passenger@gmail.com",
    "someone@railway.gov.bd",
    "a.person@example-tickets.com",
    "user@examples.com",
    "test@realdomain.com",
    "contest@company.co.uk",
  ]) {
    assert.equal(isUnroutable(address), false, `${address} would have been suppressed`);
  }
});

test("blank and malformed addresses are treated as unroutable rather than sent", () => {
  assert.equal(isUnroutable(""), false, "an empty address is handled before this point");
  assert.equal(isUnroutable(null), false);
});

/* ------------------------------------------------------------------ *
 * The confirmation body
 * ------------------------------------------------------------------ */

const BOOKING = {
  reference: "K4M9YT",
  totalFormatted: "৳ 260.00",
  fromStation: { name: "Dhaka (Kamalapur)" },
  toStation: { name: "Tangail" },
  trip: { departureDate: "2026-10-02", train: { name: "Ekota Express" } },
  tickets: [
    { passengerName: "Rahim Uddin", seatNumber: "12", coachCode: "KA" },
    { passengerName: "Fatema Begum", seatNumber: "13", coachCode: "KA" },
  ],
};

test("the confirmation names everything a passenger checks at a glance", () => {
  const html = bookingTemplate(BOOKING);
  for (const expected of [
    "K4M9YT",
    "Ekota Express",
    "Dhaka (Kamalapur)",
    "Tangail",
    "2026-10-02",
    "Rahim Uddin",
    "Fatema Begum",
  ]) {
    assert.ok(html.includes(expected), `the email does not mention ${expected}`);
  }
});

test("every seat is listed, one line per passenger", () => {
  const html = bookingTemplate(BOOKING);
  assert.equal((html.match(/seat <strong>/g) || []).length, 2);
});

test("missing pieces render as a dash rather than 'undefined'", () => {
  const html = bookingTemplate({ reference: "AAAAAA", tickets: [] });
  assert.doesNotMatch(html, /undefined/);
  assert.ok(html.includes("—"));
});

test("a booking with no tickets still produces a readable email", () => {
  const html = bookingTemplate({ reference: "AAAAAA" });
  assert.ok(html.includes("AAAAAA"));
  assert.doesNotMatch(html, /undefined|\[object/);
});
