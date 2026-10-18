const { Op } = require("sequelize");
const { Station, TrainName, RouteStop, TrainSchedule, Trip, RailwayTimetable, DemoRecord, Job, User } = require("../models");
const { TIMETABLE_STATUS } = require("../models/RailwayTimetable");
const { JOB_STATUS, FINISHED } = require("../models/Job");
const { TRIP_STATUS } = require("../models/Trip");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const ApiError = require("../utils/ApiError");
const { runningDays } = require("../utils/timetable");
const { compareRoute, keepDistances, sameDays, droppedDays, weekdayOf } = require("../utils/timetableDiff");
const { todayInDhaka, addDays } = require("../utils/dhakaTime");
const source = require("../data/railway/source");
const railway = require("./railwayService");
const trainService = require("./trainService");
const scheduleService = require("./scheduleService");
const audit = require("./auditService");
const jobs = require("./jobService");

/**
 * Keeping the server's trains in step with what the railway publishes now.
 *
 * Two steps, each a background job:
 *
 *   1. **Check** asks the railway for every train on its list (data/railway/
 *      source), for the timetable two days ahead, and compares it with what
 *      the server has: new trains and stations, trains renamed, times moved,
 *      stations changed, running days changed, trains no longer published,
 *      and trains it could not fetch. Nothing changes; the result is kept for
 *      someone to review.
 *   2. **Apply** carries out the newest check — compared again as things are
 *      at that moment — and reports what it did, skipped and why.
 *
 * The rules Apply follows, train by train:
 *
 *   - New stations and trains are added, trains with their route. Coaches,
 *     seat plans and fares are Load's business and are never touched here.
 *   - Times that moved on the same stations are taken, even on a train with
 *     departures — the railway moved them — keeping the distances saved, so
 *     fares do not shift and corrected distances survive.
 *   - Stations added, removed or reordered: the route is replaced, unless the
 *     train has departures still to run; then it is left and named.
 *     Departures read their train's route, so changing stations under sold
 *     seats would corrupt them.
 *   - Running days: the train's schedule follows, when it is the single
 *     undated one loading gives a train; departures already generated on days
 *     it no longer runs are listed, not cancelled.
 *   - Trains no longer published are reported; nothing is deleted.
 *
 * An applied timetable becomes the one Load works from (railwayService
 * `currentTimetable`).
 */

const CHECK_JOB = "railway.check";
const APPLY_JOB = "railway.sync_apply";
const RAILWAY_JOBS = ["railway.load", CHECK_JOB, APPLY_JOB];

/** Trains asked for at once — with a pause between batches (source `pauseMs`): polite to an API that is not ours. */
const BATCH = 4;
/** More than this share of trains failing means the railway is not answering: nothing is kept. */
const TOO_MANY_FAILED = 0.5;
/** Applied timetables kept; older ones are dropped. */
const KEEP_APPLIED = 5;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const daysText = (days) => (days.length === 7 ? "every day" : days.map((d) => DAY_NAMES[d]).join(", ") || "no day");

/* ------------------------------------------------------------------ *
 * Asking the railway
 * ------------------------------------------------------------------ */

async function fetchAll(date, progress) {
  const numbers = source.TRAIN_NUMBERS;
  const trains = [];
  const unpublished = [];
  const failed = [];
  for (let i = 0; i < numbers.length; i += BATCH) {
    const batch = numbers.slice(i, i + BATCH);
    const answers = await Promise.allSettled(batch.map((number) => source.fetchTrain(number, date)));
    answers.forEach((answer, j) => {
      if (answer.status === "rejected") failed.push({ number: batch[j], error: answer.reason?.message || "no answer" });
      else if (answer.value) trains.push(answer.value);
      else unpublished.push(batch[j]);
    });
    await progress?.({ total: numbers.length, done: Math.min(i + BATCH, numbers.length), step: "Asking the railway" });
    if (i + BATCH < numbers.length) await source.sleep(source.pauseMs());
  }
  trains.sort((a, b) => a.number - b.number);
  return { trains, unpublished, failed };
}

/* ------------------------------------------------------------------ *
 * Comparing
 * ------------------------------------------------------------------ */

const stillToRun = (today) => ({ departureDate: { [Op.gte]: today }, status: { [Op.ne]: TRIP_STATUS.CANCELLED } });

