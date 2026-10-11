const { Op, literal } = require("sequelize");
const {
  Station,
  TrainName,
  RouteStop,
  SeatPlan,
  CoachType,
  CoachClass,
  TrainCoach,
  TrainSchedule,
  Trip,
  FareRule,
  User,
  Role,
  DemoRecord,
  Job,
} = require("../models");
const { JOB_STATUS, FINISHED } = require("../models/Job");
const { PLAN_STATUS } = require("../constants/planStatus");
const { RESERVED_ROLES } = require("../constants/roles");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const ApiError = require("../utils/ApiError");
const { getContext } = require("../utils/requestContext");
const { buildStops, fastestSegments, estimateDistances, runningDays, parseDuration } = require("../utils/timetable");
const { countSeats } = require("../utils/seatMaterializer");
const { buildLayout } = require("../seeders/importSeatPlans");
const { DISTANCE_RATES } = require("../seeders/seedNetwork");
const { LAYOUTS, RAKES } = require("../data/railway/seatPlans");
const timetable = require("../data/railway/timetable.json");
const trainService = require("./trainService");
const compositionService = require("./compositionService");
const scheduleService = require("./scheduleService");
const fareService = require("./fareService");
const audit = require("./auditService");
const jobs = require("./jobService");
const settings = require("./settingService");

/**
 * The real railway: Bangladesh Railway's published timetable, and the seat
 * plans transcribed for its trains.
 *
 * Loading builds, from the committed snapshot (data/railway/timetable.json):
 * every station and train with its route, running days and estimated
 * distances; every transcribed seat plan — an approved copy for each train a
 * source names, a draft for each source that names none; and, for the trains
 * that have plans, a coach line-up, running days and per-kilometre fares, so
 * departures can be generated and sold.
 *
 * Like the demo data, it fills in what is missing and leaves what is there
 * alone: an existing station, plan, composition, schedule or fare rule is
 * used as it is, so an edit made after loading survives loading again. A
 * route is replaced only where the timetable itself differs, and never on a
 * train that already has departures — that would move stations out from
 * under sold seats.
 *
 * It refuses while demo data is present. The demo's stations share names
 * with the real ones; real routes built on them would stop "Delete demo data"
 * from ever working.
 */

const JOB_TYPE = "railway.load";
const DEDUPE_KEY = "railway-data";
const STEPS = ["Stations", "Trains and routes", "Seat plans", "Coaches and running days", "Fares"];

const DEMO_FIRST =
  "Demo data is loaded. Its stations share names with the real ones, so delete the demo data first " +
  "(Demo Data → Delete demo data), then load the railway.";

/* ------------------------------------------------------------------ *
 * The snapshot, converted
 * ------------------------------------------------------------------ */

let prepared = null;

/** The timetable as route stops, with distances — worked out once per process. */
function prepare() {
  if (prepared) return prepared;

  const trains = timetable.trains.map((t) => ({ ...t, ...buildStops(t.routes) }));
  const fastest = fastestSegments(trains.map((t) => t.stops));

  for (const t of trains) {
    const km = estimateDistances(t.stops, fastest);
    t.stops.forEach((stop, i) => {
      stop.distanceKm = km[i];
    });

    const first = t.stops[0];
    const last = t.stops[t.stops.length - 1];
    const minutes = last.arrivalAt - first.departureAt;
    const published = parseDuration(t.totalDuration);
    if (published !== null && Math.abs(minutes - published) > 30) {
      t.notes.push(`the stops add up to ${hours(minutes)} against the published ${t.totalDuration}`);
    }
  }

  const cities = [...new Set(trains.flatMap((t) => t.stops.map((s) => s.city)))];
  prepared = { trains, cities, byNumber: new Map(trains.map((t) => [t.number, t])) };
  return prepared;
}

