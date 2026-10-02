// Phase 8B: durable jobs.
//
// The claim this suite exists to prove: a mass refund survives a restart
// part-way through. It is tested against the real worker running inside the
// API process — a crash is staged by leaving a job exactly as a dead worker
// would (running, lease lapsed, some tickets already refunded) and watching
// the live worker find it, finish it, and pay nobody twice.
//
// Retry and backoff are tested in this process with a job type only this
// process knows, which is also how the suite checks that the API's worker
// leaves types it does not understand alone.
//
// Departures it cancels are reinstated before it finishes.
const os = require("os");
const BACKEND = require("path").resolve(__dirname, "../../..");
const { Op } = require(`${BACKEND}/node_modules/sequelize`);
const { Job, Trip, TripCoach, Refund, Ticket, Booking } = require(`${BACKEND}/src/models`);
const { JOB_STATUS } = require(`${BACKEND}/src/models/Job`);
const { TRIP_STATUS } = require(`${BACKEND}/src/models/Trip`);
const { TRIP_COACH_STATUS } = require(`${BACKEND}/src/models/TripCoach`);
const jobService = require(`${BACKEND}/src/services/jobService`);
const refundService = require(`${BACKEND}/src/services/refundService`);
const notificationService = require(`${BACKEND}/src/services/notificationService`);
const settings = require(`${BACKEND}/src/services/settingService`);
const ApiError = require(`${BACKEND}/src/utils/ApiError`);

const BASE = process.env.API_BASE;

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

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
const login = async (email) =>
  (await call("POST", "/auth/login", { body: { email, password: "UnitTest123!" } })).body;
const msg = (r) => r.body?.error?.message || r.body?.message || JSON.stringify(r.body);

const daysAhead = (d) => {
  const t = new Date();
  return Math.round(
    (new Date(`${d}T00:00:00Z`) - Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())) / 86400000
  );
};

const P = (n) => ({ name: `Durable Passenger ${n}`, nid: `198844445555${n}`, dob: "1990-02-02" });

async function buyOn(trip, { token, adminToken, superToken, userId, count = 1 }) {
  const train = (await call("GET", `/trains/${trip.trainId}`, { token: adminToken })).body.train;
  const A = train.stops[0].stationId;
  const C = train.stops[Math.min(2, train.stops.length - 1)].stationId;
  const held = await call("POST", "/holds/auto", {
    token, body: { tripId: trip.id, fromStationId: A, toStationId: C, count },
  });
  if (held.status !== 201) return null;
  const quote = await call("POST", "/bookings/quote", { token, body: { holdReference: held.body.hold.reference } });
  const balance = (await call("GET", "/wallet", { token })).body.wallet.balanceMinor;
  if (balance > 0) {
    await call("POST", `/wallet/user/${userId}/adjust`, {
      token: superToken, body: { amount: balance / 100, direction: "debit", description: "8B suite: reset" },
    });
  }
  await call("POST", `/wallet/user/${userId}/adjust`, {
    token: superToken, body: { amount: quote.body.totalMinor / 100, direction: "credit", description: "8B suite: fare" },
  });
  const booked = await call("POST", "/bookings", {
    token,
    body: {
      holdReference: held.body.hold.reference,
      passengers: Array.from({ length: count }, (_, i) => P(i + 1)),
      method: "wallet",
    },
  });
  return booked.status === 201 ? booked.body.booking : null;
}

/** Wait for a job to reach one of `statuses`, polling the table. */
async function until(id, statuses, ms = 30000) {
  const deadline = Date.now() + ms;
  let job = await Job.findByPk(id);
  while (job && !statuses.includes(job.status) && Date.now() < deadline) {
    await pause(300);
    job = await Job.findByPk(id);
  }
  return job;
}

const notifyJobsFor = async (ticketNumbers) =>
  (await Job.findAll({ where: { type: "notify.departure_cancelled" } })).filter((j) =>
    ticketNumbers.includes(j.payload?.ticket)
  );