/**
 * What applying this timetable would change here, as things stand now.
 * `unpublished` are the train numbers the railway said it has no timetable
 * for; `failed`, those it did not answer for — unknown, not unpublished.
 * Both are in `timetable` as they were before (see `check`), so they
 * compare as unchanged.
 */
async function compare(timetable, { unpublished = [], failed = [] } = {}, now = new Date()) {
  const p = railway.prepare(timetable);
  const today = todayInDhaka(now);

  const [stations, trains] = await Promise.all([
    Station.findAll({ attributes: ["id", "name"] }),
    TrainName.findAll({ attributes: ["id", "name", "code"] }),
  ]);
  const stationNames = new Set(stations.map((s) => s.name.toLowerCase()));
  const byCode = new Map(trains.filter((t) => t.code).map((t) => [String(t.code), t]));
  const byName = new Map(trains.map((t) => [t.name.toLowerCase(), t]));

  const matched = p.trains.map((t) => ({ t, train: byCode.get(String(t.number)) || byName.get(t.name.toLowerCase()) || null }));
  const ids = matched.filter((m) => m.train).map((m) => m.train.id);
  const [stops, schedules] = await Promise.all([
    ids.length
      ? RouteStop.findAll({ where: { trainId: ids }, include: [{ association: "station", attributes: ["name"] }], order: [["trainId", "ASC"], ["sequence", "ASC"]] })
      : [],
    ids.length ? TrainSchedule.findAll({ where: { trainId: ids } }) : [],
  ]);
  const routeOf = (trainId) => stops.filter((s) => s.trainId === trainId);
  const schedulesOf = (trainId) => schedules.filter((s) => s.trainId === trainId);

  const diff = {
    requestedFor: timetable.requestedFor,
    newStations: p.cities.filter((city) => !stationNames.has(city.toLowerCase())),
    newTrains: [],
    renamed: [],
    times: [],
    stations: [],
    days: [],
    unpublished: [],
    failed: failed.map((f) => f.number),
    unchanged: 0,
  };

  for (const { t, train } of matched) {
    const published = t.stops.map((s) => ({ station: s.city, arrivalTime: s.arrivalTime, departureTime: s.departureTime, dayOffset: s.dayOffset }));
    const nextDays = runningDays(t.days);
    const ends = { from: t.stops[0]?.city || null, to: t.stops[t.stops.length - 1]?.city || null };
    if (!t.stops.length) continue; // nothing usable was published for it

    if (!train) {
      diff.newTrains.push({ number: t.number, name: t.name, stops: t.stops.length, ...ends, runsOn: nextDays });
      continue;
    }

    const who = { trainId: train.id, number: t.number, name: t.name };
    let changed = false;

    if (train.name !== t.name) {
      diff.renamed.push({ ...who, from: train.name, to: t.name });
      changed = true;
    }

    const saved = routeOf(train.id).map((r) => ({
      station: r.station?.name || "",
      arrivalTime: r.arrivalTime,
      departureTime: r.departureTime,
      dayOffset: r.dayOffset,
      distanceKm: r.distanceKm,
    }));
    const route = compareRoute(saved, published);
    if (route.kind === "times") {
      diff.times.push({ ...who, stops: route.stops });
      changed = true;
    } else if (route.kind === "stations" || route.kind === "new_route") {
      const upcoming = route.kind === "stations" ? await Trip.count({ where: { trainId: train.id, ...stillToRun(today) } }) : 0;
      diff.stations.push({
        ...who,
        newRoute: route.kind === "new_route",
        added: route.added || [],
        removed: route.removed || [],
        reordered: Boolean(route.reordered),
        stops: t.stops.length,
        upcoming,
        willApply: upcoming === 0,
      });
      changed = true;
    }

    // Running days are kept only on a train with a schedule — the ones with coaches.
    const held = schedulesOf(train.id);
    if (held.length) {
      const simple = held.length === 1 && !held[0].effectiveFrom && !held[0].effectiveTo;
      const before = [...new Set(held.flatMap((s) => s.runsOn || []))].sort();
      if (!sameDays(before, nextDays)) {
        const dropped = droppedDays(before, nextDays);
        const stranded = dropped.length
          ? (await Trip.findAll({ where: { trainId: train.id, ...stillToRun(today) }, attributes: ["departureDate"], order: [["departureDate", "ASC"]] }))
              .map((trip) => trip.departureDate)
              .filter((date) => dropped.includes(weekdayOf(date)))
          : [];
        diff.days.push({ ...who, from: before, to: nextDays, willApply: simple, stranded });
        changed = true;
      }
    }

    if (!changed) diff.unchanged++;
  }

  // Here, and no longer published by the railway.
  const gone = new Set(unpublished.map(String));
  for (const train of trains) {
    if (gone.has(String(train.code || ""))) diff.unpublished.push({ trainId: train.id, number: Number(train.code), name: train.name });
  }

  diff.counts = {
    published: p.trains.length,
    newStations: diff.newStations.length,
    newTrains: diff.newTrains.length,
    renamed: diff.renamed.length,
    times: diff.times.length,
    stations: diff.stations.length,
    days: diff.days.length,
    unpublished: diff.unpublished.length,
    failed: diff.failed.length,
    unchanged: diff.unchanged,
  };
  diff.upToDate = !(
    diff.newStations.length ||
    diff.newTrains.length ||
    diff.renamed.length ||
    diff.times.length ||
    diff.stations.length ||
    diff.days.length
  );
  return diff;
}

