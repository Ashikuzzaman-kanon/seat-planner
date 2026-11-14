/**
 * Demo 7: an issue that only happens in a different environment.
 *
 * "Which day is it?" decides which departures are on sale. Asked of the
 * computer's own clock, the answer depends on the timezone it runs in: a
 * laptop in Dhaka and a server in UTC disagree for six hours every night. The
 * project avoids this with utils/dhakaTime.js; `naiveToday` below is the bug
 * it prevents.
 *
 * Run it twice with different TZ values (the two run configurations do that):
 *   TZ=Asia/Dhaka   like the developer's laptop: both answers agree
 *   TZ=UTC          like the server on Render: they disagree
 * DEMO_NOW pins the moment, so the demo works at any time of day:
 *   2026-11-15T20:00:00Z is 2 a.m. on 16 November in Dhaka.
 */
const { todayInDhaka } = require("../../backend/src/utils/dhakaTime");

const now = process.env.DEMO_NOW ? new Date(process.env.DEMO_NOW) : new Date();

/** The bug: the HOST's calendar date, in whatever timezone the host is set to. */
function naiveToday(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const naive = naiveToday(now);
const dhaka = todayInDhaka(now);

console.log(`TZ variable      ${process.env.TZ || "(not set)"}`);
console.log(`host timezone    ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
console.log(`the moment       ${now.toISOString()}`);
console.log(`naive "today"    ${naive}`);
console.log(`Dhaka "today"    ${dhaka}`);
console.log(naive === dhaka
  ? "same answer: the bug cannot be seen here"
  : "DIFFERENT: here the naive code would put the wrong day's trains on sale");