(async () => {
  await settings.loadSettings();

  // The point below is that whoever started a job can follow it without the
  // jobs screen. The admin role holds job:view now, so it is withdrawn for this
  // run (the next suite starts from a fresh copy of the data either way).
  {
    const st0 = (await login("unittest-super1@example.com")).accessToken;
    const roles = (await call("GET", "/roles", { token: st0 })).body.roles;
    const adminRole = roles.find((r) => r.name === "admin");
    const keep = (adminRole.permissions || []).map((p) => p.key || p).filter((k) => k !== "job:view");
    const patched = await call("PATCH", `/roles/${adminRole.id}`, { token: st0, body: { permissions: keep } });
    if (patched.status !== 200) throw new Error(`could not withdraw job:view: ${JSON.stringify(patched.body)}`);
  }

  const buyer = await login("unittest-user@example.com");
  const admin = await login("unittest-admin@example.com");
  const planner = await login("unittest-planner@example.com");
  const su = await login("unittest-super1@example.com");
  const bt = buyer.accessToken, at = admin.accessToken, pt = planner.accessToken, st = su.accessToken;

  const trips = (await call("GET", "/trips?limit=500", { token: at })).body.trips;
  const usable = trips
    .filter((t) => t.status === "scheduled" && t.seatCount > 10 && daysAhead(t.departureDate) >= 4)
    .sort((a, b) => a.seatCount - b.seatCount);
  // Clear of the two the 6B suite uses.
  const [T1, T2] = usable.slice(2);
  check("found departures to work with", Boolean(T1 && T2), `${usable.length} usable`);
  if (!T1 || !T2) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }
  const reinstateAtEnd = new Set();

  /* ================================================================ */
  console.log("\n== cancelling queues the refunds as a job ==");

  const first = await buyOn(T1, { token: bt, adminToken: at, superToken: st, userId: buyer.user.id, count: 2 });
  check("two tickets bought on the departure", first?.tickets?.length === 2, JSON.stringify(first?.ticketCount));
  const firstNumbers = (first?.tickets || []).map((t) => t.ticketNumber);

  const cancelled = await call("POST", `/trips/${T1.id}/cancel`, { token: at, body: { reason: "Flood at Jamuna bridge" } });
  reinstateAtEnd.add(T1.id);
  check("the cancellation is accepted", cancelled.status === 200, msg(cancelled));
  const job1 = cancelled.body?.trip?.job;
  check("the answer names the refund job", job1?.type === "refund.trip_cancellation", JSON.stringify(job1));
  check("which finished while the request waited", job1?.status === "succeeded", job1?.status);
  check("on its first attempt", job1?.attempts === 1, `${job1?.attempts}`);
  check("and reports progress to the end",
    job1?.progress && job1.progress.done === job1.progress.total, JSON.stringify(job1?.progress));

  const refunds1 = cancelled.body?.trip?.refunds;
  const ours1 = (refunds1?.refunds || []).filter((r) => firstNumbers.includes(r.ticketNumber));
  check("the answer still says what was refunded", refunds1?.refunded >= 2, JSON.stringify(refunds1?.refunded));
  check("including both of this suite's tickets", ours1.length === 2, JSON.stringify(ours1));
  check("each in full",
    ours1.every((r) => r.refundMinor === first.tickets.find((t) => t.ticketNumber === r.ticketNumber).fareMinor));

  const row1 = await Job.findByPk(job1.id);
  check("the job records who started it", row1?.createdById === admin.user.id, `${row1?.createdById}`);
  check("and carries one live key per departure", row1?.dedupeKey === `trip-cancel:${T1.id}`, row1?.dedupeKey);

  // An admin without job:view can still follow the job they started.
  check("the admin holds no job:view", !admin.permissions.includes("job:view"));
  const own = await call("GET", `/jobs/${job1.id}`, { token: at });
  check("but can read the job they started", own.status === 200, msg(own));
  const stranger = await call("GET", `/jobs/${job1.id}`, { token: pt });
  check("somebody else cannot even see it exists", stranger.status === 404, `${stranger.status}`);

  console.log("\n== each passenger's message is a job of its own ==");
  const notes1 = await notifyJobsFor(firstNumbers);
  check("one message job per refunded ticket", notes1.length === 2, `${notes1.length}`);
  const sentOk = await Promise.all(notes1.map((j) => until(j.id, [JOB_STATUS.SUCCEEDED, JOB_STATUS.FAILED], 20000)));
  check("the worker sends them", sentOk.every((j) => j?.status === JOB_STATUS.SUCCEEDED),
    JSON.stringify(sentOk.map((j) => [j?.id, j?.status, j?.lastError?.slice(0, 80)])));
  const rendered = notificationService.departureCancelledMessage(notes1[0].payload);
  const body = rendered.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  check("the message names the train", rendered.subject.includes(T1.train.name), rendered.subject);
  check("says the fare is refunded in full", /in full/i.test(body));
  check("and carries the reason given", /Flood at Jamuna bridge/.test(body));

  const back1 = await call("POST", `/trips/${T1.id}/reinstate`, { token: at, body: { reason: "Water receded" } });
  check("with the refunds done, the departure can be reinstated", back1.status === 200, msg(back1));
  if (back1.status === 200) reinstateAtEnd.delete(T1.id);

  /* ================================================================ */
  console.log("\n== a restart part-way through resumes, and pays nobody twice ==");

  const second = await buyOn(T2, { token: bt, adminToken: at, superToken: st, userId: buyer.user.id, count: 3 });
  check("three tickets bought on another departure", second?.tickets?.length === 3, JSON.stringify(second?.ticketCount));
  const secondNumbers = (second?.tickets || []).map((t) => t.ticketNumber);

  // What the cancel transaction does, followed by what a dying worker leaves:
  // the departure cancelled, the job claimed, one ticket refunded, and then
  // nothing — no lease renewed, no result written.
  const owedBefore = await refundService.countOwedForCancellation({ tripId: T2.id });
  const afterRefundId = await refundService.lastRefundId();
  await Trip.update({ status: TRIP_STATUS.CANCELLED, cancellationReason: "Signal failure" }, { where: { id: T2.id } });
  await TripCoach.update({ status: TRIP_COACH_STATUS.CANCELLED }, { where: { tripId: T2.id } });
  reinstateAtEnd.add(T2.id);

  const partial = await refundService.issueForCancellation({
    tripId: T2.id, reason: "Signal failure", actorLabel: "8B suite", limit: 1, audit: false,
  });
  check("the dead worker got one refund done", partial.refunded === 1, JSON.stringify(partial));

  const ghost = await Job.create({
    type: "refund.trip_cancellation",
    payload: { tripId: T2.id, reason: "Signal failure", actorLabel: "8B suite", afterRefundId },
    status: JOB_STATUS.RUNNING,
    attempts: 1,
    maxAttempts: 5,
    runAfter: new Date(),
    startedAt: new Date(),
    lockedBy: "a-host-that-died:4242:gone",
    leaseExpiresAt: new Date(Date.now() - 1000),
    dedupeKey: `trip-cancel:${T2.id}`,
    label: "8B suite: a refund whose worker died",
    createdById: su.user.id,
  });

  const resumed = await until(ghost.id, [JOB_STATUS.SUCCEEDED, JOB_STATUS.FAILED], 30000);
  check("the live worker picks up the abandoned job", resumed?.status === JOB_STATUS.SUCCEEDED,
    `${resumed?.status} ${resumed?.lastError?.slice(0, 120) || ""}`);
  check("as a second attempt", resumed?.attempts === 2, `${resumed?.attempts}`);
  check("under its own name now", resumed?.lockedBy === null && resumed?.finishedAt);

  const summary = resumed?.result || {};
  check("every ticket owed was refunded, counting the one before the crash",
    summary.refunded === owedBefore, `${summary.refunded} vs ${owedBefore} owed`);
  check("including all three of this suite's",
    secondNumbers.every((n) => (summary.refunds || []).some((r) => r.ticketNumber === n)));

  const refundRows = await Refund.findAll({
    where: { type: "disruption", id: { [Op.gt]: afterRefundId } },
    include: [{ model: Booking, as: "booking", where: { tripId: T2.id }, attributes: [] }],
  });
  const perTicket = refundRows.reduce((m, r) => m.set(r.ticketId, (m.get(r.ticketId) || 0) + 1), new Map());
  check("nobody was refunded twice", [...perTicket.values()].every((n) => n === 1),
    JSON.stringify([...perTicket.entries()].filter(([, n]) => n > 1)));
  const stillValid = await Ticket.count({
    where: { status: "valid" },
    include: [{ model: Booking, as: "booking", where: { tripId: T2.id }, attributes: [] }],
  });
  check("and nobody was missed", stillValid === 0, `${stillValid} still valid`);

  const refundedNumbers = (summary.refunds || []).map((r) => r.ticketNumber);
  const notes2 = await notifyJobsFor(refundedNumbers);
  check("exactly one message owed per refund — the pre-crash one included",
    notes2.length === refundedNumbers.length && new Set(notes2.map((j) => j.payload.ticket)).size === notes2.length,
    `${notes2.length} messages for ${refundedNumbers.length} refunds`);

  const ledger = await call("GET", "/wallet/verify", { token: bt });
  check("the passenger's ledger still balances", ledger.body?.consistent === true, JSON.stringify(ledger.body));

  /* ================================================================ */
  console.log("\n== reinstating waits for the refunds ==");

  const blocker = await Job.create({
    type: "refund.trip_cancellation",
    payload: { tripId: T2.id, reason: "held back by the suite", afterRefundId: await refundService.lastRefundId() },
    status: JOB_STATUS.QUEUED,
    maxAttempts: 5,
    // Not due for an hour, so the worker leaves it be while we look.
    runAfter: new Date(Date.now() + 3600_000),
    dedupeKey: `trip-cancel:${T2.id}`,
    label: "8B suite: refunds still in flight",
    progress: { total: 40, done: 12 },
  });
  const early = await call("POST", `/trips/${T2.id}/reinstate`, { token: at, body: { reason: "too soon" } });
  check("reinstating while refunds are in flight is refused", early.status === 409, `${early.status} ${msg(early)}`);
  check("and says which job, and how far it has got",
    new RegExp(`job #${blocker.id}`).test(msg(early)) && /12 of 40/.test(msg(early)), msg(early));

  const dup = await jobService.enqueue("refund.trip_cancellation", { tripId: T2.id }, { dedupeKey: `trip-cancel:${T2.id}` });
  check("a second cancellation job for the same departure is not queued", dup.id === blocker.id, `${dup.id} vs ${blocker.id}`);

  await blocker.destroy();
  const now2 = await call("POST", `/trips/${T2.id}/reinstate`, { token: at, body: { reason: "Signals fixed" } });
  check("once they are done, it can be", now2.status === 200, msg(now2));
  if (now2.status === 200) reinstateAtEnd.delete(T2.id);

  // The same rule for a coach.
  const coach = (await TripCoach.findAll({ where: { tripId: T2.id }, order: [["position", "ASC"]] }))[0];
  await coach.update({ status: TRIP_COACH_STATUS.CANCELLED, cancellationReason: "8B suite", cancelledAt: new Date() });
  const coachBlocker = await Job.create({
    type: "refund.coach_cancellation",
    payload: { tripId: T2.id, tripCoachId: coach.id, reason: "held back" },
    status: JOB_STATUS.QUEUED,
    maxAttempts: 5,
    runAfter: new Date(Date.now() + 3600_000),
    dedupeKey: `coach-cancel:${T2.id}:${coach.id}`,
    label: "8B suite: coach refunds in flight",
  });
  const coachEarly = await call("POST", `/trips/${T2.id}/coaches/${coach.id}/reinstate`, { token: at, body: { reason: "too soon" } });
  check("a coach cannot be reinstated while its refunds run either", coachEarly.status === 409, `${coachEarly.status} ${msg(coachEarly)}`);
  await coachBlocker.destroy();
  const coachBack = await call("POST", `/trips/${T2.id}/coaches/${coach.id}/reinstate`, { token: at, body: { reason: "done" } });
  check("and can be once they finish", coachBack.status === 200, msg(coachBack));

  /* ================================================================ */
  console.log("\n== a failing job is retried, waiting longer each time ==");

  const base = settings.get("jobs.retry_base_seconds");
  jobService.define("test.flaky", {
    handler: async (payload, ctx) => {
      if (ctx.attempt < payload.succeedOn) throw new Error(`flaky on attempt ${ctx.attempt}`);
      return { ok: true, attempt: ctx.attempt };
    },
  });
  jobService.define("test.refuse", {
    handler: async () => {
      throw ApiError.badRequest("This will never work");
    },
  });
  const onlyTest = { types: ["test.flaky", "test.refuse"] };
  const catchUp = (id) => Job.update({ runAfter: new Date(Date.now() - 1000) }, { where: { id } });

  const flaky = await jobService.enqueue("test.flaky", { succeedOn: 3 }, { maxAttempts: 5, label: "8B suite: flaky" });

  // The API's worker does not know this type, so it must leave it alone.
  await pause(3500);
  check("a worker leaves job types it does not know alone",
    (await Job.findByPk(flaky.id)).status === JOB_STATUS.QUEUED && (await Job.findByPk(flaky.id)).attempts === 0);

  let t0 = Date.now();
  await jobService.drain(onlyTest);
  let row = await Job.findByPk(flaky.id);
  check("the first failure goes back in the queue", row.status === JOB_STATUS.QUEUED && row.attempts === 1,
    `${row.status} ${row.attempts}`);
  check("saying what went wrong", /flaky on attempt 1/.test(row.lastError || ""), row.lastError?.slice(0, 80));
  const wait1 = (new Date(row.runAfter) - t0) / 1000;
  check(`and waits the base delay (${base}s)`, Math.abs(wait1 - base) < 5, `${wait1.toFixed(1)}s`);

  await catchUp(flaky.id);
  t0 = Date.now();
  await jobService.drain(onlyTest);
  row = await Job.findByPk(flaky.id);
  const wait2 = (new Date(row.runAfter) - t0) / 1000;
  check("the second failure waits twice as long", row.attempts === 2 && Math.abs(wait2 - base * 2) < 5,
    `attempt ${row.attempts}, ${wait2.toFixed(1)}s`);

  await catchUp(flaky.id);
  await jobService.drain(onlyTest);
  row = await Job.findByPk(flaky.id);
  check("and the third attempt succeeds", row.status === JOB_STATUS.SUCCEEDED && row.result?.attempt === 3,
    `${row.status} ${JSON.stringify(row.result)}`);
  check("clearing the error it had", row.lastError === null);

  console.log("\n== and given up on when it cannot succeed ==");
  const hopeless = await jobService.enqueue("test.flaky", { succeedOn: 99 }, { maxAttempts: 2, label: "8B suite: hopeless" });
  await jobService.drain(onlyTest);
  await catchUp(hopeless.id);
  await jobService.drain(onlyTest);
  row = await Job.findByPk(hopeless.id);
  check("after its last attempt it is marked failed", row.status === JOB_STATUS.FAILED && row.attempts === 2,
    `${row.status} ${row.attempts}`);
  check("with when, and why", row.finishedAt && /flaky on attempt 2/.test(row.lastError || ""));

  const refusal = await jobService.enqueue("test.refuse", {}, { maxAttempts: 5, label: "8B suite: refusal" });
  await jobService.drain(onlyTest);
  row = await Job.findByPk(refusal.id);
  check("a refusal is not retried — it would refuse again", row.status === JOB_STATUS.FAILED && row.attempts === 1,
    `${row.status} ${row.attempts}`);

  console.log("\n== a person can send a failed job round again ==");
  const plannerRetry = await call("POST", `/jobs/${hopeless.id}/retry`, { token: pt });
  check("not just anybody", plannerRetry.status === 403, `${plannerRetry.status}`);
  const adminRetry = await call("POST", `/jobs/${hopeless.id}/retry`, { token: at });
  check("not even an admin without job:manage", adminRetry.status === 403, `${adminRetry.status}`);
  const retried = await call("POST", `/jobs/${hopeless.id}/retry`, { token: st });
  check("someone with job:manage can", retried.status === 200, msg(retried));
  check("queued again with its attempts reset", retried.body?.job?.status === "queued" && retried.body?.job?.attempts === 0,
    JSON.stringify(retried.body?.job));
  const again = await call("POST", `/jobs/${flaky.id}/retry`, { token: st });
  check("a job that succeeded cannot be retried", again.status === 409, `${again.status}`);

  console.log("\n== a worker that stopped on this machine is noticed at once ==");
  const orphan = await Job.create({
    type: "test.flaky",
    payload: { succeedOn: 1 },
    status: JOB_STATUS.RUNNING,
    attempts: 1,
    maxAttempts: 5,
    runAfter: new Date(),
    lockedBy: `${os.hostname()}:999999:gone`,
    // Its lease has ten minutes left — but the process holding it does not exist.
    leaseExpiresAt: new Date(Date.now() + 600_000),
    label: "8B suite: orphan",
  });
  await jobService.recoverOrphans();
  row = await Job.findByPk(orphan.id);
  check("its lease is released without waiting it out", new Date(row.leaseExpiresAt) < new Date(),
    `${row.leaseExpiresAt}`);
  await jobService.drain(onlyTest);
  row = await Job.findByPk(orphan.id);
  check("and the job is finished", row.status === JOB_STATUS.SUCCEEDED, row.status);

  /* ================================================================ */
  console.log("\n== the jobs screen ==");
  const noView = await call("GET", "/jobs", { token: pt });
  check("listing needs job:view", noView.status === 403, `${noView.status}`);
  const listed = await call("GET", "/jobs?limit=50", { token: st });
  check("someone with it sees the list", listed.status === 200 && Array.isArray(listed.body?.jobs), msg(listed));
  check("with a count per status", typeof listed.body?.counts === "object" && listed.body.counts.succeeded >= 1,
    JSON.stringify(listed.body?.counts));
  check("and the types this server runs",
    ["refund.trip_cancellation", "refund.coach_cancellation", "notify.departure_cancelled"].every((t) =>
      listed.body?.types?.includes(t)), JSON.stringify(listed.body?.types));
  const failedOnly = await call("GET", "/jobs?status=failed", { token: st });
  check("it filters by status", failedOnly.status === 200 && failedOnly.body.jobs.every((j) => j.status === "failed"));

  /* ---------------- Leave things as found ---------------- */
  const cleaned = await Job.destroy({ where: { type: { [Op.like]: "test.%" } } });
  console.log(`\n  removed ${cleaned} test job(s)`);
  for (const id of reinstateAtEnd) {
    await call("POST", `/trips/${id}/reinstate`, { token: at, body: { reason: "8B suite cleanup" } });
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
