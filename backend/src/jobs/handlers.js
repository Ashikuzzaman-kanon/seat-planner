const jobs = require("../services/jobService");
const refunds = require("../services/refundService");
const notify = require("../services/notificationService");
const audit = require("../services/auditService");
const money = require("../utils/money");
const { Trip, TripCoach, TrainName } = require("../models");
const { TRIP_STATUS } = require("../models/Trip");
const { TRIP_COACH_STATUS } = require("../models/TripCoach");
const { AUDIT_ACTIONS } = require("../constants/auditActions");

/**
 * The durable jobs this system runs (Phase 8B), and how to do each.
 *
 * Every handler here can be run twice and do its work once — the promise the
 * job service asks of them, because an interrupted attempt is exactly what a
 * retry follows.
 */

/** Tickets refunded per batch. Small enough that each batch is quick, and the lease is renewed between. */
const BATCH = 25;

/**
 * Refund everyone owed by one cancellation, in batches, until nobody is.
 *
 * Shared by departures and coaches — the same rule, "one refund path", that
 * `issueForCancellation` already follows. The count of tickets still owed is
 * read at the start of each attempt, so a resumed job reports progress against
 * what is actually left rather than restarting from zero.
 */
async function refundEveryone({ tripId, tripCoachId, reason, actorLabel, afterRefundId = 0 }, ctx) {
  const alreadyDone = (await refunds.disruptionSummary({ tripId, tripCoachId, afterRefundId })).refunded;
  const owed = await refunds.countOwedForCancellation({ tripId, tripCoachId });
  const total = alreadyDone + owed;
  let done = alreadyDone;

  await ctx.progress({ total, done });

  for (;;) {
    const batch = await refunds.issueForCancellation({
      tripId,
      tripCoachId,
      reason,
      actorLabel,
      limit: BATCH,
      audit: false,
    });
    if (!batch.found) break;
    done += batch.refunded;
    await ctx.progress({ total: Math.max(total, done), done });
  }

  return refunds.disruptionSummary({ tripId, tripCoachId, afterRefundId });
}

jobs.define("refund.trip_cancellation", {
  priority: 10,
  describe: "Refund every ticket on a cancelled departure, and queue each passenger's message",
  handler: async (payload, ctx) => {
    const trip = await Trip.findByPk(payload.tripId, { include: [{ model: TrainName, as: "train" }] });
    if (!trip) {
      throw Object.assign(new Error(`Departure ${payload.tripId} no longer exists`), { retryable: false });
    }
    // Reinstating is refused while this job is live, so this is belt and braces.
    if (trip.status !== TRIP_STATUS.CANCELLED) {
      return { skipped: true, reason: `the departure is ${trip.status}, not cancelled`, refunded: 0, paidMinor: 0, refunds: [] };
    }

    const summary = await refundEveryone(payload, ctx);

    // One entry for the whole cancellation, however many batches and attempts.
    if (summary.refunded) {
      await audit.record({
        action: AUDIT_ACTIONS.REFUND_DISRUPTION,
        entity: { type: "trip", id: String(trip.id), label: `${trip.train?.name} ${trip.departureDate}` },
        after: {
          refunded: summary.refunded,
          paid: money.format(summary.paidMinor),
          reason: payload.reason,
          job: ctx.job.id,
          attempts: ctx.attempt,
        },
        message:
          `${summary.refunded} ticket(s) refunded in full — ${money.format(summary.paidMinor)} returned ` +
          `after ${payload.actorLabel || "the railway"} cancelled the service`,
      });
    }
    return summary;
  },
});

jobs.define("refund.coach_cancellation", {
  priority: 10,
  describe: "Refund every passenger on a cancelled coach, and queue each one's message",
  handler: async (payload, ctx) => {
    const coach = await TripCoach.findOne({ where: { id: payload.tripCoachId, tripId: payload.tripId } });
    if (!coach) {
      throw Object.assign(new Error(`Coach ${payload.tripCoachId} no longer exists`), { retryable: false });
    }
    if (coach.status !== TRIP_COACH_STATUS.CANCELLED) {
      return { skipped: true, reason: `coach ${coach.coachCode} is ${coach.status}, not cancelled`, refunded: 0, paidMinor: 0, refunds: [] };
    }

    const summary = await refundEveryone(payload, ctx);

    if (summary.refunded) {
      await audit.record({
        action: AUDIT_ACTIONS.REFUND_DISRUPTION,
        entity: { type: "trip", id: String(payload.tripId), label: `${coach.coachCode} on trip ${payload.tripId}` },
        after: {
          refunded: summary.refunded,
          paid: money.format(summary.paidMinor),
          reason: payload.reason,
          job: ctx.job.id,
          attempts: ctx.attempt,
        },
        message:
          `${summary.refunded} ticket(s) on coach ${coach.coachCode} refunded in full — ` +
          `${money.format(summary.paidMinor)} returned`,
      });
    }
    return summary;
  },
});

/**
 * Tell one passenger their service was cancelled.
 *
 * Strict delivery: a mail server that refuses is an error here, and the job
 * retries it with backoff instead of the message being logged and lost. An
 * account with no email address is not an error — there is nothing to retry.
 */
jobs.define("notify.departure_cancelled", {
  priority: 0,
  describe: "Email one passenger that their service was cancelled and refunded",
  handler: async (payload) => {
    const sent = await notify.departureCancelled(payload, { strict: true });
    return sent ? { sent: true } : { sent: false, reason: "no email address on the account" };
  },
});

module.exports = jobs;