/* ------------------------------------------------------------------ *
 * The two jobs
 * ------------------------------------------------------------------ */

/** Ask the railway and compare. The result waits for someone to apply it. */
async function check({ actorId = null } = {}, ctx = {}) {
  const date = addDays(todayInDhaka(), 2);
  const fetched = await fetchAll(date, ctx.progress);

  if (!fetched.trains.length || fetched.failed.length > source.TRAIN_NUMBERS.length * TOO_MANY_FAILED) {
    const why = fetched.failed[0]?.error || "nothing came back";
    throw new Error(
      `The railway did not answer for ${fetched.failed.length} of ${source.TRAIN_NUMBERS.length} trains (${why}). ` +
        "Its service may be down or may have changed. Nothing was changed; try again later."
    );
  }

  // A train the railway did not answer for, or no longer publishes, keeps the
  // timetable it had: nothing is deleted, and Load still finds every train it
  // gives coaches to.
  const answered = new Set(fetched.trains.map((t) => t.number));
  const carried = (await railway.currentTimetable()).trains.filter((t) => !answered.has(t.number));
  const trains = [...fetched.trains, ...carried].sort((x, y) => x.number - y.number);

  const timetable = { source: source.sourceUrl(), requestedFor: date, fetchedAt: new Date().toISOString(), trains };
  await ctx.progress?.({ total: source.TRAIN_NUMBERS.length, done: source.TRAIN_NUMBERS.length, step: "Comparing with the server" });
  const diff = await compare(timetable, { unpublished: fetched.unpublished, failed: fetched.failed });

  // A newer check replaces one never applied.
  await RailwayTimetable.destroy({ where: { status: TIMETABLE_STATUS.CHECKED } });
  const row = await RailwayTimetable.create({
    status: TIMETABLE_STATUS.CHECKED,
    source: timetable.source,
    requestedFor: date,
    fetchedAt: timetable.fetchedAt,
    trains,
    unpublished: fetched.unpublished,
    failed: fetched.failed,
    diff,
    checkedById: actorId,
  });

  const c = diff.counts;
  await audit.record({
    action: AUDIT_ACTIONS.RAILWAY_SYNC_CHECK,
    entity: { type: "railway_timetable", id: row.id, label: `timetable for ${date}` },
    after: c,
    message: diff.upToDate
      ? `checked with the railway: ${c.published} trains, all as the server has them`
      : `checked with the railway: ${c.newTrains} new train(s), ${c.newStations} new station(s), ${c.times} with new times, ` +
        `${c.stations} with changed stations, ${c.days} with changed running days`,
  });
  return { timetableId: row.id, requestedFor: date, upToDate: diff.upToDate, counts: c };
}

