const os = require("os");
const { EventEmitter } = require("events");
const { Op } = require("sequelize");
const { sequelize, Job, User } = require("../models");
const { JOB_STATUS } = require("../models/Job");
const settings = require("./settingService");
const audit = require("./auditService");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { PERMISSIONS } = require("../constants/permissions");
const inbox = require("./inboxService");
const { backoffSeconds, isPermanent } = require("../utils/jobRetry");
const { runWithContext } = require("../utils/requestContext");
const demoCapture = require("../utils/demoCapture");

/**
 * Durable jobs (Phase 8B).
 *
 * ## What problem this solves
 *
 * Cancelling a departure refunds every ticket on it. Done inside the request,
 * a restart part-way through — a deploy, a crash, a free-tier host recycling
 * the process — left some passengers refunded and the rest not, with nothing
 * anywhere remembering that the job was unfinished. Now the work is written
 * down first, in the same transaction as the decision that caused it, and a
 * worker does it from the table. Whatever happens to the request, the row is
 * still there and the next worker carries on.
 *
 * ## How a job moves
 *
 *     queued ──claim──▶ running ──ok──▶ succeeded
 *        ▲                 │
 *        └── retry after ──┤ error, attempts left
 *            backoff       └ error, none left ──▶ failed (a person decides)
 *
 * ## Claimed under a lease, not a lock
 *
 * Claiming is a compare-and-set `UPDATE … WHERE status = 'queued'`, and the
 * claim carries a lease the worker keeps renewing while it runs. Nothing is
 * locked in the database for the length of the work, so a worker that dies
 * cannot leave a lock behind: its lease simply stops being renewed, lapses,
 * and the job is claimable again. The same statement works on any SQL engine,
 * which matters for free-tier managed databases that lack `SKIP LOCKED`.
 *
 * ## What a handler must promise
 *
 * **Running it twice does the work once.** A job can be interrupted after
 * doing some of its work and before recording that it did — that is exactly
 * the case this exists for — so the retry must skip what is already done.
 * The refund handlers do: a ticket already refunded is no longer valid, and is
 * never looked at again.
 */

const LEASE_MS = 60_000;
const HEARTBEAT_MS = 15_000;
// New work does not wait for this — queueing a job kicks the worker at once.
// The poll only picks up retries that have waited out their backoff and jobs
// whose worker died, so it can be unhurried, which a free-tier database
// appreciates.
const POLL_MS = 5_000;

/** Who this process is, in a form that lets a restarted process spot its orphans. */
const HOST = os.hostname();
const WORKER_ID = `${HOST}:${process.pid}:${Date.now().toString(36)}`;

const handlers = new Map();
const events = new EventEmitter();
events.setMaxListeners(0);

let timer = null;
let running = false;
let busy = false;

/* ------------------------------------------------------------------ *
 * Defining and queueing
 * ------------------------------------------------------------------ */

/**
 * Teach this process how to do one type of job.
 *
 * A worker only claims types it has a handler for, so a process that does not
 * know a type — an older deploy, a test runner — leaves those jobs alone rather
 * than failing them.
 */
/**
 * `announce(result, job)` is for work someone starts and walks away from — a
 * mass refund, loading data. It returns the in-app notification the person
 * who started it gets when it finishes. Jobs without it finish quietly.
 */
function define(type, { handler, priority = 0, describe, announce }) {
  handlers.set(type, { type, handler, priority, describe, announce });
}

/* ---------------- Telling people how it went ---------------- */

const HOUR_MS = 3_600_000;

/** The person who started it, told it finished. Never throws. */
async function announceFinished(definition, job, result) {
  if (!definition?.announce || !job.createdById) return;
  try {
    const n = definition.announce(result, job);
    if (n) {
      await inbox.tryAdd(job.createdById, {
        type: `job.${job.type}.done`,
        category: inbox.CATEGORY.SYSTEM,
        tone: "success",
        ...n,
        key: `job:${job.id}:done`,
      });
    }
  } catch (err) {
    console.error(`[jobs] could not announce #${job.id}: ${err.message}`);
  }
}

/**
 * A job that gave up: its starter is told, and so is everyone who can retry
 * jobs — once an hour per kind of job, so a mail server going down for an
 * afternoon is one message, not three hundred.
 */
