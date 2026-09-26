/**
 * Calendar helpers pinned to Asia/Dhaka.
 *
 * Departure dates are calendar dates in the operator's timezone, not instants.
 * A server running in UTC would otherwise roll the horizon over six hours early
 * and generate the wrong day — so "today" is asked of Dhaka, never of the host.
 *
 * Dates are handled as YYYY-MM-DD strings throughout: parsing them into Date
 * objects is what introduces timezone drift in the first place.
 */
const TIMEZONE = "Asia/Dhaka";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's calendar date in Dhaka, as YYYY-MM-DD. */
function todayInDhaka(now = new Date()) {
  return formatter.format(now);
}

/** Add (or subtract) whole days to a YYYY-MM-DD string, staying a calendar date. */
function addDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  // UTC arithmetic on a bare calendar date has no daylight-saving or offset to
  // trip over — the string goes in and comes back shifted by exactly `days`.
  const utc = Date.UTC(year, month - 1, day);
  const moved = new Date(utc + days * 86_400_000);
  return moved.toISOString().slice(0, 10);
}

/** Day of the week for a calendar date: 0 = Sunday, matching `Date#getDay`. */
function dayOfWeek(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The horizon: `days` calendar dates starting today in Dhaka. */
function horizonDates(days, from = todayInDhaka()) {
  return Array.from({ length: days }, (_, i) => addDays(from, i));
}

/**
 * The actual instant a local Dhaka date and time refers to.
 *
 * Dhaka is UTC+6 year round with no daylight saving, so the offset can be
 * stated literally rather than looked up. `dayOffset` handles a stop reached
 * after midnight.
 */
function instantAt(dateString, timeString, dayOffset = 0) {
  if (!dateString || !timeString) return null;
  const date = addDays(dateString, dayOffset);
  const time = timeString.length === 5 ? `${timeString}:00` : timeString;
  const instant = new Date(`${date}T${time}+06:00`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

const DAY_NAMES = Object.freeze([
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]);

module.exports = {
  TIMEZONE,
  todayInDhaka,
  addDays,
  dayOfWeek,
  horizonDates,
  instantAt,
  DAY_NAMES,
};