/** Carry out a check, compared again as things are now. */
async function apply({ timetableId, actorId = null } = {}, ctx = {}) {
  if (await DemoRecord.count()) throw ApiError.conflict(railway.DEMO_FIRST);
  const row = await RailwayTimetable.findByPk(timetableId);
  if (!row || row.status !== TIMETABLE_STATUS.CHECKED) {
    throw ApiError.conflict("That check was replaced or has been applied already. Check with the railway again.");
  }

  const timetable = row.asSnapshot();
  const p = railway.prepare(timetable);
  const step = (i, label) => ctx.progress?.({ total: 6, done: i, step: label });
  await step(0, "Comparing with the server");
  const diff = await compare(timetable, { unpublished: row.unpublished, failed: row.failed });

  const report = {
    requestedFor: row.requestedFor,
    stations: { created: 0 },
    trains: { created: 0, renamed: 0 },
    routes: { times: 0, replaced: 0, skipped: 0 },
    days: { updated: 0, skipped: 0 },
    stranded: [],
    unpublished: diff.unpublished,
    failed: diff.failed,
    warnings: [],
  };
  const warn = (text) => report.warnings.push(text);

  // Stations first: every route below needs them.
  await step(1, "Stations");
  const existing = await Station.findAll({ attributes: ["id", "code", "name"] });
  const stationIds = new Map(existing.map((s) => [s.name.toLowerCase(), s.id]));
  const taken = new Set(existing.map((s) => s.code));
  for (const city of diff.newStations) {
    const station = await Station.create({ code: railway.stationCode(city, taken), name: city });
    stationIds.set(city.toLowerCase(), station.id);
    report.stations.created++;
  }
  const stopsOf = (number) =>
    p.byNumber.get(number).stops.map((s) => ({
      stationId: stationIds.get(s.city.toLowerCase()),
      arrivalTime: s.arrivalTime,
      departureTime: s.departureTime,
      dayOffset: s.dayOffset,
      distanceKm: s.distanceKm,
      haltMinutes: s.haltMinutes,
    }));
  const attempt = async (name, work) => {
    try {
      await work();
      return true;
    } catch (err) {
      warn(`${name}: ${err.message}`);
      return false;
    }
  };

  await step(2, "New trains");
  for (const t of diff.newTrains) {
    await attempt(t.name, async () => {
      const train = await TrainName.create({ name: t.name, code: String(t.number) });
      report.trains.created++;
      await trainService.setRoute(train.id, stopsOf(t.number));
    });
  }

  await step(3, "Names and times");
  for (const r of diff.renamed) {
    if (await attempt(r.from, () => TrainName.update({ name: r.to }, { where: { id: r.trainId } }))) report.trains.renamed++;
  }
  for (const c of diff.times) {
    const saved = await RouteStop.findAll({ where: { trainId: c.trainId }, order: [["sequence", "ASC"]] });
    if (await attempt(c.name, () => trainService.setRoute(c.trainId, keepDistances(saved, stopsOf(c.number))))) report.routes.times++;
  }

  await step(4, "Changed stations");
  for (const c of diff.stations) {
    if (!c.willApply) {
      report.routes.skipped++;
      const what = [
        c.added.length && `adds ${c.added.join(", ")}`,
        c.removed.length && `drops ${c.removed.join(", ")}`,
        c.reordered && "reorders its stops",
      ]
        .filter(Boolean)
        .join("; ");
      warn(
        `${c.name}: the railway's route ${what}, but it has ${c.upcoming} departure(s) still to run, so its route was ` +
          "left as it is. Apply again once they have run."
      );
      continue;
    }
    if (await attempt(c.name, () => trainService.setRoute(c.trainId, stopsOf(c.number)))) report.routes.replaced++;
  }

  await step(5, "Running days");
  for (const c of diff.days) {
    if (!c.willApply) {
      report.days.skipped++;
      warn(`${c.name}: the railway runs it ${daysText(c.to)}, but its running days were set by hand, so they were left as they are.`);
      continue;
    }
    const [current] = await TrainSchedule.findAll({ where: { trainId: c.trainId } });
    if (await attempt(c.name, () => scheduleService.set(c.trainId, [{ runsOn: c.to, isActive: current?.isActive !== false }]))) {
      report.days.updated++;
      if (c.stranded.length) report.stranded.push({ trainId: c.trainId, name: c.name, dates: c.stranded, runsOn: c.to });
    }
  }

  await step(6, "Done");
  await row.update({ status: TIMETABLE_STATUS.APPLIED, report, appliedById: actorId, appliedAt: new Date() });
  const old = await RailwayTimetable.findAll({
    where: { status: TIMETABLE_STATUS.APPLIED },
    attributes: ["id"],
    order: [["id", "DESC"]],
    offset: KEEP_APPLIED,
  });
  if (old.length) await RailwayTimetable.destroy({ where: { id: old.map((r) => r.id) } });

  await audit.record({
    action: AUDIT_ACTIONS.RAILWAY_SYNC_APPLY,
    entity: { type: "railway_timetable", id: row.id, label: `timetable for ${row.requestedFor}` },
    after: {
      stations: report.stations,
      trains: report.trains,
      routes: report.routes,
      days: report.days,
      stranded: report.stranded.length,
      warnings: report.warnings.length,
    },
    message:
      `railway timetable applied — ${report.trains.created} new train(s), ${report.routes.times} with new times, ` +
      `${report.routes.replaced} route(s) replaced, ${report.routes.skipped} skipped, ${report.days.updated} with new running days`,
  });
  return report;
}

