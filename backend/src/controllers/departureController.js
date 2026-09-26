const asyncHandler = require("../utils/asyncHandler");
const compositionService = require("../services/compositionService");
const scheduleService = require("../services/scheduleService");
const tripService = require("../services/tripService");
const coachService = require("../services/coachService");
const jobs = require("../jobs");

/* ---------------- Composition ---------------- */

const getComposition = asyncHandler(async (req, res) => {
  res.json({ coaches: await compositionService.get(req.params.id) });
});

const setComposition = asyncHandler(async (req, res) => {
  const coaches = await compositionService.set(req.params.id, req.body.coaches);
  const seats = coaches.reduce((n, c) => n + c.seatCount, 0);
  res.json({
    message: `Composition saved — ${coaches.length} coaches, ${seats} seats`,
    coaches,
  });
});

/* ---------------- Schedule ---------------- */

const getSchedule = asyncHandler(async (req, res) => {
  res.json({ schedules: await scheduleService.get(req.params.id) });
});

const setSchedule = asyncHandler(async (req, res) => {
  res.json({
    message: "Schedule saved",
    schedules: await scheduleService.set(req.params.id, req.body.schedules),
  });
});

/* ---------------- Departures ---------------- */

const listTrips = asyncHandler(async (req, res) => {
  res.json({
    trips: await tripService.list({
      trainId: req.query.trainId,
      from: req.query.from,
      to: req.query.to,
      status: req.query.status,
      limit: req.query.limit,
    }),
  });
});

const getTrip = asyncHandler(async (req, res) => {
  res.json({ trip: await tripService.get(req.params.id) });
});

const getTripSeats = asyncHandler(async (req, res) => {
  res.json({
    seats: await tripService.seats(req.params.id, { tripCoachId: req.query.tripCoachId }),
  });
});

const generate = asyncHandler(async (req, res) => {
  const report = await tripService.generateHorizon({
    days: req.body.days,
    trainId: req.body.trainId,
    actorLabel: `manual (${req.user.email})`,
  });
  res.json({
    message: `${report.created} departures created, ${report.existing} already existed`,
    report,
  });
});

const rebuildTrip = asyncHandler(async (req, res) => {
  const trip = await tripService.rebuild(req.params.id);
  res.json({ message: `Rebuilt with ${trip.seatCount} seats`, trip });
});

/**
 * 200 with what was refunded when the refund job finished while we waited;
 * 202 with the job when it is still going — the departure is cancelled either
 * way, and the refunds are owed and queued either way.
 */
const cancelTrip = asyncHandler(async (req, res) => {
  const trip = await tripService.cancel(req.params.id, req.body.reason, {
    actorId: req.user.id,
    actorLabel: req.user.fullName || req.user.email,
  });
  if (trip.refunds) {
    return res.json({
      message: `Departure cancelled — ${trip.refunds.refunded} ticket(s) refunded in full`,
      trip,
    });
  }
  res.status(202).json({
    message: `Departure cancelled. Refunds are being issued in the background (job #${trip.job?.id}).`,
    trip,
  });
});

/* ---------------- Jobs ---------------- */

const reinstateTrip = asyncHandler(async (req, res) => {
  const trip = await tripService.reinstate(req.params.id, req.body.reason);
  res.json({ message: `${trip.departureDate} is running again`, trip });
});

/** Which return policies this departure offers. */
const setRefundOptions = asyncHandler(async (req, res) => {
  const trip = await tripService.setRefundOptions(
    req.params.id,
    { convenient: req.body.convenient, demand: req.body.demand },
    req.user.email
  );
  const offered = [
    trip.convenientReturnEnabled ? "convenient" : null,
    trip.demandReturnEnabled ? "demand" : null,
  ].filter(Boolean);

  res.json({
    message: offered.length
      ? `Returns offered on ${trip.departureDate}: ${offered.join(" and ")}`
      : `No returns are offered on ${trip.departureDate}`,
    trip,
  });
});

/** Whether this departure sells connecting standing. */
const setStanding = asyncHandler(async (req, res) => {
  const trip = await tripService.setStanding(req.params.id, req.body.enabled, req.user.email);
  res.json({
    message: trip.standingEnabled
      ? `Standing is on sale on ${trip.departureDate}`
      : `Standing is off on ${trip.departureDate}`,
    trip,
  });
});

const jobStatus = asyncHandler(async (_req, res) => {
  res.json({ jobs: jobs.status() });
});

/* ---------------- Coaches on one departure (§14.1) ---------------- */

const listCoaches = asyncHandler(async (req, res) => {
  res.json(await coachService.list(req.params.id));
});

const addCoach = asyncHandler(async (req, res) => {
  const result = await coachService.add(
    req.params.id,
    {
      seatPlanId: req.body.seatPlanId,
      coachCode: req.body.coachCode,
      position: req.body.position,
    },
    { actorId: req.user.id }
  );
  res.status(201).json({ message: `Coach ${result.coach.coachCode} added`, ...result });
});

const removeCoach = asyncHandler(async (req, res) => {
  const result = await coachService.remove(req.params.id, req.params.coachId, {
    actorId: req.user.id,
  });
  res.json({ message: `Coach ${result.removed} removed`, ...result });
});

const cancelCoach = asyncHandler(async (req, res) => {
  const result = await coachService.cancel(req.params.id, req.params.coachId, {
    reason: req.body.reason,
    actorId: req.user.id,
    actorLabel: req.user.fullName || req.user.email,
  });
  if (result.refunded === null) {
    return res.status(202).json({
      message:
        `Coach ${result.coach.coachCode} cancelled. Its passengers are being refunded in the ` +
        `background (job #${result.job?.id}).`,
      ...result,
    });
  }
  res.json({
    message:
      `Coach ${result.coach.coachCode} cancelled. ${result.refunded} passenger(s) refunded ` +
      `${result.paidFormatted} in full and told why.`,
    ...result,
  });
});

const reinstateCoach = asyncHandler(async (req, res) => {
  const result = await coachService.reinstate(req.params.id, req.params.coachId, {
    reason: req.body.reason,
    actorId: req.user.id,
  });
  res.json({ message: `Coach ${result.coach.coachCode} back in service`, ...result });
});

module.exports = {
  listCoaches,
  addCoach,
  removeCoach,
  cancelCoach,
  reinstateCoach,
  getComposition,
  setComposition,
  getSchedule,
  setSchedule,
  listTrips,
  getTrip,
  getTripSeats,
  generate,
  rebuildTrip,
  cancelTrip,
  reinstateTrip,
  setRefundOptions,
  setStanding,
  jobStatus,
};