async function announceFailed(job, err) {
  const notification = {
    type: "job.failed",
    category: inbox.CATEGORY.SYSTEM,
    tone: "danger",
    title: `Background job failed — ${job.label || job.type}`,
    body:
      `It stopped after ${job.attempts} attempt(s): ${String(err?.message || err).slice(0, 200)}. ` +
      "It can be retried on Background Jobs.",
    link: `/dashboard/jobs?focus=${job.id}`,
  };
  if (job.createdById) await inbox.tryAdd(job.createdById, { ...notification, key: `job:${job.id}:failed` });
  await inbox.toHolders(
    PERMISSIONS.JOB_MANAGE,
    { ...notification, key: `jobs-failed:${job.type}:${Math.floor(Date.now() / HOUR_MS)}` },
    { except: [job.createdById] }
  );
}

/**
 * Write a job down.
 *
 * Pass the caller's `transaction` and the job commits or rolls back with the
 * decision that caused it: a departure is never cancelled without its refunds
 * queued, and no refund job exists for a cancellation that did not happen.
 *
 * With a `dedupeKey`, a live job for the same subject is returned instead of a
 * second one being queued.
 */
async function enqueue(
  type,
  payload,
  { transaction, dedupeKey = null, priority, runAfter, maxAttempts, createdById = null, label = null } = {}
) {
  if (dedupeKey) {
    const live = await Job.findOne({
      where: { dedupeKey, status: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] },
      transaction,
    });
    if (live) return live;
  }

  const job = await Job.create(
    {
      type,
      payload: payload ?? {},
      status: JOB_STATUS.QUEUED,
      priority: priority ?? handlers.get(type)?.priority ?? 0,
      maxAttempts: maxAttempts ?? settings.get("jobs.max_attempts"),
      runAfter: runAfter || new Date(),
      dedupeKey,
      createdById,
      label,
    },
    { transaction }
  );

  // Start on it straight away rather than at the next poll — but only once it
  // exists for everyone, which is after the caller's transaction commits.
  if (transaction) transaction.afterCommit(() => kick());
  else kick();

  return job;
}

/* ------------------------------------------------------------------ *
 * Claiming and running
 * ------------------------------------------------------------------ */

/** Due work: queued and past its wait, or running under a lease nobody renewed. */
const dueWhere = (now) => ({
  [Op.or]: [
    { status: JOB_STATUS.QUEUED, runAfter: { [Op.lte]: now } },
    { status: JOB_STATUS.RUNNING, leaseExpiresAt: { [Op.lt]: now } },
  ],
});

/**
 * Take the next due job, or null.
 *
 * Candidates are read without locks and then claimed with a conditional
 * update; whichever worker's update matches the row first owns the job, and the
 * others simply move on to the next candidate.
 */
async function claimNext({ types = [...handlers.keys()], now = new Date() } = {}) {
  if (!types.length) return null;

  const candidates = await Job.findAll({
    where: { type: types, ...dueWhere(now) },
    order: [
      ["priority", "DESC"],
      ["runAfter", "ASC"],
      ["id", "ASC"],
    ],
    limit: 5,
    attributes: ["id"],
  });

  for (const { id } of candidates) {
    const [claimed] = await Job.update(
      {
        status: JOB_STATUS.RUNNING,
        lockedBy: WORKER_ID,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        attempts: sequelize.literal("attempts + 1"),
        startedAt: sequelize.literal(`COALESCE(started_at, ${sequelize.escape(now)})`),
      },
      { where: { id, type: types, ...dueWhere(now) } }
    );
    if (claimed === 1) return Job.findByPk(id);
  }
  return null;
}

/**
 * Run one claimed job to an outcome.
 *
 * The handler runs as the person who queued the job, so the audit entries it
 * writes credit the operator who cancelled the departure rather than an
 * anonymous "system".
 */
