// Continuing a subscription that ended — run out, cancelled, declined: a
// reviewer continues it for a new period (the same record, active again, what
// it was kept in its history), the person is told; the person asks to
// continue it (the same record, waiting again, queued from when they asked);
// one running or waiting is not continued; a later ending is told again.
const BACKEND = require("path").resolve(__dirname, "../../..");
const { UserSubscription } = require(`${BACKEND}/src/models`);
const subscriptions = require(`${BACKEND}/src/services/subscriptionService`);
const { todayInDhaka, addDays } = require(`${BACKEND}/src/utils/dhakaTime`);

const BASE = process.env.API_BASE;
const PASSWORD = "UnitTest123!";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}
const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: PASSWORD } })).body;
const say = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 260)}`;
const message = (r) => r.body?.error?.message || "";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const inboxOf = async (token, type) =>
  (await call("GET", "/notifications?limit=50", { token })).body.notifications.filter((n) => !type || n.type === type);

(async () => {
  const su = await login("unittest-super1@example.com");
  const user = await login("unittest-user@example.com");
  const other = await login("unittest-planner@example.com");
  const [st, ut, ot] = [su, user, other].map((x) => x.accessToken);
  const today = todayInDhaka();

  const sub = (await call("POST", "/subscriptions", { token: st, body: { name: "Continue Test", code: "continue-test" } })).body.subscription;
  const second = (await call("POST", "/subscriptions", { token: st, body: { name: "Second Test", code: "second-test" } })).body.subscription;
  const member = async (id) => (await call("GET", `/subscriptions/members?search=unittest`, { token: st })).body.members.find((m) => m.id === id);

  console.log("== run out, continued ==");
  const r = (await call("POST", `/subscriptions/${sub.id}/requests`, { token: ut })).body.subscription;
  await call("POST", `/subscriptions/members/${r.id}/approve`, { token: st, body: { days: 10 } });
  await UserSubscription.update({ expiresAt: new Date(Date.now() - 60_000) }, { where: { id: r.id } });
  check("(it has run out)", (await member(r.id)).status === "expired");
  check("a passenger cannot continue it", (await call("POST", `/subscriptions/members/${r.id}/resume`, { token: ut, body: { days: 5 } })).status === 403);
  const lastDay = addDays(today, 20);
  const resumed = await call("POST", `/subscriptions/members/${r.id}/resume`, { token: st, body: { lastDay } });
  const s1 = resumed.body?.subscription;
  check("a reviewer continues it: the same record, running again, to the day chosen", resumed.status === 200 && s1.id === r.id &&
    s1.status === "active" && s1.valid === true && s1.lastDay === lastDay, say(resumed));
  check("what it was is kept in its history", s1.history.length === 1 && s1.history[0].status === "expired" &&
    s1.history[0].lastDay !== null && s1.history[0].startsAt !== null, JSON.stringify(s1.history));
  check("and it says how long its last period was, to suggest the next", s1.lastLength >= 19 && s1.lastLength <= 21, String(s1.lastLength));
  await pause(200);
  const told = (await inboxOf(ut, "subscription.resumed"))[0];
  check("the person is told until when", Boolean(told) && new RegExp(`continues until`).test(told.title), JSON.stringify(told));
  const running = await call("POST", `/subscriptions/members/${r.id}/resume`, { token: st, body: { days: 5 } });
  check("one running is not continued — its last day is changed instead", running.status === 409 && /still running/.test(message(running)), say(running));
  check("a day already past is refused", (await call("POST", `/subscriptions/members/${r.id}/resume`, { token: st, body: { lastDay: addDays(today, -1) } })).status === 400);

  console.log("\n== cancelled by the person, continued ==");
  await call("POST", `/subscriptions/members/${r.id}/cancel`, { token: ut, body: { reason: "Too dear" } });
  const cancelled = await member(r.id);
  check("(they cancelled it themselves)", cancelled.status === "cancelled" && cancelled.endedById === user.user.id);
  const platforms = (await call("GET", "/subscriptions/platforms", { token: st })).body.platforms.filter((p) => p.isActive);
  const devices = Object.fromEntries(platforms.map((p, i) => [p.value, i === 0 ? 2 : 0]));
  const again = await call("POST", `/subscriptions/members/${r.id}/resume`, { token: st, body: { days: 5, devices } });
  const s2 = again.body?.subscription;
  check("continued all the same, with other device counts", again.status === 200 && s2.status === "active" &&
    s2.devices.find((d) => d.value === platforms[0].value)?.limit === 2, say(again));
  check("the history says they cancelled it, and why", s2.history.length === 2 && s2.history[1].status === "cancelled" &&
    s2.history[1].reason === "Too dear" && s2.history[1].endedById === user.user.id, JSON.stringify(s2.history));

  console.log("\n== declined, continued ==");
  const d = (await call("POST", `/subscriptions/${second.id}/requests`, { token: ut })).body.subscription;
  check("one waiting is not continued — it is approved", (await call("POST", `/subscriptions/members/${d.id}/resume`, { token: st, body: { days: 5 } })).status === 409);
  await call("POST", `/subscriptions/members/${d.id}/decline`, { token: st, body: { note: "Not now" } });
  const fromDeclined = await call("POST", `/subscriptions/members/${d.id}/resume`, { token: st, body: { days: 7 } });
  check("a declined one continued: running from today", fromDeclined.status === 200 && fromDeclined.body.subscription.status === "active" &&
    fromDeclined.body.subscription.history[0].status === "declined" && fromDeclined.body.subscription.history[0].reason === "Not now", say(fromDeclined));

  console.log("\n== the person asks to continue ==");
  await call("POST", `/subscriptions/members/${r.id}/cancel`, { token: st, body: { reason: "Paused" } });
  const earlierAsk = (await call("POST", `/subscriptions/${sub.id}/requests`, { token: ot })).body.subscription;
  await pause(1100);
  const asked = await call("POST", `/subscriptions/${sub.id}/requests`, { token: ut });
  const s3 = asked.body?.subscription;
  check("asking again carries the same record on, waiting", asked.status === 201 && s3.id === r.id && s3.status === "pending" &&
    s3.history.length === 3 && s3.lastDay === null, say(asked));
  check("asked for now, not when the record was first made", new Date(s3.requestedAt) > new Date(earlierAsk.requestedAt));
  const queue = (await call("GET", "/subscriptions/members?status=pending", { token: st })).body.members.map((m) => m.id);
  check("so it waits behind those asked for before it", queue.indexOf(earlierAsk.id) < queue.indexOf(r.id), JSON.stringify(queue));
  await pause(200);
  const reviewers = await inboxOf(st, "subscription.requested");
  check("reviewers are told it is asked to continue", reviewers.some((n) => /asked to continue Continue Test/.test(n.title)),
    JSON.stringify(reviewers.map((n) => n.title)));
  check("asking twice is still refused", (await call("POST", `/subscriptions/${sub.id}/requests`, { token: ut })).status === 409);

  // Another record of theirs for the same subscription, from before records carried on.
  const old = await UserSubscription.create({ subscriptionId: sub.id, userId: user.user.id, status: "expired", deviceLimits: {} });
  const blocked = await call("POST", `/subscriptions/members/${old.id}/resume`, { token: st, body: { days: 5 } });
  check("not continued while they have another waiting", blocked.status === 409 && /asked for it again/.test(message(blocked)), say(blocked));

  console.log("\n== ending again is told again ==");
  await call("POST", `/subscriptions/members/${r.id}/approve`, { token: st, body: { days: 3 } });
  const expiredBefore = (await inboxOf(ut, "subscription.expired")).length;
  await UserSubscription.update({ expiresAt: new Date(Date.now() - 60_000) }, { where: { id: r.id } });
  await subscriptions.sweep();
  await pause(200);
  check("the record's next ending is told as well", (await inboxOf(ut, "subscription.expired")).length === expiredBefore + 1);

  console.log("\n== in the audit log, when there is one ==");
  const logged = (await call("GET", "/audit?action=subscription.resume&limit=10", { token: st })).body;
  if (logged?.available === false) console.log("  (no document store here — skipped)");
  else check("each continuing is recorded", (logged?.pagination?.total || 0) >= 3 && /continued through/.test(logged.events[0]?.message || ""),
    JSON.stringify(logged?.pagination));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
