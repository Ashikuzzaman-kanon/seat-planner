const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_DAYS,
  isCalendarDate,
  expiryOf,
  lastDayOf,
  resolvePeriod,
} = require("../../src/utils/subscriptionPeriod");

/**
 * How long an approved subscription runs: through the end of its last day in
 * Dhaka, whichever way the reviewer chose it and wherever the server's clock is.
 */

// 10 Oct 2026, 15:00 in Dhaka (UTC+6).
const NOW = new Date("2026-10-10T09:00:00Z");

test("a last day is valid through the end of that day in Dhaka", () => {
  const expiresAt = expiryOf("2026-11-09");
  // Midnight starting the 10th in Dhaka is 18:00 UTC on the 9th.
  assert.equal(expiresAt.toISOString(), "2026-11-09T18:00:00.000Z");
  assert.equal(lastDayOf(expiresAt), "2026-11-09");
  // One second before, it is still the last day; at the instant itself, it is over.
  assert.equal(lastDayOf(new Date(expiresAt.getTime() - 1000)), "2026-11-09");
});

test("days count from today in Dhaka", () => {
  const period = resolvePeriod({ days: 30 }, NOW);
  assert.equal(period.lastDay, "2026-11-09");
  assert.equal(period.expiresAt.toISOString(), "2026-11-09T18:00:00.000Z");
});

test("today in Dhaka is not always today on the server", () => {
  // 20:30 UTC on the 10th is already 02:30 on the 11th in Dhaka.
  const period = resolvePeriod({ days: 1 }, new Date("2026-10-10T20:30:00Z"));
  assert.equal(period.lastDay, "2026-10-12");
});

test("a chosen last day is used as given", () => {
  const period = resolvePeriod({ lastDay: "2026-12-31" }, NOW);
  assert.equal(period.lastDay, "2026-12-31");
  assert.equal(lastDayOf(period.expiresAt), "2026-12-31");
});

test("a last day wins when both are given", () => {
  assert.equal(resolvePeriod({ days: 7, lastDay: "2026-10-20" }, NOW).lastDay, "2026-10-20");
});

test("today is allowed as the last day — it runs until midnight", () => {
  const period = resolvePeriod({ lastDay: "2026-10-10" }, NOW);
  assert.equal(period.lastDay, "2026-10-10");
  assert.ok(period.expiresAt > NOW);
});

test("the past is refused", () => {
  assert.match(resolvePeriod({ lastDay: "2026-10-09" }, NOW).error, /past/);
});

test("nothing chosen is refused", () => {
  assert.match(resolvePeriod({}, NOW).error, /how many days/);
  assert.match(resolvePeriod({ days: 0 }, NOW).error, /how many days/);
  assert.match(resolvePeriod({ days: 2.5 }, NOW).error, /how many days/);
  assert.match(resolvePeriod({ days: "soon" }, NOW).error, /how many days/);
});

test("a period has a longest length", () => {
  assert.equal(resolvePeriod({ days: MAX_DAYS }, NOW).error, undefined);
  assert.match(resolvePeriod({ days: MAX_DAYS + 1 }, NOW).error, /at most/);
  assert.match(resolvePeriod({ lastDay: "2099-01-01" }, NOW).error, /at most/);
});

test("only real calendar dates are dates", () => {
  assert.equal(isCalendarDate("2026-02-28"), true);
  assert.equal(isCalendarDate("2028-02-29"), true);
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("2026-13-01"), false);
  assert.equal(isCalendarDate("09-11-2026"), false);
  assert.equal(isCalendarDate("2026-11-9"), false);
  assert.equal(isCalendarDate(20261109), false);
  assert.equal(isCalendarDate(null), false);
  assert.match(resolvePeriod({ lastDay: "2026-02-31" }, NOW).error, /must be a date/);
});
