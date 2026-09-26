const { Op } = require("sequelize");
const {
  sequelize,
  TrainName,
  TrainCoach,
  TrainSchedule,
  SeatPlan,
  CoachClass,
  Trip,
  TripCoach,
  TripSeat,
  RouteStop,
  Station,
  Ticket,
  Booking,
} = require("../models");
const { TRIP_STATUS } = require("../models/Trip");
const { TICKET_STATUS } = require("../models/Ticket");
const { TRIP_COACH_STATUS } = require("../models/TripCoach");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { PLAN_STATUS } = require("../constants/planStatus");
const { materializeSeats } = require("../utils/seatMaterializer");
const { horizonDates, dayOfWeek, todayInDhaka } = require("../utils/dhakaTime");
const { scheduleFor } = require("./scheduleService");
const quotaService = require("./quotaService");
const settings = require("./settingService");
const audit = require("./auditService");
const jobs = require("./jobService");
const { JOB_STATUS } = require("../models/Job");

/* ------------------------------------------------------------------ *
 * Building one departure
 * ------------------------------------------------------------------ */

/**
 * Copy a train's composition onto a trip and flatten every layout into seat
 * rows, inside one transaction.
 *
 * Only **approved** seat plans are put into service. A layout still in draft or
 * awaiting review is somebody's work in progress, and selling seats from it
 * would make the approval step decorative. Skipped coaches are reported rather
 * than silently dropped.
 */
/**
 * Put one coach on a departure, seats and all.
 *
 * Extracted from `buildTrip` so that adding a coach to a running departure goes
 * through exactly the path that built the original ones. A second copy of this
 * — the obvious way to write "add a coach" — would drift: the day somebody adds
 * a seat attribute here and forgets the other, coaches added mid-life would
 * quietly sell differently from coaches built at generation.
 *
 * Returns `{ skipped }` rather than throwing for a plan that cannot be built,
 * because generation wants to carry on past one bad coach and report it. A
 * caller adding a single coach turns that into an error itself.
 */
async function buildCoach(trip, { coachCode, position, plan }, transaction) {
  if (!plan || plan.status !== PLAN_STATUS.APPROVED) {
    return { skipped: { coachCode, reason: `plan is ${plan?.status || "missing"}` } };
  }

  let seats;
  try {
    seats = materializeSeats(plan.layout);
  } catch (err) {
    return { skipped: { coachCode, reason: err.message } };
  }

  if (!seats.length) {
    return { skipped: { coachCode, reason: "layout has no numbered seats" } };
  }

  const tripCoach = await TripCoach.create(
    {
      tripId: trip.id,
      position,
      coachCode,
      seatPlanId: plan.id,
      coachClassId: plan.coachClassId,
      seatCount: seats.length,
      status: TRIP_COACH_STATUS.ACTIVE,
    },
    { transaction }
  );

  await TripSeat.bulkCreate(
    seats.map((seat) => ({
      tripId: trip.id,
      tripCoachId: tripCoach.id,
      coachClassId: plan.coachClassId,
      seatNumber: seat.seatNumber,
      rowIndex: seat.rowIndex,
      cellIndex: seat.cellIndex,
      isWindow: seat.isWindow,
      windowType: seat.windowType,
      chargingPort: seat.chargingPort,
      fan: seat.fan,
      note: seat.note,
      attributes: seat.attributes,
    })),
    { transaction }
  );

  return { tripCoach, seatCount: seats.length };
}

