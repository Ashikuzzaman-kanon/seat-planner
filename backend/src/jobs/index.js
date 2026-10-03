const settings = require("../services/settingService");
const tripService = require("../services/tripService");
const quotaService = require("../services/quotaService");
const holdService = require("../services/holdService");
const refundService = require("../services/refundService");
const waitlistService = require("../services/waitlistService");
// Loading the handlers is what teaches this process's worker the durable job types.
const durable = require("./handlers");

/**
 * Recurring housekeeping, on timers.
 *
 * Deliberately not the durable queue. These are sweeps — expire lapsed holds,
 * top up the horizon — that are idempotent and cheap to repeat, so a missed run
 * is simply made up by the next one and needs no record. One-off work that must
 * not be lost if the process dies half-way, like a cancelled departure's mass
 * refund, goes to the durable job table instead (services/jobService.js, with
 * its handlers in ./handlers.js); `start` below starts that worker too.
 *
 * Every task here is written so that running it twice is the same as running it once.
 */
const jobs = new Map();
const timers = [];

function register(name, { everyMinutes, runOnBoot = false, handler, describe }) {
  jobs.set(name, { name, everyMinutes, runOnBoot, handler, describe, lastRun: null, lastResult: null });
}

async function runJob(name, context = {}) {
  const job = jobs.get(name);
  if (!job) throw new Error(`Unknown job: ${name}`);

  const startedAt = new Date();
  try {
    const result = await job.handler(context);
    job.lastRun = { startedAt, finishedAt: new Date(), ok: true };
    job.lastResult = result;
    return result;
  } catch (err) {
    job.lastRun = { startedAt, finishedAt: new Date(), ok: false, error: err.message };
    console.error(`[jobs] ${name} failed: ${err.message}`);
    throw err;
  }
}

function status() {
  return [...jobs.values()].map(({ name, everyMinutes, describe, lastRun, lastResult }) => ({
    name,
    everyMinutes,
    describe,
    lastRun,
    lastResult,
  }));
}

/** Start the timers. Safe to skip entirely — every job can be triggered by hand. */
function start() {
  for (const job of jobs.values()) {
    if (job.runOnBoot) {
      runJob(job.name, { actorLabel: "startup" }).catch(() => {});
    }
    if (job.everyMinutes) {
      const timer = setInterval(
        () => runJob(job.name, { actorLabel: "scheduled job" }).catch(() => {}),
        job.everyMinutes * 60_000
      );
      // Do not hold the process open purely for a timer.
      timer.unref?.();
      timers.push(timer);
    }
  }
  console.log(`✅ Jobs registered (${jobs.size}): ${[...jobs.keys()].join(", ")}`);

  // The durable queue's worker, which also resumes anything a stopped process
  // left half-done.
  durable.startWorker().catch((err) => console.error(`[jobs] worker did not start: ${err.message}`));
}

function stop() {
  timers.forEach(clearInterval);
  timers.length = 0;
  durable.stopWorker();
}

/* ---------------- The jobs themselves ---------------- */

register("trip.horizon", {
  describe: "Keeps the configured number of days of departures generated",
  everyMinutes: 60,
  runOnBoot: true,
  handler: async ({ actorLabel } = {}) => {
    if (!settings.get("trip.generation_enabled")) {
      return { skipped: true, reason: "automatic generation is switched off in settings" };
    }
    return tripService.generateHorizon({ actorLabel: actorLabel || "scheduled job" });
  },
});

register("quota.release", {
  describe: "Returns unsold reserved seats to open sale once their release time passes",
  everyMinutes: 15,
  runOnBoot: true,
  handler: async () => quotaService.releaseDue(),
});

register("refund.close", {
  describe: "Closes demand-based returns once their train has left, since unsold segments now never will",
  everyMinutes: 30,
  runOnBoot: true,
  handler: async () => refundService.closeDeparted(),
});

register("hold.expire", {
  describe: "Returns seats from abandoned checkouts to sale once their hold lapses",
  everyMinutes: 1,
  runOnBoot: true,
  handler: async () => holdService.expireDue(),
});

register("waitlist.offers", {
  describe:
    "Closes waitlist offers nobody answered, puts those seats back on sale and passes them to " +
    "the next person waiting",
  everyMinutes: 1,
  runOnBoot: true,
  handler: async () => waitlistService.expireOffers(),
});

register("trip.clear_unsold_seats", {
  describe: "Deletes the unsold seats of trains that left longer ago than the configured number of days",
  everyMinutes: 24 * 60,
  runOnBoot: true,
  handler: async () => require("../services/seatRetentionService").clearDeparted(),
});

register("notifications.prune", {
  describe: "Deletes in-app notifications older than the configured number of days",
  everyMinutes: 24 * 60,
  runOnBoot: true,
  handler: async () => require("../services/inboxService").prune(),
});

register("jobs.prune", {
  describe: "Deletes background jobs that succeeded longer ago than the configured number of days",
  everyMinutes: 24 * 60,
  runOnBoot: true,
  handler: async () => durable.prune(),
});

register("waitlist.close", {
  describe: "Closes queue places for departures that have gone or been cancelled",
  everyMinutes: 60,
  runOnBoot: true,
  handler: async () => waitlistService.closeDeparted(),
});

module.exports = { register, runJob, status, start, stop };