const hours = (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

const layoutByKey = new Map(LAYOUTS.map((l) => [l.key, l]));
const readyNumbers = [...new Set(RAKES.flatMap((r) => r.trains))];

/** "Dhaka" -> "DHA"; "Biman_Bandar" -> "BIMB"; a number on the end when taken. */
function stationCode(name, taken) {
  const words = name.replace(/[^A-Za-z0-9\s_-]/g, "").split(/[\s_-]+/).filter(Boolean);
  const base = (words[0].slice(0, 3) + words.slice(1).map((w) => w[0]).join("")).toUpperCase().slice(0, 8);
  let code = base;
  for (let n = 2; taken.has(code); n++) code = `${base}${n}`;
  taken.add(code);
  return code;
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

function newReport() {
  return {
    snapshot: { fetchedAt: timetable.fetchedAt, trains: timetable.trains.length },
    stations: { created: 0, existing: 0, removed: 0 },
    trains: { created: 0, existing: 0 },
    routes: { replaced: 0, unchanged: 0, skipped: 0 },
    plans: { approved: 0, drafts: 0, existing: 0 },
    compositions: { set: 0, existing: 0 },
    schedules: { set: 0, existing: 0 },
    fareRules: { created: 0, existing: 0 },
    ready: 0,
    notes: [],
    warnings: [],
  };
}

async function loadStations(report) {
  const { cities } = prepare();
  const existing = await Station.findAll({ attributes: ["id", "code", "name"] });
  const byName = new Map(existing.map((s) => [s.name.toLowerCase(), s]));
  const taken = new Set(existing.map((s) => s.code));
  const ids = new Map();

  for (const city of cities) {
    let station = byName.get(city.toLowerCase());
    if (station) {
      report.stations.existing++;
    } else {
      station = await Station.create({ code: stationCode(city, taken), name: city });
      report.stations.created++;
    }
    ids.set(city, station.id);
  }
  return ids;
}

const hhmm = (time) => (time ? String(time).slice(0, 5) : null);

/** Same stations and times as the timetable, and distances present — nothing to replace. */
function sameRoute(current, stops) {
  if (current.length !== stops.length) return false;
  return stops.every((stop, i) => {
    const row = current[i];
    return (
      row.stationId === stop.stationId &&
      hhmm(row.arrivalTime) === stop.arrivalTime &&
      hhmm(row.departureTime) === stop.departureTime &&
      row.dayOffset === stop.dayOffset &&
      row.distanceKm !== null
    );
  });
}

async function loadTrains(report, stationIds) {
  const ids = new Map();

  for (const t of prepare().trains) {
    let train = await TrainName.findOne({ where: { name: t.name } });
    if (train) {
      report.trains.existing++;
      if (!train.code) await train.update({ code: String(t.number) });
    } else {
      train = await TrainName.create({ name: t.name, code: String(t.number) });
      report.trains.created++;
    }
    ids.set(t.number, train.id);

    for (const note of t.notes) report.notes.push(`${t.name}: ${note}.`);

    const stops = t.stops.map((s) => ({
      stationId: stationIds.get(s.city),
      arrivalTime: s.arrivalTime,
      departureTime: s.departureTime,
      dayOffset: s.dayOffset,
      distanceKm: s.distanceKm,
      haltMinutes: s.haltMinutes,
    }));

    const current = await RouteStop.findAll({ where: { trainId: train.id }, order: [["sequence", "ASC"]] });
    if (sameRoute(current, stops)) {
      report.routes.unchanged++;
      continue;
    }

    const departures = await Trip.count({ where: { trainId: train.id } });
    if (departures) {
      report.routes.skipped++;
      report.warnings.push(
        `${t.name}'s published route differs from the one saved, but it has ${departures} departure(s), so ` +
          "its route was left as it is. Change it on the train's route once those departures have run."
      );
      continue;
    }

    try {
      await trainService.setRoute(train.id, stops);
      report.routes.replaced++;
    } catch (err) {
      report.routes.skipped++;
      report.warnings.push(`${t.name}: the route was not saved — ${err.message}`);
    }
  }
  return ids;
}

/** Whoever pressed the button; from the command line, the first super admin. */
async function authorId() {
  const actor = getContext().actor?.id;
  if (actor) return actor;
  const admin = await User.findOne({
    include: [{ model: Role, as: "roles", where: { name: RESERVED_ROLES.SUPER_ADMIN }, attributes: [] }],
    order: [["id", "ASC"]],
  });
  if (!admin) throw new Error("There is no super admin to file the seat plans under.");
  return admin.id;
}

async function loadPlans(report, trainIds) {
  const author = await authorId();
  const refs = new Map();
  const ref = async (Model, name) => {
    if (!name) return null;
    const key = `${Model.name}:${name}`;
    if (!refs.has(key)) {
      const [row] = await Model.findOrCreate({ where: { name }, defaults: { name } });
      refs.set(key, row.id);
    }
    return refs.get(key);
  };

  // Every layout is built — and its seat count checked — before any is saved.
  const built = LAYOUTS.map((l) => ({ l, layout: buildLayout({ ...l, train: l.key }) }));
  const planIds = new Map();

  for (const { l, layout } of built) {
    const coachTypeId = await ref(CoachType, l.coachType);
    const coachClassId = await ref(CoachClass, l.coachClass);

    if (!l.trains.length) {
      const existing = await SeatPlan.findOne({ where: { coachNo: l.coachNo, trainNameId: null } });
      if (existing) {
        report.plans.existing++;
        continue;
      }
      await SeatPlan.create({
        coachNo: l.coachNo,
        trainNameId: null,
        coachTypeId,
        coachClassId,
        layout,
        status: PLAN_STATUS.DRAFT,
        createdById: author,
      });
      report.plans.drafts++;
      continue;
    }

    for (const number of l.trains) {
      const trainNameId = trainIds.get(number);
      let plan = await SeatPlan.findOne({ where: { coachNo: l.coachNo, trainNameId } });
      if (plan) {
        report.plans.existing++;
        if (plan.status !== PLAN_STATUS.APPROVED) {
          report.notes.push(
            `${prepare().byNumber.get(number).name}: seat plan ${l.coachNo} is ${plan.status}, so its coaches ` +
              "will have no seats until it is approved."
          );
        }
      } else {
        plan = await SeatPlan.create({
          coachNo: l.coachNo,
          trainNameId,
          coachTypeId,
          coachClassId,
          layout,
          status: PLAN_STATUS.APPROVED,
          createdById: author,
          approvedById: author,
          approvedAt: new Date(),
        });
        report.plans.approved++;
      }
      planIds.set(`${l.key}:${number}`, plan.id);
    }
  }
  return planIds;
}

async function loadRakes(report, trainIds, planIds) {
  for (const rake of RAKES) {
    for (const number of rake.trains) {
      const trainId = trainIds.get(number);

      if (await TrainCoach.count({ where: { trainId } })) {
        report.compositions.existing++;
      } else {
        await compositionService.set(
          trainId,
          rake.coaches.map(([coachCode, key]) => ({ coachCode, seatPlanId: planIds.get(`${key}:${number}`) }))
        );
        report.compositions.set++;
      }

      if (await TrainSchedule.count({ where: { trainId } })) {
        report.schedules.existing++;
      } else {
        const runsOn = runningDays(prepare().byNumber.get(number).days);
        await scheduleService.set(trainId, [{ runsOn, isActive: true }]);
        report.schedules.set++;
      }
    }
  }
}

/** A per-kilometre fallback for each class the trains carry, unless one is already set. */
async function loadFares(report) {
  const carried = new Set(RAKES.flatMap((r) => r.coaches.map(([, key]) => layoutByKey.get(key).coachClass)));

  for (const [className, ratePerKm, minFare] of DISTANCE_RATES) {
    if (!carried.has(className)) continue;
    const coachClass = await CoachClass.findOne({ where: { name: className } });
    const existing = await FareRule.findOne({
      where: { coachClassId: coachClass.id, trainId: null, kind: "distance", isActive: true },
    });
    if (existing) {
      report.fareRules.existing++;
      continue;
    }
    await fareService.createRule({
      name: `${className} — per kilometre`,
      kind: "distance",
      priority: 200, // The fallback: any table or train-specific rule wins over it.
      coachClassId: coachClass.id,
      ratePerKm,
      minFare,
    });
    report.fareRules.created++;
  }
}

/**
 * Stations no route uses and nothing else refers to. Command-line only: on a
 * live system a station may have been added for a route not yet built.
 */
async function removeUnusedStations(report) {
  const unused = await Station.findAll({
    where: { id: { [Op.notIn]: literal("(SELECT DISTINCT station_id FROM route_stops)") } },
  });
  for (const station of unused) {
    try {
      await station.destroy();
      report.stations.removed++;
    } catch (err) {
      if (err.name !== "SequelizeForeignKeyConstraintError") throw err;
    }
  }
}

/** Load (or top up) the railway. Safe to run again: whatever is there is used as it is. */
async function load(ctx = {}, { removeUnused = false } = {}) {
  if (await DemoRecord.count()) throw ApiError.conflict(DEMO_FIRST);

  const report = newReport();
  const step = (i) => ctx.progress?.({ total: STEPS.length, done: i, step: STEPS[i] ?? "Done" });

  await step(0);
  const stationIds = await loadStations(report);
  await step(1);
  const trainIds = await loadTrains(report, stationIds);
  await step(2);
  const planIds = await loadPlans(report, trainIds);
  await step(3);
  await loadRakes(report, trainIds, planIds);
  await step(4);
  await loadFares(report);
  if (removeUnused) await removeUnusedStations(report);
  await step(STEPS.length);

  report.ready = (await readyTrains()).length;

  await audit.record({
    action: AUDIT_ACTIONS.RAILWAY_LOAD,
    entity: { type: "railway_data", id: null, label: `timetable of ${timetable.fetchedAt.slice(0, 10)}` },
    after: {
      stations: report.stations,
      trains: report.trains,
      routes: report.routes,
      plans: report.plans,
      ready: report.ready,
    },
    message:
      `railway loaded — ${report.trains.created} new train(s), ${report.routes.replaced} route(s) saved, ` +
      `${report.plans.approved + report.plans.drafts} new seat plan(s), ${report.ready} train(s) ready`,
  });

  return report;
}

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

/** Seats per plan, remembered until the plan changes — layouts are large. */
const seatCache = new Map();

async function seatsByPlan(planIds) {
  if (!planIds.length) return new Map();
  const heads = await SeatPlan.findAll({ where: { id: planIds }, attributes: ["id", "updatedAt"] });
  const stale = heads.filter((p) => seatCache.get(p.id)?.updatedAt !== p.updatedAt.getTime()).map((p) => p.id);
  if (stale.length) {
    for (const plan of await SeatPlan.findAll({ where: { id: stale }, attributes: ["id", "updatedAt", "layout"] })) {
      let seats = 0;
      try {
        seats = countSeats(plan.layout);
      } catch {
        seats = 0;
      }
      seatCache.set(plan.id, { updatedAt: plan.updatedAt.getTime(), seats });
    }
  }
  return new Map(heads.map((p) => [p.id, seatCache.get(p.id).seats]));
}

/**
 * Trains a departure can be generated for: active, with a running day, and
 * coaches whose plans are approved. With their line-up, for the status page.
 */
async function readyTrains() {
  const trains = await TrainName.findAll({
    where: { isActive: true },
    attributes: ["id", "name", "code"],
    include: [
      {
        model: TrainCoach,
        as: "coaches",
        required: true,
        where: { isActive: true },
        attributes: ["coachCode", "position", "seatPlanId"],
        include: [
          {
            model: SeatPlan,
            as: "seatPlan",
            required: true,
            where: { status: PLAN_STATUS.APPROVED },
            attributes: ["id", "coachClassId"],
            include: [{ model: CoachClass, as: "coachClass", attributes: ["name"] }],
          },
        ],
      },
      { model: TrainSchedule, as: "schedules", required: true, where: { isActive: true }, attributes: ["runsOn"] },
      {
        model: RouteStop,
        as: "stops",
        attributes: ["sequence", "arrivalTime", "departureTime", "dayOffset"],
        include: [{ association: "station", attributes: ["name"] }],
      },
    ],
    order: [
      ["name", "ASC"],
      [{ model: TrainCoach, as: "coaches" }, "position", "ASC"],
      [{ model: RouteStop, as: "stops" }, "sequence", "ASC"],
    ],
  });

  const seats = await seatsByPlan([...new Set(trains.flatMap((t) => t.coaches.map((c) => c.seatPlanId)))]);

  return trains
    .map((train) => {
      const runsOn = [...new Set(train.schedules.flatMap((s) => s.runsOn || []))].sort();
      const byClass = {};
      for (const coach of train.coaches) {
        const name = coach.seatPlan.coachClass?.name || "—";
        byClass[name] = (byClass[name] || 0) + (seats.get(coach.seatPlanId) || 0);
      }
      const first = train.stops[0];
      const last = train.stops[train.stops.length - 1];
      return {
        id: train.id,
        name: train.name,
        code: train.code,
        coaches: train.coaches.map((c) => c.coachCode),
        seats: Object.values(byClass).reduce((a, b) => a + b, 0),
        seatsByClass: byClass,
        runsOn,
        from: first?.station?.name || null,
        to: last?.station?.name || null,
        departs: hhmm(first?.departureTime),
        arrives: hhmm(last?.arrivalTime),
        arrivesDayOffset: last?.dayOffset ?? 0,
      };
    })
    .filter((t) => t.runsOn.length && t.seats > 0);
}

async function status() {
  const { trains, cities } = prepare();
  const names = trains.map((t) => t.name);
  const loaded = await TrainName.findAll({ where: { name: names }, attributes: ["id"] });
  const ids = loaded.map((t) => t.id);

  const draftCoachNos = LAYOUTS.filter((l) => !l.trains.length).map((l) => l.coachNo);
  const trainCoachNos = [...new Set(LAYOUTS.filter((l) => l.trains.length).map((l) => l.coachNo))];

  const [withRoutes, stations, approvedPlans, draftPlans, demoRecords, live, last, ready] = await Promise.all([
    ids.length ? RouteStop.count({ where: { trainId: ids }, distinct: true, col: "trainId" }) : 0,
    Station.count({ where: { name: cities } }),
    ids.length ? SeatPlan.count({ where: { trainNameId: ids, coachNo: trainCoachNos } }) : 0,
    SeatPlan.count({ where: { trainNameId: null, coachNo: draftCoachNos } }),
    DemoRecord.count(),
    Job.findOne({ where: { type: JOB_TYPE, status: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] }, order: [["id", "DESC"]] }),
    Job.findOne({ where: { type: JOB_TYPE, status: FINISHED }, order: [["id", "DESC"]] }),
    readyTrains(),
  ]);

  return {
    snapshot: {
      source: timetable.source,
      fetchedAt: timetable.fetchedAt,
      trains: trains.length,
      stations: cities.length,
      plans: LAYOUTS.length,
      draftPlans: draftCoachNos.length,
      readyTrains: readyNumbers.length,
    },
    loaded: { trains: ids.length, withRoutes, stations, approvedPlans, draftPlans },
    // Loading never generates departures; this says whether the hourly job will.
    generation: { automatic: settings.get("trip.generation_enabled"), horizonDays: settings.get("trip.horizon_days") },
    demoPopulated: demoRecords > 0,
    blocker: demoRecords > 0 ? DEMO_FIRST : null,
    ready,
    job: live ? live.toPublicJSON() : null,
    lastJob: last ? last.toPublicJSON() : null,
  };
}

/** Queue a load. One at a time; asking again while one runs returns it. */
async function start({ actorId }) {
  const live = await Job.findOne({ where: { dedupeKey: DEDUPE_KEY, status: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] } });
  if (live) return { job: live, started: false };
  if (await DemoRecord.count()) throw ApiError.conflict(DEMO_FIRST);

  const job = await jobs.enqueue(JOB_TYPE, {}, {
    dedupeKey: DEDUPE_KEY,
    createdById: actorId,
    // Once more after a restart part-way: a second run fills in what the first did not.
    maxAttempts: 2,
    label: "Load railway data",
  });
  return { job, started: true };
}

module.exports = { JOB_TYPE, status, start, load, readyTrains, stationCode, prepare };