async function buildTrip(trip, composition, transaction) {
  const skipped = [];
  let seatTotal = 0;

  for (const coach of composition) {
    const built = await buildCoach(
      trip,
      { coachCode: coach.coachCode, position: coach.position, plan: coach.seatPlan },
      transaction
    );
    if (built.skipped) {
      skipped.push(built.skipped);
      continue;
    }
    seatTotal += built.seatCount;
  }

  await trip.update({ generatedAt: new Date() }, { transaction });
  return { seatTotal, skipped };
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

/**
 * Extend the rolling horizon.
 *
 * Idempotent by construction: the unique constraint on (train, departure date)
 * means a second run finds the existing departure rather than creating a
 * duplicate, so this is safe to run on a timer, on boot, and by hand.
 */
async function generateHorizon({ days, trainId, actorLabel = "scheduled job" } = {}) {
  const horizonDays = days || settings.get("trip.horizon_days");
  const dates = horizonDates(horizonDays);

  const where = { isActive: true, ...(trainId ? { id: Number(trainId) } : {}) };
  const trains = await TrainName.findAll({
    where,
    include: [
      {
        model: TrainCoach,
        as: "coaches",
        required: false,
        include: [{ model: SeatPlan, as: "seatPlan" }],
      },
      { model: TrainSchedule, as: "schedules", required: false },
    ],
    order: [["name", "ASC"]],
  });

  const report = {
    horizonDays,
    from: dates[0],
    to: dates[dates.length - 1],
    created: 0,
    existing: 0,
    seatsCreated: 0,
    quotaAssigned: 0,
    trains: [],
  };

  for (const train of trains) {
    const composition = (train.coaches || [])
      .filter((c) => c.isActive)
      .sort((a, b) => a.position - b.position);
    const schedules = train.schedules || [];

    const summary = { train: train.name, created: 0, existing: 0, seats: 0, notes: [] };

    if (!composition.length) {
      summary.notes.push("no composition set");
      report.trains.push(summary);
      continue;
    }
    if (!schedules.length) {
      summary.notes.push("no schedule set");
      report.trains.push(summary);
      continue;
    }

    // Why a coach cannot be built is a property of the composition, not of this
    // particular pass — so it is reported even when every departure already
    // exists and nothing is created. Otherwise a repeat run says "0 created"
    // and leaves an operator with no explanation for the empty departures.
    for (const coach of composition) {
      const status = coach.seatPlan?.status;
      if (status !== PLAN_STATUS.APPROVED) {
        summary.notes.push(`${coach.coachCode}: plan is ${status || "missing"}`);
      }
    }

    for (const date of dates) {
      const schedule = scheduleFor(schedules, date);
      if (!schedule || !schedule.runsOnDay(dayOfWeek(date))) continue;

      const existing = await Trip.findOne({
        where: { trainId: train.id, departureDate: date },
      });
      if (existing) {
        summary.existing++;
        report.existing++;
        continue;
      }

      let newTripId = null;

      await sequelize.transaction(async (transaction) => {
        const trip = await Trip.create(
          { trainId: train.id, departureDate: date, status: TRIP_STATUS.SCHEDULED },
          { transaction }
        );
        const { seatTotal, skipped } = await buildTrip(trip, composition, transaction);

        newTripId = trip.id;
        summary.created++;
        summary.seats += seatTotal;
        report.created++;
        report.seatsCreated += seatTotal;

        for (const skip of skipped) {
          const note = `${skip.coachCode}: ${skip.reason}`;
          if (!summary.notes.includes(note)) summary.notes.push(note);
        }
      });

      // Seat distribution runs after the departure exists and has committed —
      // quota needs real seat rows to point at, and opening a second
      // transaction inside the first would deadlock.
      if (newTripId) {
        const quota = await quotaService.materialiseForTrip(newTripId);
        summary.quotaAssigned = (summary.quotaAssigned || 0) + quota.assigned;
        report.quotaAssigned += quota.assigned;
      }
    }

    report.trains.push(summary);
  }

  if (report.created > 0) {
    await audit.record({
      action: AUDIT_ACTIONS.TRIP_GENERATE,
      entity: { type: "horizon", id: report.to, label: `${report.from} → ${report.to}` },
      after: { created: report.created, seats: report.seatsCreated },
      message: `${actorLabel}: ${report.created} departures, ${report.seatsCreated} seats`,
    });
  }

  return report;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

async function list({ trainId, from, to, status, limit = 200 } = {}) {
  const where = {};
  if (trainId) where.trainId = Number(trainId);
  if (status) where.status = status;
  where.departureDate = {
    [Op.gte]: from || todayInDhaka(),
    ...(to ? { [Op.lte]: to } : {}),
  };

  const trips = await Trip.findAll({
    where,
    include: [
      { model: TrainName, as: "train" },
      { model: TripCoach, as: "coaches", include: [{ model: CoachClass, as: "coachClass" }] },
    ],
    order: [
      ["departureDate", "ASC"],
      ["trainId", "ASC"],
    ],
    limit: Math.min(Number(limit), 500),
  });

  return trips.map((trip) => {
    const coaches = trip.coaches || [];
    const active = coaches.filter((c) => c.status === TRIP_COACH_STATUS.ACTIVE);

    // Seats per class, which is the shape the departure board actually needs.
    const byClass = active.reduce((acc, coach) => {
      const name = coach.coachClass?.name || "Unknown";
      acc[name] = (acc[name] || 0) + coach.seatCount;
      return acc;
    }, {});

    return {
      ...trip.toPublicJSON(),
      coaches: undefined,
      coachCount: active.length,
      seatCount: active.reduce((n, c) => n + c.seatCount, 0),
      seatsByClass: byClass,
    };
  });
}

async function findOr404(id) {
  const trip = await Trip.findByPk(id, {
    include: [
      { model: TrainName, as: "train" },
      {
        model: TripCoach,
        as: "coaches",
        include: [{ model: CoachClass, as: "coachClass" }],
      },
    ],
    order: [[{ model: TripCoach, as: "coaches" }, "position", "ASC"]],
  });
  if (!trip) throw ApiError.notFound("Departure not found");
  return trip;
}

async function get(id) {
  const trip = await findOr404(id);

  const stops = await RouteStop.findAll({
    where: { trainId: trip.trainId },
    include: [{ model: Station, as: "station" }],
    order: [["sequence", "ASC"]],
  });

  const json = trip.toPublicJSON();
  const active = (trip.coaches || []).filter((c) => c.status === TRIP_COACH_STATUS.ACTIVE);

  return {
    ...json,
    // Segments are what Phase 4 will sell inventory against.
    segmentCount: Math.max(stops.length - 1, 0),
    stops: stops.map((s) => s.toPublicJSON()),
    coachCount: active.length,
    seatCount: active.reduce((n, c) => n + c.seatCount, 0),
  };
}

/** Seats on a departure, optionally narrowed to one coach. */
async function seats(tripId, { tripCoachId } = {}) {
  const where = { tripId: Number(tripId) };
  if (tripCoachId) where.tripCoachId = Number(tripCoachId);

  const rows = await TripSeat.findAll({
    where,
    // The coach's printed code and the class name, so a list of seats can say
    // "KA · AC Chair" rather than an internal coach id.
    include: [
      { model: TripCoach, as: "coach", attributes: ["coachCode", "position"] },
      { model: CoachClass, as: "coachClass", attributes: ["name"] },
    ],
    order: [
      ["tripCoachId", "ASC"],
      ["rowIndex", "ASC"],
      ["cellIndex", "ASC"],
    ],
  });
  return rows.map((r) => ({
    ...r.toPublicJSON(),
    coachCode: r.coach?.coachCode ?? null,
    coachPosition: r.coach?.position ?? null,
    coachClass: r.coachClass?.name ?? null,
  }));
}

/* ------------------------------------------------------------------ *
 * Changing a departure
 * ------------------------------------------------------------------ */

/**
 * Rebuild a departure from the train's current composition.
 *
 * Destroys and re-materialises the coaches and seats, which is only safe while
 * nothing has been sold. Phase 5 will add the guard that refuses once tickets
 * exist; today there are none to protect.
 */
async function rebuild(id) {
  const trip = await findOr404(id);

  if (trip.status === TRIP_STATUS.CANCELLED) {
    throw ApiError.badRequest("This departure is cancelled — it cannot be rebuilt");
  }

  /*
   * Rebuilding replaces every seat row, and a ticket points at one.
   *
   * The database already refuses to delete a seat a ticket references, which is
   * exactly right — but letting it refuse means the operator gets a foreign-key
   * error out of MySQL instead of an explanation. Checking here turns that into
   * a sentence, and names the way forward.
   *
   * **Every ticket counts, not only the valid ones.** The first version of this
   * guard counted live tickets, on the reasoning that a refunded ticket is not
   * somebody's seat any more. True, and irrelevant: the *row* still carries
   * `trip_seat_id`, so the delete still fails. A departure where every
   * passenger had returned their ticket therefore sailed past the guard and
   * produced the raw 500 the guard exists to prevent — which is how this was
   * found.
   */
  const live = await Ticket.count({
    where: { status: TICKET_STATUS.VALID },
    include: [{ model: Booking, as: "booking", where: { tripId: trip.id }, required: true }],
  });
  const anyTickets = await Ticket.count({
    include: [{ model: Booking, as: "booking", where: { tripId: trip.id }, required: true }],
  });

  if (live > 0) {
    throw ApiError.conflict(
      `${live} ticket(s) have been sold on this departure, and rebuilding would replace the ` +
        "very seats those passengers hold. Cancel the departure first — that refunds everyone " +
        "in full — or rebuild a departure nobody has booked yet."
    );
  }

  if (anyTickets > 0) {
    // Nobody is travelling, but the history still points at these seats. Said
    // differently from the case above, because the way forward is different:
    // there is nothing to cancel and nobody to refund.
    throw ApiError.conflict(
      `No ticket on this departure is still valid, but ${anyTickets} returned or cancelled ` +
        "ticket(s) still reference its seats, and rebuilding would destroy the record of what " +
        "those passengers held. Generate a fresh departure instead of rebuilding this one."
    );
  }

  const composition = await TrainCoach.findAll({
    where: { trainId: trip.trainId, isActive: true },
    include: [{ model: SeatPlan, as: "seatPlan" }],
    order: [["position", "ASC"]],
  });

  let result;
  await sequelize.transaction(async (transaction) => {
    await TripSeat.destroy({ where: { tripId: trip.id }, transaction });
    await TripCoach.destroy({ where: { tripId: trip.id }, transaction });
    result = await buildTrip(trip, composition, transaction);
  });

  // Seats are new rows, so the old reservations pointed at seats that no longer
  // exist. Rule-made quota is rebuilt; hand-placed holds went with the seats.
  await quotaService.materialiseForTrip(trip.id, { replace: true });

  await audit.record({
    action: AUDIT_ACTIONS.TRIP_REBUILD,
    entity: { type: "trip", id: trip.id, label: `${trip.train.name} ${trip.departureDate}` },
    after: { seats: result.seatTotal, skipped: result.skipped },
    message: `rebuilt with ${result.seatTotal} seats`,
  });

  return { ...(await get(trip.id)), skipped: result.skipped };
}

/**
 * Cancel a departure, and refund everyone aboard.
 *
 * ## Written down before it is done
 *
 * The departure is marked cancelled and its refund job queued in **one
 * transaction**: there is no moment at which it is cancelled with nobody owed
 * anything recorded, and no refund job exists for a cancellation that rolled
 * back. The refunds themselves run in the job (jobs/handlers.js), which is
 * what lets a mass refund survive a restart part-way through — the job is
 * still in the table, and resumes with the passengers not yet paid.
 *
 * ## Still answers with what it refunded, usually
 *
 * The request waits up to `jobs.inline_wait_seconds` for the job. An ordinary
 * departure's refunds finish well inside that, and the answer says what was
 * refunded, as it always did. A bigger one answers with the job still running,
 * and the operator watches it on the Background Jobs screen.
 *
 * Nothing is deducted and no policy switch applies: a deduction prices the cost
 * of a passenger changing their mind, and here the railway changed the plan.
 */
async function cancel(id, reason, { actorId = null, actorLabel = "a cancellation" } = {}) {
  const trip = await findOr404(id);
  if (trip.status === TRIP_STATUS.CANCELLED) {
    throw ApiError.badRequest("This departure is already cancelled");
  }

  const before = trip.status;
  const words = reason?.trim() || null;
  let job;

  await sequelize.transaction(async (transaction) => {
    await trip.update({ status: TRIP_STATUS.CANCELLED, cancellationReason: words }, { transaction });
    await TripCoach.update(
      { status: TRIP_COACH_STATUS.CANCELLED },
      { where: { tripId: trip.id }, transaction }
    );
    // Where this cancellation's refunds begin, so its summary never counts an
    // earlier cancellation's — see refundService.disruptionSummary.
    const afterRefundId = await require("./refundService").lastRefundId({ transaction });
    job = await jobs.enqueue(
      "refund.trip_cancellation",
      { tripId: trip.id, reason: words, actorLabel, afterRefundId },
      {
        transaction,
        dedupeKey: `trip-cancel:${trip.id}`,
        createdById: actorId,
        label: `Refund everyone on ${trip.train.name}, ${trip.departureDate}`,
      }
    );
  });

  await audit.record({
    action: AUDIT_ACTIONS.TRIP_CANCEL,
    entity: { type: "trip", id: trip.id, label: `${trip.train.name} ${trip.departureDate}` },
    before: { status: before },
    after: { status: TRIP_STATUS.CANCELLED, refundJob: job.id },
    message: `${words || "no reason given"} — refunds queued as job #${job.id}`,
  });

  const settled = await jobs.waitFor(job.id, settings.get("jobs.inline_wait_seconds") * 1000);
  const done = settled?.status === JOB_STATUS.SUCCEEDED;

  return {
    ...(await get(trip.id)),
    job: settled ? settled.toPublicJSON() : null,
    // What was refunded — or null while the job is still working through it.
    refunds: done ? settled.result : null,
  };
}

/**
 * Refunds still being issued for a departure, or for any coach of it.
 *
 * Reinstating in the middle would put seats back on sale while their previous
 * holders are still being refunded, and then the refunds would carry on against
 * a departure that is running. So both reinstatements wait for this to clear.
 */
async function refundsInFlight(tripId) {
  return (
    (await jobs.liveFor({ dedupeKey: `trip-cancel:${tripId}` })) ||
    (await jobs.liveFor({ dedupePrefix: `coach-cancel:${tripId}:` }))
  );
}

function refusalWhileRefunding(job, what) {
  const p = job.progress || {};
  const far = Number.isFinite(p.total) ? ` (${p.done ?? 0} of ${p.total} done)` : "";
  return ApiError.conflict(
    `Refunds from the cancellation are still being issued — job #${job.id}${far}. ` +
      `Reinstate ${what} once they finish.`
  );
}

/**
 * Put a cancelled departure back.
 *
 * Cancelling was a one-way door until this existed: `rebuild` refuses a
 * cancelled trip, so an operator who cancelled the wrong train had destroyed
 * that departure with no way back short of editing the database. Railways
 * cancel for fog and reinstate when it lifts, and the software should be able
 * to follow.
 *
 * The seats themselves were never deleted — cancelling only marks the coaches
 * cancelled, which is what takes them out of sale. So reinstating is a matter
 * of undoing those two marks.
 *
 * What reinstating does *not* undo is the refunds. Cancelling pays every
 * passenger back in full and puts their seats on sale, and that money has
 * already reached their wallets — clawing it back because the service was
 * restored would be worse than the train running lightly loaded. So a
 * reinstated departure comes back empty of its old passengers and open for
 * sale, and the result says how many tickets were refunded on the way out.
 */
async function reinstate(id, reason) {
  const trip = await findOr404(id);

  if (trip.status !== TRIP_STATUS.CANCELLED) {
    throw ApiError.badRequest(`This departure is ${trip.status}, not cancelled`);
  }

  const inFlight = await refundsInFlight(trip.id);
  if (inFlight) throw refusalWhileRefunding(inFlight, "the departure");

  await trip.update({ status: TRIP_STATUS.SCHEDULED, cancellationReason: null });
  await TripCoach.update(
    { status: TRIP_COACH_STATUS.ACTIVE },
    { where: { tripId: trip.id, status: TRIP_COACH_STATUS.CANCELLED } }
  );

  const refundedOnCancellation = await require("./refundService").countForTrip(trip.id);

  await audit.record({
    action: AUDIT_ACTIONS.TRIP_REINSTATE,
    entity: { type: "trip", id: trip.id, label: `${trip.train.name} ${trip.departureDate}` },
    before: { status: TRIP_STATUS.CANCELLED, cancellationReason: trip.cancellationReason },
    after: { status: TRIP_STATUS.SCHEDULED },
    message:
      (reason?.trim() || "no reason given") +
      (refundedOnCancellation
        ? ` — ${refundedOnCancellation} ticket(s) were refunded when it was cancelled and do not come back`
        : ""),
  });

  return { ...(await get(trip.id)), refundedOnCancellation };
}

/* ------------------------------------------------------------------ *
 * Refund options
 * ------------------------------------------------------------------ */

/**
 * Choose which return policies this departure offers.
 *
 * Global settings decide how much each policy deducts; this decides whether it
 * is on the menu here at all. Both are on unless someone turns one off.
 */
/**
 * Turn connecting standing on or off for this departure.
 *
 * Only ever more restrictive than the coach class: switching it on here does
 * not make a class sell standing that has no capacity configured.
 */
async function setStanding(id, enabled, actorLabel) {
  const trip = await findOr404(id);
  const before = trip.standingEnabled;

  await trip.update({ standingEnabled: Boolean(enabled) });

  await audit.record({
    action: AUDIT_ACTIONS.STANDING_OPTIONS,
    entity: { type: "trip", id: trip.id, label: `${trip.train.name} ${trip.departureDate}` },
    before: { standingEnabled: before },
    after: { standingEnabled: Boolean(enabled) },
    message: `standing ${enabled ? "on" : "off"}${actorLabel ? ` (${actorLabel})` : ""}`,
  });

  return get(trip.id);
}

async function setRefundOptions(id, { convenient, demand }, actorLabel) {
  const trip = await findOr404(id);

  const before = {
    convenientReturnEnabled: trip.convenientReturnEnabled,
    demandReturnEnabled: trip.demandReturnEnabled,
  };

  const after = {
    convenientReturnEnabled:
      convenient === undefined ? trip.convenientReturnEnabled : Boolean(convenient),
    demandReturnEnabled: demand === undefined ? trip.demandReturnEnabled : Boolean(demand),
  };

  await trip.update(after);

  const describe = (o) =>
    [o.convenientReturnEnabled ? "convenient" : null, o.demandReturnEnabled ? "demand" : null]
      .filter(Boolean)
      .join(" and ") || "none";

  await audit.record({
    action: AUDIT_ACTIONS.REFUND_OPTIONS,
    entity: { type: "trip", id: trip.id, label: `${trip.train.name} ${trip.departureDate}` },
    before,
    after,
    message: `returns offered: ${describe(after)}${actorLabel ? ` (${actorLabel})` : ""}`,
  });

  return get(trip.id);
}

module.exports = {
  buildCoach,
  generateHorizon,
  list,
  get,
  seats,
  rebuild,
  cancel,
  reinstate,
  refundsInFlight,
  refusalWhileRefunding,
  setRefundOptions,
  setStanding,
};
