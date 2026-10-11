/**
 * How long an approved subscription runs, as pure functions.
 *
 * A reviewer chooses either a number of days or a last day. Either way the
 * subscription is valid **through the end of its last day in Dhaka** — a
 * person told "until 9 November" can use it all of the 9th, wherever the
 * server's clock is.
 *
 * What is stored is `expiresAt`: the first instant it is no longer valid,
 * which is midnight in Dhaka at the start of the day after the last day.
 */
const { todayInDhaka, addDays, instantAt } = require("./dhakaTime");

/** The longest a single approval may run. */
const MAX_DAYS = 3650;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD — not 2026-02-31. */
function isCalendarDate(text) {
  if (typeof text !== "string" || !DATE.test(text)) return false;
  return addDays(text, 0) === text;
}

/** The instant a last day stops being valid: the start of the next day in Dhaka. */
function expiryOf(lastDay) {
  return instantAt(addDays(lastDay, 1), "00:00");
}

/** The last day an `expiresAt` covers, as YYYY-MM-DD in Dhaka. */
function lastDayOf(expiresAt) {
  return todayInDhaka(new Date(new Date(expiresAt).getTime() - 1));
}

/**
 * Turn a reviewer's choice into `{ lastDay, expiresAt }`.
 *
 * `days` counts from today in Dhaka: approving on the 10th for 30 days gives a
 * last day of the 9th of next month. `lastDay` is used as given. Returns
 * `{ error }` instead when the choice is not one a subscription can have.
 */
function resolvePeriod({ days, lastDay } = {}, now = new Date()) {
  const today = todayInDhaka(now);

  let chosen;
  if (lastDay !== undefined && lastDay !== null && lastDay !== "") {
    if (!isCalendarDate(lastDay)) return { error: "The last day must be a date, as YYYY-MM-DD" };
    chosen = lastDay;
  } else {
    const count = Number(days);
    if (!Number.isInteger(count) || count < 1) return { error: "Choose how many days, or a last day" };
    chosen = addDays(today, count);
  }

  if (chosen < today) return { error: "The last day cannot be in the past" };
  if (chosen > addDays(today, MAX_DAYS)) {
    return { error: `A subscription can run for at most ${MAX_DAYS} days` };
  }
  return { lastDay: chosen, expiresAt: expiryOf(chosen) };
}

module.exports = { MAX_DAYS, isCalendarDate, expiryOf, lastDayOf, resolvePeriod };