async function run(job) {
  const definition = handlers.get(job.type);
  const heartbeat = () =>
    Job.update(
      { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
      { where: { id: job.id, lockedBy: WORKER_ID, status: JOB_STATUS.RUNNING } }
    ).catch(() => {});
  const beating = setInterval(heartbeat, HEARTBEAT_MS);
  beating.unref?.();

  const creator = job.createdById
    ? await User.findByPk(job.createdById, { attributes: ["id", "email"] }).catch(() => null)
    : null;

  const context = {
    actor: creator ? { id: creator.id, email: creator.email, roles: [] } : null,
    method: "JOB",
    path: `job #${job.id} ${job.type}`,
  };

  const ctx = {
    job,
    attempt: job.attempts,
    heartbeat,
    /** Record how far it has got — shown on the jobs screen, and renews the lease. */
    progress: (progress) =>
      Job.update(
        { progress, leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
        { where: { id: job.id, lockedBy: WORKER_ID } }
      ).catch(() => {}),
  };

  try {
    if (!definition) {
      throw Object.assign(new Error(`No handler for job type "${job.type}"`), { retryable: false });
    }
    // Outside any demo capture: a job kicked off by demo seeding runs on its
    // own terms, and whatever it creates is not taken for demo data.
    const result = await demoCapture.outside(() =>
      runWithContext(context, () => definition.handler(job.payload || {}, ctx))
    );

    await Job.update(
      {
        status: JOB_STATUS.SUCCEEDED,
        result: result ?? null,
        finishedAt: new Date(),
        lockedBy: null,
        leaseExpiresAt: null,
        lastError: null,
      },
      { where: { id: job.id } }
    );
    await announceFinished(definition, job, result);
  } catch (err) {
    const message = String(err?.stack || err?.message || err).slice(0, 4000);
    const giveUp = job.attempts >= job.maxAttempts || isPermanent(err);

    if (giveUp) {
      await Job.update(
        {
          status: JOB_STATUS.FAILED,
          finishedAt: new Date(),
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: message,
        },
        { where: { id: job.id } }
      );
      await runWithContext(context, () =>
        audit.record({
          action: AUDIT_ACTIONS.JOB_FAILED,
          entity: { type: "job", id: job.id, label: job.label || job.type },
          after: { type: job.type, attempts: job.attempts, error: String(err?.message || err).slice(0, 500) },
          outcome: "failure",
          message:
            `${job.label || job.type} gave up after ${job.attempts} attempt(s): ` +
            String(err?.message || err).slice(0, 300),
        })
      );
      console.error(`[jobs] #${job.id} ${job.type} failed for good: ${err?.message || err}`);
      await announceFailed(job, err);
    } else {
      const wait = backoffSeconds(job.attempts, settings.get("jobs.retry_base_seconds"));
      await Job.update(
        {
          status: JOB_STATUS.QUEUED,
          runAfter: new Date(Date.now() + wait * 1000),
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: message,
        },
        { where: { id: job.id } }
      );
      console.warn(
        `[jobs] #${job.id} ${job.type} attempt ${job.attempts} failed, retrying in ${wait}s: ${err?.message || err}`
      );
    }
  } finally {
    clearInterval(beating);
    events.emit(`finished:${job.id}`);
    events.emit("finished", job.id);
  }
}

/**
 * Work through everything due, one job at a time, then stop.
 *
 * One at a time is deliberate: the work here is database-bound, and two mass
 * refunds racing each other for the same connection pool finish no sooner than
 * one after the other.
 */
async function drain({ types } = {}) {
  if (busy) return 0;
  busy = true;
  let done = 0;
  try {
    for (;;) {
      if (types === undefined && !running) break;
      const job = await claimNext(types ? { types } : undefined);
      if (!job) break;
      await run(job);
      done += 1;
    }
  } catch (err) {
    console.error(`[jobs] worker loop error: ${err.message}`);
  } finally {
    busy = false;
  }
  return done;
}

/** Look now rather than at the next poll. Does nothing unless this process is a worker. */
function kick() {
  if (running) setImmediate(() => drain().catch(() => {}));
}

/* ------------------------------------------------------------------ *
 * Starting, stopping, recovering
 * ------------------------------------------------------------------ */

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * Jobs left running by a process on this machine that no longer exists.
 *
 * Without this a restart would wait out the dead process's lease — up to a
 * minute — before resuming a half-done refund. On the same host we can do
 * better: if the process that held it is gone, the lease is released now.
 * Jobs held by other hosts are left to their leases, since we cannot see those
 * processes.
 */
async function recoverOrphans() {
  const held = await Job.findAll({
    where: { status: JOB_STATUS.RUNNING, lockedBy: { [Op.like]: `${HOST}:%` } },
    attributes: ["id", "lockedBy"],
  });
  let recovered = 0;
  for (const job of held) {
    const pid = Number(String(job.lockedBy).split(":")[1]);
    if (job.lockedBy === WORKER_ID || (Number.isInteger(pid) && isAlive(pid) && pid !== process.pid)) continue;
    const [n] = await Job.update(
      { leaseExpiresAt: new Date(0) },
      { where: { id: job.id, status: JOB_STATUS.RUNNING, lockedBy: job.lockedBy } }
    );
    recovered += n;
  }
  return recovered;
}

async function startWorker({ pollMs = POLL_MS } = {}) {
  if (running) return;
  running = true;
  const recovered = await recoverOrphans().catch(() => 0);
  timer = setInterval(() => drain().catch(() => {}), pollMs);
  timer.unref?.();
  console.log(
    `✅ Job worker ${WORKER_ID} started (${handlers.size} types)` +
      (recovered ? ` — resumed ${recovered} job(s) left by a stopped process` : "")
  );
  kick();
}

function stopWorker() {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
}

/* ------------------------------------------------------------------ *
 * Waiting, reading, retrying
 * ------------------------------------------------------------------ */

/**
 * Wait up to `ms` for a job to finish, and return it as it stands.
 *
 * Wakes as soon as this process finishes it, and polls as well, in case
 * another process's worker got there first.
 */
async function waitFor(id, ms) {
  const read = () => Job.findByPk(id);
  let job = await read();
  if (!job || job.isFinished || ms <= 0) return job;

  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(() => {
        events.off(`finished:${id}`, done);
        resolve();
      }, Math.min(500, Math.max(0, deadline - Date.now())));
      events.once(`finished:${id}`, done);
    });
    job = await read();
    if (!job || job.isFinished) return job;
  }
  return job;
}