/* ------------------------------------------------------------------ *
 * Starting them, and what the page shows
 * ------------------------------------------------------------------ */

/** One railway job at a time: a load, a check or an apply. */
async function busy() {
  return Job.findOne({ where: { type: RAILWAY_JOBS, status: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] }, order: [["id", "DESC"]] });
}

async function startCheck({ actorId }) {
  const live = await busy();
  if (live) {
    if (live.type === CHECK_JOB) return { job: live, started: false };
    throw ApiError.conflict(`Another railway job is running (job #${live.id}). Try again when it has finished.`);
  }
  const job = await jobs.enqueue(CHECK_JOB, { actorId }, { createdById: actorId, maxAttempts: 1, label: "Check with the railway" });
  return { job, started: true };
}

async function startApply(timetableId, { actorId }) {
  const live = await busy();
  if (live) throw ApiError.conflict(`Another railway job is running (job #${live.id}). Try again when it has finished.`);
  if (await DemoRecord.count()) throw ApiError.conflict(railway.DEMO_FIRST);
  const row = await RailwayTimetable.findByPk(timetableId, { attributes: ["id", "status"] });
  if (!row || row.status !== TIMETABLE_STATUS.CHECKED) {
    throw ApiError.conflict("That check was replaced or has been applied already. Check with the railway again.");
  }
  // Safe to run again after a restart: it compares afresh, and does only what is still missing.
  const job = await jobs.enqueue(APPLY_JOB, { timetableId: row.id, actorId }, { createdById: actorId, maxAttempts: 2, label: "Apply the railway's timetable" });
  return { job, started: true };
}

const WITHOUT_TRAINS = { exclude: ["trains"] };
const WITH_PEOPLE = [
  { model: User, as: "checkedBy", attributes: ["id", "fullName"] },
  { model: User, as: "appliedBy", attributes: ["id", "fullName"] },
];

/** For the Railway Data page: a check waiting, the last apply, and any sync job. */
async function status() {
  const [pending, lastApplied, live, lastJob] = await Promise.all([
    RailwayTimetable.findOne({ where: { status: TIMETABLE_STATUS.CHECKED }, attributes: WITHOUT_TRAINS, include: WITH_PEOPLE, order: [["id", "DESC"]] }),
    RailwayTimetable.findOne({ where: { status: TIMETABLE_STATUS.APPLIED }, attributes: WITHOUT_TRAINS, include: WITH_PEOPLE, order: [["id", "DESC"]] }),
    Job.findOne({ where: { type: [CHECK_JOB, APPLY_JOB], status: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] }, order: [["id", "DESC"]] }),
    Job.findOne({ where: { type: [CHECK_JOB, APPLY_JOB], status: FINISHED }, order: [["id", "DESC"]] }),
  ]);
  return {
    pending: pending ? pending.toPublicJSON() : null,
    lastApplied: lastApplied ? lastApplied.toPublicJSON() : null,
    job: live ? live.toPublicJSON() : null,
    lastJob: lastJob ? lastJob.toPublicJSON() : null,
  };
}

module.exports = { CHECK_JOB, APPLY_JOB, RAILWAY_JOBS, compare, check, apply, startCheck, startApply, status };