/** A live job for a subject, if there is one. */
async function liveFor({ dedupeKey, dedupePrefix }) {
  const where = { status: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] };
  if (dedupeKey) where.dedupeKey = dedupeKey;
  else if (dedupePrefix) where.dedupeKey = { [Op.like]: `${dedupePrefix}%` };
  else return null;
  return Job.findOne({ where, order: [["id", "DESC"]] });
}

async function list({ status, type, page = 1, limit = 25 } = {}) {
  const where = {};
  if (status && status !== "all") where.status = status;
  if (type) where.type = type;
  const size = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const current = Math.max(Number(page) || 1, 1);

  const { rows, count } = await Job.findAndCountAll({
    where,
    order: [["id", "DESC"]],
    limit: size,
    offset: (current - 1) * size,
    include: [{ model: User, as: "createdBy", attributes: ["id", "fullName", "email"] }],
  });

  const counts = await Job.findAll({
    attributes: ["status", [sequelize.fn("COUNT", sequelize.col("id")), "n"]],
    group: ["status"],
    raw: true,
  });

  return {
    jobs: rows.map((j) => ({
      ...j.toPublicJSON(),
      createdBy: j.createdBy ? { id: j.createdBy.id, name: j.createdBy.fullName, email: j.createdBy.email } : null,
    })),
    counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
    types: [...new Set([...handlers.keys()])].sort(),
    pagination: { page: current, limit: size, total: count, pages: Math.max(1, Math.ceil(count / size)) },
  };
}

async function get(id) {
  const job = await Job.findByPk(id, {
    include: [{ model: User, as: "createdBy", attributes: ["id", "fullName", "email"] }],
  });
  if (!job) throw ApiError.notFound("Job not found");
  return job;
}

/**
 * Send a failed job round again.
 *
 * Only a failed one: a queued job is already going to run, and a running one
 * is being run. Attempts start again from zero, because the reason it failed is
 * presumably what the person pressing this has just fixed.
 */
async function retry(id) {
  const job = await get(id);
  if (job.status !== JOB_STATUS.FAILED) {
    throw ApiError.conflict(`Job #${job.id} is ${job.status}; only a failed job can be retried.`);
  }
  await job.update({
    status: JOB_STATUS.QUEUED,
    attempts: 0,
    maxAttempts: Math.max(job.maxAttempts, settings.get("jobs.max_attempts")),
    runAfter: new Date(),
    finishedAt: null,
    lockedBy: null,
    leaseExpiresAt: null,
  });

  await audit.record({
    action: AUDIT_ACTIONS.JOB_RETRY,
    entity: { type: "job", id: job.id, label: job.label || job.type },
    before: { status: JOB_STATUS.FAILED, lastError: String(job.lastError || "").slice(0, 300) },
    after: { status: JOB_STATUS.QUEUED },
    message: `${job.label || job.type} sent round again`,
  });

  kick();
  return job.reload();
}

/** Delete succeeded jobs older than the configured age. Failed ones stay until dealt with. */
async function prune({ now = new Date() } = {}) {
  const days = settings.get("jobs.keep_days");
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const deleted = await Job.destroy({
    where: { status: JOB_STATUS.SUCCEEDED, finishedAt: { [Op.lt]: cutoff } },
  });
  return { deleted, olderThanDays: days };
}

module.exports = {
  define,
  enqueue,
  claimNext,
  run,
  drain,
  kick,
  startWorker,
  stopWorker,
  recoverOrphans,
  waitFor,
  liveFor,
  list,
  get,
  retry,
  prune,
  isPermanent,
  WORKER_ID,
  LEASE_MS,
};
