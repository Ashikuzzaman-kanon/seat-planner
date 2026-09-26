const bcrypt = require("bcryptjs");
const { Op, fn, col, literal } = require("sequelize");
const models = require("../models");
const { JOB_STATUS, FINISHED } = require("../models/Job");
const { TICKET_STATUS } = require("../models/Ticket");
const { TRIP_STATUS } = require("../models/Trip");
const { REPORT_KIND } = require("../models/TicketReport");
const { PLAN_STATUS } = require("../constants/planStatus");
const { RESERVED_ROLES } = require("../constants/roles");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { sanitizePermissionKeys, PERMISSION_CATALOGUE } = require("../constants/permissions");
const { REFUND_TYPE } = require("../utils/refundPolicy");
const ApiError = require("../utils/ApiError");
const demoCapture = require("../utils/demoCapture");
const money = require("../utils/money");
const { runWithContext, getContext } = require("../utils/requestContext");
const { todayInDhaka, addDays } = require("../utils/dhakaTime");
const { findPermissionsByKeys } = require("./permissionService");
const trainService = require("./trainService");
const fareService = require("./fareService");
const seatAttributeService = require("./seatAttributeService");
const compositionService = require("./compositionService");
const scheduleService = require("./scheduleService");
const tripService = require("./tripService");
const walletService = require("./walletService");
const selectionService = require("./selectionService");
const bookingService = require("./bookingService");
const refundService = require("./refundService");
const postSaleService = require("./postSaleService");
const verificationService = require("./verificationService");
const abuseService = require("./abuseService");
const audit = require("./auditService");
const jobs = require("./jobService");
const { DEMO_ROLES, testUsersFor } = require("../seeders/demoAccounts");
const { PLANS, buildLayout } = require("../seeders/importSeatPlans");
const { STATIONS, SEAT_ATTRIBUTES, ROUTES, DISTANCE_RATES, PUBLISHED_TABLE, toStops } = require("../seeders/seedNetwork");
const { TRAINS } = require("../seeders/seedDepartures");

const {
  sequelize,
  DemoRecord,
  User,
  Role,
  UserRole,
  TrainName,
  CoachType,
  CoachClass,
  SeatPlan,
  Station,
  FareRule,
  RouteStop,
  TrainCoach,
  TrainSchedule,
  Trip,
  Booking,
  Ticket,
  TicketScan,
  TicketReport,
  AccountHold,
  Job,
} = models;

/**
 * Demo data: the super admin's "Populate" and "Delete" buttons.
 *
 * ## Populate
 *
 * Builds what a developer gets locally from the seeders — accounts for each
 * role, the transcribed seat plans, a network, two trains with departures,
 * and some sample activity — through the same services a person would use,
 * so the demo behaves exactly like real data.
 *
 * It is written for a database that may already hold real things. Anything
 * that already exists under the same name is **adopted, never modified**: an
 * existing `admin` role keeps its permissions, an existing
 * planner1@example.com keeps its password, an existing Ekota Express keeps
 * its route. The result says what was adopted, so nothing is a surprise.
 *
 * No super admin accounts are created: a super admin with a password that is
 * printed in the README is a door anyone can walk through.
 *
 * ## Delete
 *
 * Removes exactly what the demo created — every row is noted as it is made
 * (see `utils/demoCapture`) — plus the activity that happened *on* it since:
 * departures the daily job generated for the demo trains, bookings on demo
 * departures, anything demo accounts did. It refuses while someone outside
 * the demo still holds a valid ticket on a demo departure, or a demo account
 * holds one on a real departure: deleting either would take money and a seat
 * from under a live booking.
 *
 * Both run as background jobs, so a slow free-tier database cannot time a
 * request out part-way.
 */

const JOB_TYPES = Object.freeze({ POPULATE: "demo.populate", CLEAR: "demo.clear" });
const DEDUPE_KEY = "demo-data";

/** Every demo account the button creates: passengers, then each demo role. */
const DEMO_ACCOUNTS = [RESERVED_ROLES.DEFAULT, ...DEMO_ROLES.map((r) => r.name)].flatMap(testUsersFor);

const PASSENGER_EMAILS = testUsersFor(RESERVED_ROLES.DEFAULT).map((a) => a.email);
const CHECKER_EMAIL = "checker1@example.com";

/** "1 account", "2 accounts". */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const permissionLabel = (key) => PERMISSION_CATALOGUE.find((p) => p.key === key)?.label || key;

const STEPS = [
  "Accounts and roles",
  "Seat plans",
  "Stations and seat features",
  "Routes, fares and trains",
  "Departures",
  "Sample bookings",
];

/* ------------------------------------------------------------------ *
 * What the demo created
 * ------------------------------------------------------------------ */

async function trackedIds(model, { transaction } = {}) {
  const rows = await DemoRecord.findAll({ where: { model }, attributes: ["recordId"], raw: true, transaction });
  return rows.map((r) => r.recordId);
}

async function isTracked(model, id) {
  return Boolean(await DemoRecord.findOne({ where: { model, recordId: id }, attributes: ["id"] }));
}

/** `id IN (the ids the demo noted for this model)`, as a subquery. */
const trackedWhere = (model) => ({
  id: { [Op.in]: literal(`(SELECT record_id FROM demo_records WHERE model = ${sequelize.escape(model)})`) },
});

/**
 * The demo's reach: its accounts, its trains, and every departure of those
 * trains — including the ones the daily horizon job generated after the demo
 * was populated, which are demo departures without ever having been noted.
 */
async function scope({ transaction } = {}) {
  const users = await trackedIds("User", { transaction });
  const trains = await trackedIds("TrainName", { transaction });
  const noted = await trackedIds("Trip", { transaction });
  const ofTrains = trains.length
    ? (await Trip.findAll({ where: { trainId: trains }, attributes: ["id"], raw: true, transaction })).map((t) => t.id)
    : [];
  return { users, trains, trips: [...new Set([...noted, ...ofTrains])] };
}

/** Bookings on a demo departure, or made by a demo account. */
function bookingsInScope(s) {
  const either = [];
  if (s.trips.length) either.push({ tripId: s.trips });
  if (s.users.length) either.push({ userId: s.users });
  return either.length ? { [Op.or]: either } : null;
}

/* ------------------------------------------------------------------ *
 * What would stop a delete
 * ------------------------------------------------------------------ */

const LIVE_TICKET_EXAMPLES = 3;

/** Valid tickets on bookings matching `where`, grouped by booking. */
async function liveBookings(where, transaction) {
  const tickets = await Ticket.findAll({
    where: { status: TICKET_STATUS.VALID },
    attributes: ["id"],
    include: [
      {
        model: Booking,
        as: "booking",
        where,
        attributes: ["id", "reference"],
        include: [{ model: User, as: "user", attributes: ["email"] }],
      },
    ],
    transaction,
  });

  const byBooking = new Map();
  for (const t of tickets) {
    const b = t.booking;
    const entry = byBooking.get(b.id) || { reference: b.reference, email: b.user?.email || null, tickets: 0 };
    entry.tickets += 1;
    byBooking.set(b.id, entry);
  }
  return { tickets: tickets.length, bookings: [...byBooking.values()] };
}

const examples = (bookings) =>
  bookings
    .slice(0, LIVE_TICKET_EXAMPLES)
    .map((b) => `${b.reference} by ${b.email}`)
    .join(", ") + (bookings.length > LIVE_TICKET_EXAMPLES ? `, and ${bookings.length - LIVE_TICKET_EXAMPLES} more` : "");

/**
 * Reasons the demo cannot be deleted right now. Empty when it can.
 *
 * Only **valid** tickets block. A refunded, used or cancelled ticket on a
 * demo departure is history about a train that is going away, and goes with
 * it; a valid one is somebody's money and seat.
 */
async function blockers({ transaction } = {}) {
  const s = await scope({ transaction });
  const found = [];

  if (s.trips.length) {
    const outsiders = await liveBookings(
      { tripId: s.trips, ...(s.users.length ? { userId: { [Op.notIn]: s.users } } : {}) },
      transaction
    );
    if (outsiders.tickets) {
      found.push({
        kind: "outside_tickets_on_demo_departures",
        tickets: outsiders.tickets,
        bookings: outsiders.bookings,
        message:
          `${outsiders.tickets} valid ticket(s) on demo departures belong to accounts outside the demo ` +
          `(${examples(outsiders.bookings)}). Refund them first — cancelling a departure refunds everyone on it.`,
      });
    }
  }

  if (s.users.length) {
    const elsewhere = await liveBookings(
      { userId: s.users, ...(s.trips.length ? { tripId: { [Op.notIn]: s.trips } } : {}) },
      transaction
    );
    if (elsewhere.tickets) {
      found.push({
        kind: "demo_tickets_on_other_departures",
        tickets: elsewhere.tickets,
        bookings: elsewhere.bookings,
        message:
          `Demo accounts hold ${elsewhere.tickets} valid ticket(s) on departures the demo did not create ` +
          `(${examples(elsewhere.bookings)}). Refund those first.`,
      });
    }
  }

  return found;
}

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

async function accounts() {
  const users = await User.findAll({ where: { email: DEMO_ACCOUNTS.map((a) => a.email) }, attributes: ["id", "email"] });
  const byEmail = new Map(users.map((u) => [u.email, u]));
  const demoIds = new Set(await trackedIds("User"));

  return DEMO_ACCOUNTS.map((a) => {
    const user = byEmail.get(a.email);
    const state = !user ? "missing" : demoIds.has(user.id) ? "demo" : "existing";
    return {
      role: a.roles[0],
      name: a.fullName,
      email: a.email,
      // An account that was there before the demo keeps its own password,
      // which is not this one — so it is not shown for those.
      password: state === "existing" ? null : a.password,
      state,
    };
  });
}

async function status() {
  const noted = await DemoRecord.count();
  const s = await scope();
  const inScope = bookingsInScope(s);

  const count = (Model) => Model.count({ where: trackedWhere(Model.name) });

  const counts = {
    accounts: await count(User),
    roles: await count(Role),
    seatPlans: await count(SeatPlan),
    stations: await count(Station),
    trains: await count(TrainName),
    fareRules: await count(FareRule),
    departures: s.trips.length,
    bookings: inScope ? await Booking.count({ where: inScope }) : 0,
    tickets: inScope
      ? await Ticket.count({ include: [{ model: Booking, as: "booking", where: inScope, attributes: [] }] })
      : 0,
  };

  const [live, last] = await Promise.all([
    Job.findOne({ where: { type: Object.values(JOB_TYPES), status: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] }, order: [["id", "DESC"]] }),
    Job.findOne({ where: { type: Object.values(JOB_TYPES), status: FINISHED }, order: [["id", "DESC"]] }),
  ]);

  return {
    populated: noted > 0,
    counts,
    accounts: await accounts(),
    blockers: noted > 0 ? await blockers() : [],
    job: live ? live.toPublicJSON() : null,
    lastJob: last ? last.toPublicJSON() : null,
  };
}

/* ------------------------------------------------------------------ *
 * Starting a run
 * ------------------------------------------------------------------ */

/**
 * Queue a populate or a delete.
 *
 * One demo job at a time, of either kind: a delete racing a populate would
 * delete half of what the populate was still creating. Asking for the one
 * already running returns it rather than queueing a second.
 */
async function start(action, { actorId }) {
  const type = action === "clear" ? JOB_TYPES.CLEAR : JOB_TYPES.POPULATE;

  const live = await Job.findOne({ where: { dedupeKey: DEDUPE_KEY, status: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] } });
  if (live) {
    if (live.type === type) return { job: live, started: false };
    throw ApiError.conflict(
      `Wait for the demo ${live.type === JOB_TYPES.CLEAR ? "deletion" : "population"} already running (job #${live.id}) to finish.`
    );
  }

  if (type === JOB_TYPES.CLEAR) {
    if (!(await DemoRecord.count())) throw ApiError.badRequest("There is no demo data to delete.");
    const found = await blockers();
    if (found.length) {
      throw new ApiError(409, `The demo data cannot be deleted yet. ${found.map((b) => b.message).join(" ")}`, {
        blockers: found,
      });
    }
  }

  const job = await jobs.enqueue(type, {}, {
    dedupeKey: DEDUPE_KEY,
    createdById: actorId,
    // Once more after a restart part-way. Populating adopts what the first
    // attempt made; deleting is one transaction, so either ran or did not.
    maxAttempts: 2,
    label: type === JOB_TYPES.CLEAR ? "Delete demo data" : "Populate demo data",
  });
  return { job, started: true };
}

/* ------------------------------------------------------------------ *
 * Populate
 * ------------------------------------------------------------------ */

/** Act as one of the demo accounts, so the audit log names who did what. */
const as = (user, role, work) =>
  runWithContext({ actor: { id: user.id, email: user.email, roles: [role] }, method: "DEMO", path: "demo data" }, work);

async function seedAccounts(report) {
  for (const def of DEMO_ROLES) {
    const role = await Role.findOne({ where: { name: def.name } });
    if (!role) {
      const created = await Role.create({ name: def.name, description: def.description });
      await created.setPermissions(await findPermissionsByKeys(sanitizePermissionKeys(def.permissions)));
      continue;
    }
    if (await isTracked("Role", role.id)) continue;

    const held = new Set((await role.getPermissions()).map((p) => p.key));
    const missing = def.permissions.filter((key) => !held.has(key));
    const named = missing.slice(0, 3).map((key) => `"${permissionLabel(key)}"`).join(", ");
    report.notes.push(
      missing.length
        ? `The ${def.name} role already existed and was left as it is. It lacks ` +
            `${plural(missing.length, "permission")} the demo gives it (${named}${missing.length > 3 ? ", …" : ""}) — ` +
            "grant them on the Roles page for the full demo."
        : `The ${def.name} role already existed and was used as it is.`
    );
  }

  const adopted = [];
  for (const account of DEMO_ACCOUNTS) {
    const existing = await User.findOne({ where: { email: account.email }, attributes: ["id"] });
    if (existing) {
      if (!(await isTracked("User", existing.id))) adopted.push(account.email);
      continue;
    }

    const user = await User.create({
      fullName: account.fullName,
      email: account.email,
      passwordHash: await bcrypt.hash(account.password, 10),
      isVerified: true,
      ...(account.nid ? { nid: account.nid, dateOfBirth: account.dateOfBirth } : {}),
    });
    const roles = await Role.findAll({ where: { name: account.roles } });
    if (roles.length) await UserRole.bulkCreate(roles.map((r) => ({ userId: user.id, roleId: r.id })));
  }

  if (adopted.length) {
    report.notes.push(
      `${plural(adopted.length, "demo account")} already existed and ${adopted.length === 1 ? "was" : "were"} ` +
        `left alone, passwords unchanged: ${adopted.join(", ")}.`
    );
  }
}

async function seedSeatPlans(report) {
  const actorId = getContext().actor?.id ?? null;
  const author =
    (await User.findOne({ where: { email: "planner1@example.com" } })) || (actorId ? await User.findByPk(actorId) : null);
  if (!author) throw new Error("There is no account to file the seat plans under.");

  // Every layout is checked before any is written.
  const prepared = PLANS.map((plan) => ({ plan, layout: buildLayout(plan) }));

  const cache = new Map();
  const ref = async (Model, name) => {
    const key = `${Model.name}:${name}`;
    if (!cache.has(key)) {
      const [row] = await Model.findOrCreate({ where: { name }, defaults: { name } });
      cache.set(key, row.id);
    }
    return cache.get(key);
  };

  const adopted = [];
  const unapproved = [];
  for (const { plan, layout } of prepared) {
    const existing = await SeatPlan.findOne({ where: { coachNo: plan.key } });
    if (existing) {
      if (!(await isTracked("SeatPlan", existing.id))) {
        adopted.push(plan.key);
        if (existing.status !== PLAN_STATUS.APPROVED) unapproved.push(plan.key);
      }
      continue;
    }

    // Approved on creation. The command-line import leaves them pending for a
    // human to check against the source photographs; a demo is not asking
    // anyone to review a transcription, it is showing departures with seats.
    await SeatPlan.create({
      coachNo: plan.key,
      trainNameId: await ref(TrainName, plan.train),
      coachTypeId: await ref(CoachType, plan.coachType),
      coachClassId: await ref(CoachClass, plan.coachClass),
      layout,
      status: PLAN_STATUS.APPROVED,
      createdById: author.id,
      approvedById: actorId,
      approvedAt: new Date(),
    });
  }

  if (adopted.length) {
    report.notes.push(
      `${plural(adopted.length, "seat plan")} with the same coach numbers already existed and ` +
        `${adopted.length === 1 ? "was" : "were"} used as they are` +
        (unapproved.length
          ? ` — ${unapproved.length} not approved, so coaches built from those have no seats until they are.`
          : ".")
    );
  }
}

async function seedStations(report, state) {
  state.stationIds = new Map();
  let adopted = 0;
  for (const [code, name, district] of STATIONS) {
    // Code and name are each unique: a station already there under either is that station.
    const existing = await Station.findOne({ where: { [Op.or]: [{ code }, { name }] } });
    if (existing) {
      if (!(await isTracked("Station", existing.id))) adopted++;
      state.stationIds.set(code, existing.id);
      continue;
    }
    const created = await Station.create({ code, name, district });
    state.stationIds.set(code, created.id);
  }
  if (adopted) {
    report.notes.push(
      adopted === STATIONS.length
        ? `All ${STATIONS.length} stations already existed and were used as they are.`
        : `${adopted} of the ${STATIONS.length} stations already existed and were used as they are.`
    );
  }

  const existing = await seatAttributeService.list({ includeInactive: true });
  const keys = new Set(existing.map((a) => a.key));
  for (const attribute of SEAT_ATTRIBUTES) {
    if (!keys.has(attribute.key)) await seatAttributeService.create(attribute);
  }
}

/**
 * Routes, compositions, schedules and fares — for the demo's own trains only.
 *
 * A train that already existed is left entirely alone: giving it a route, a
 * schedule and departures would change a real train. Its fares are made for
 * the demo train alone, not as network-wide fallbacks, so a demo price can
 * never quietly start applying to a real train of the same class.
 */
async function seedTrains(report, state) {
  state.trains = [];

  for (const [trainName, route, identity] of ROUTES) {
    const train = await TrainName.findOne({ where: { name: trainName } });
    if (!train) {
      report.warnings.push(`${trainName} was not found, so it has no route or departures.`);
      continue;
    }
    if (!(await isTracked("TrainName", train.id))) {
      report.notes.push(`${trainName} already existed, so the demo left it as it is — no demo route, fares or departures for it.`);
      continue;
    }
    state.trains.push(train);

    if (!train.code) await trainService.update(train.id, identity);
    if (!(await RouteStop.count({ where: { trainId: train.id } }))) {
      await trainService.setRoute(train.id, toStops(route, state.stationIds));
    }

    const spec = TRAINS.find((t) => t.name === trainName);
    if (spec && !(await TrainCoach.count({ where: { trainId: train.id } }))) {
      const plans = await SeatPlan.findAll({ where: { coachNo: spec.coaches.map(([, coachNo]) => coachNo) } });
      const byCoachNo = new Map(plans.map((p) => [p.coachNo, p]));
      const coaches = spec.coaches
        .filter(([, coachNo]) => byCoachNo.has(coachNo))
        .map(([coachCode, coachNo]) => ({ coachCode, seatPlanId: byCoachNo.get(coachNo).id }));
      await compositionService.set(train.id, coaches);
    }
    if (spec && !(await TrainSchedule.count({ where: { trainId: train.id } }))) {
      await scheduleService.set(train.id, [{ runsOn: spec.runsOn, isActive: true }]);
    }

    // Fares for the classes this train actually carries.
    const coaches = await TrainCoach.findAll({ where: { trainId: train.id }, include: [{ model: SeatPlan, as: "seatPlan" }] });
    const carried = new Set(coaches.map((c) => c.seatPlan?.coachClassId).filter(Boolean));
    for (const [className, ratePerKm, minFare] of DISTANCE_RATES) {
      const coachClass = await CoachClass.findOne({ where: { name: className } });
      if (!coachClass || !carried.has(coachClass.id)) continue;
      const name = `${className} — per kilometre`;
      if (await FareRule.findOne({ where: { name, trainId: train.id } })) continue;
      await fareService.createRule({
        name,
        kind: "distance",
        priority: 200, // Runs last: the fallback anything else overrides.
        trainId: train.id,
        coachClassId: coachClass.id,
        ratePerKm,
        minFare,
      });
    }

    if (trainName === PUBLISHED_TABLE.train) {
      const coachClass = await CoachClass.findOne({ where: { name: PUBLISHED_TABLE.coachClass } });
      const exists = await FareRule.findOne({ where: { name: PUBLISHED_TABLE.name } });
      if (coachClass && !exists) {
        const rule = await fareService.createRule({
          name: PUBLISHED_TABLE.name,
          kind: "table",
          priority: 10, // Beats the per-kilometre fallback.
          trainId: train.id,
          coachClassId: coachClass.id,
        });
        await fareService.setTableEntries(
          rule.id,
          PUBLISHED_TABLE.pairs.map(([from, to, amount]) => ({
            fromStationId: state.stationIds.get(from),
            toStationId: state.stationIds.get(to),
            amount,
          }))
        );
      }
    }
  }
}

async function seedDepartures(report, state) {
  for (const train of state.trains) {
    const generated = await tripService.generateHorizon({ trainId: train.id, actorLabel: "demo data" });
    report.seats += generated.seatsCreated;
    for (const summary of generated.trains) {
      for (const note of summary.notes) report.notes.push(`${summary.train}: ${note}.`);
    }
  }
}

/* ---------------- Sample activity ---------------- */

const PEOPLE = {
  rahim: { name: "Rahim Uddin", nid: "1985123456781", dob: "1985-03-14" },
  nusrat: { name: "Nusrat Jahan", nid: "1992234567892", dob: "1992-07-22" },
  tanvir: { name: "Tanvir Hasan", nid: "1978345678903", dob: "1978-12-05" },
  farhana: { name: "Farhana Akter", nid: "2001456789014", dob: "2001-01-30" },
  arif: { name: "Arif Chowdhury", nid: "1990567890125", dob: "1990-09-18" },
  sadia: { name: "Sadia Islam", nid: "1996678901236", dob: "1996-05-09" },
  karim: { name: "Mahmudul Karim", nid: "1970789012347", dob: "1970-11-27" },
  ayesha: { name: "Ayesha Siddiqua", nid: "1999890123458", dob: "1999-02-11" },
  kamrul: { name: "Kamrul Hassan", nid: "1983901234569", dob: "1983-08-03" },
  shirin: { name: "Shirin Sultana", nid: "1987012345670", dob: "1987-04-16" },
  imran: { name: "Imran Hossain", nid: "1994123450981", dob: "1994-10-21" },
  rumana: { name: "Rumana Begum", nid: "1975234561092", dob: "1975-06-08" },
};

/**
 * The sample bookings, and what happens to each afterwards. Chosen to put
 * something on every screen: a full booking, a scanned ticket and a reported
 * one, a pending transfer, a settled return and one waiting on resale.
 */
const SAMPLES = [
  {
    label: "a family trip on Madhumati",
    passenger: 1,
    train: "Madhumati Express",
    daysAhead: 2,
    from: "RJS",
    to: "ISD",
    coachClass: "Shovon Chair",
    travellers: ["rahim", "nusrat", "tanvir", "farhana"],
  },
  {
    label: "tomorrow's Ekota, checked on board",
    passenger: 1,
    train: "Ekota Express",
    daysAhead: 1,
    from: "JYD",
    to: "ISD",
    coachClass: "Shovon Chair",
    travellers: ["arif", "sadia"],
    then: "check",
  },
  {
    label: "a pair on Ekota's AC chair",
    passenger: 0,
    train: "Ekota Express",
    daysAhead: 3,
    from: "DHK",
    to: "DNJ",
    coachClass: "AC Chair",
    travellers: ["karim", "ayesha"],
  },
  {
    label: "a cabin seat with a transfer waiting for approval",
    passenger: 1,
    train: "Madhumati Express",
    daysAhead: 3,
    from: "RJS",
    to: "BNG",
    coachClass: "Non-AC Cabin",
    travellers: ["kamrul"],
    then: "transfer",
  },
  {
    label: "three seats, one returned on demand",
    passenger: 0,
    train: "Madhumati Express",
    daysAhead: 4,
    from: "KTC",
    to: "FDP",
    coachClass: "Shovon",
    travellers: ["shirin", "imran", "rumana"],
    then: "demand",
  },
  {
    label: "a ticket returned straight away",
    passenger: 0,
    train: "Ekota Express",
    daysAhead: 5,
    from: "TAN",
    to: "PBT",
    coachClass: "Non-AC Cabin",
    travellers: ["rahim"],
    then: "convenient",
  },
];

async function seedActivity(report, state) {
  const demoUser = async (email) => {
    const user = await User.findOne({ where: { email } });
    return user && (await isTracked("User", user.id)) ? user : null;
  };
  const passengers = (await Promise.all(PASSENGER_EMAILS.map(demoUser))).filter(Boolean);
  const checker = await demoUser(CHECKER_EMAIL);

  // Bookings are made only as accounts the demo created — a booking by a
  // pre-existing account would outlive "Delete demo data" and then block it.
  if (passengers.length < PASSENGER_EMAILS.length) {
    report.notes.push(
      "No sample bookings were made: the demo passenger accounts already existed, and the demo only books as accounts it created."
    );
    return;
  }
  if (await Booking.count({ where: { userId: passengers.map((p) => p.id) } })) {
    report.notes.push("The demo passengers already have bookings, so no more samples were added.");
    return;
  }
  if (!state.trains.length) {
    report.notes.push("No sample bookings were made: the demo has no trains of its own to book on.");
    return;
  }

  const today = todayInDhaka();
  const trips = await Trip.findAll({
    where: {
      trainId: state.trains.map((t) => t.id),
      status: TRIP_STATUS.SCHEDULED,
      departureDate: { [Op.gt]: today },
    },
    include: [{ model: TrainName, as: "train", attributes: ["name"] }],
    order: [["departureDate", "ASC"]],
  });
  const tripFor = (train, daysAhead) =>
    trips.find((t) => t.train?.name === train && t.departureDate >= addDays(today, daysAhead));

  const classIds = new Map((await CoachClass.findAll()).map((c) => [c.name, c.id]));

  for (const user of passengers) {
    await as(user, RESERVED_ROLES.DEFAULT, () =>
      walletService.topUp({
        userId: user.id,
        amountMinor: money.toMinor(10000),
        reference: `DEMO-${user.id}`,
        actorLabel: "Demo top-up",
      })
    );
  }

  for (const sample of SAMPLES) {
    const user = passengers[sample.passenger];
    try {
      const trip = tripFor(sample.train, sample.daysAhead);
      if (!trip) throw new Error(`no ${sample.train} departure ${sample.daysAhead}+ days out`);

      const booking = await as(user, RESERVED_ROLES.DEFAULT, async () => {
        const { hold } = await selectionService.selectAndHold({
          tripId: trip.id,
          userId: user.id,
          fromStationId: state.stationIds.get(sample.from),
          toStationId: state.stationIds.get(sample.to),
          count: sample.travellers.length,
          coachClassId: classIds.get(sample.coachClass),
          together: true,
        });
        return bookingService.create({
          userId: user.id,
          holdReference: hold.reference,
          passengers: sample.travellers.map((key) => PEOPLE[key]),
          method: "wallet",
        });
      });

      const [first, second] = booking.tickets || [];
      const last = booking.tickets?.[booking.tickets.length - 1];

      if (sample.then === "check") {
        if (!checker) {
          report.notes.push("The demo checker account already existed, so no ticket was scanned or reported.");
        } else {
          await as(checker, "checker", async () => {
            await verificationService.scan(
              { ticketNumber: first.ticketNumber, tripId: trip.id, stationId: state.stationIds.get(sample.from) },
              { checkedById: checker.id }
            );
            await abuseService.report({
              ticketNumber: second.ticketNumber,
              kind: REPORT_KIND.IDENTITY_MISMATCH,
              detail: "The name on this ticket did not match the National ID card the passenger showed.",
              stationId: state.stationIds.get(sample.from),
              reportedById: checker.id,
            });
          });
        }
      } else if (sample.then === "transfer") {
        await as(user, RESERVED_ROLES.DEFAULT, () =>
          postSaleService.requestTransfer({
            ticketId: first.id,
            toNid: "1998765123409",
            toName: "Sabbir Rahman",
            reason: "My brother is travelling in my place.",
            userId: user.id,
          })
        );
      } else if (sample.then === "demand" || sample.then === "convenient") {
        await as(user, RESERVED_ROLES.DEFAULT, () =>
          refundService.request({
            ticketId: (sample.then === "demand" ? last : first).id,
            type: sample.then === "demand" ? REFUND_TYPE.DEMAND : REFUND_TYPE.CONVENIENT,
            userId: user.id,
          })
        );
      }
    } catch (err) {
      report.warnings.push(`Sample booking "${sample.label}" was skipped: ${err.message}`);
    }
  }
}

/** Rows the demo noted since `sinceId`, per model. */
async function notedSince(sinceId) {
  const rows = await DemoRecord.findAll({
    where: { id: { [Op.gt]: sinceId } },
    attributes: ["model", [fn("COUNT", col("id")), "count"]],
    group: ["model"],
    raw: true,
  });
  return Object.fromEntries(rows.map((r) => [r.model, Number(r.count)]));
}

/**
 * Fill the system with demonstration data. Safe to run again: whatever is
 * already there is adopted, so a second run fills in only what is missing —
 * which is also how an interrupted run finishes.
 */
async function populate(ctx = {}) {
  const report = { notes: [], warnings: [], seats: 0 };
  const state = {};
  const since = (await DemoRecord.max("id")) || 0;

  const stages = [seedAccounts, seedSeatPlans, seedStations, seedTrains, seedDepartures, seedActivity];
  for (let i = 0; i < stages.length; i++) {
    await ctx.progress?.({ total: STEPS.length, done: i, step: STEPS[i] });
    await demoCapture.capture(() => stages[i](report, state));
  }
  await ctx.progress?.({ total: STEPS.length, done: STEPS.length, step: "Done" });

  const created = await notedSince(since);
  const result = { created, seats: report.seats, notes: report.notes, warnings: report.warnings };

  await audit.record({
    action: AUDIT_ACTIONS.DEMO_POPULATE,
    entity: { type: "demo_data", id: null, label: "demo data" },
    after: { created, seats: report.seats, warnings: report.warnings.length },
    message:
      `demo data populated — ${created.User || 0} account(s), ${created.Trip || 0} departure(s), ` +
      `${created.Booking || 0} booking(s)` + (report.warnings.length ? `, ${report.warnings.length} warning(s)` : ""),
  });

  return result;
}

/* ------------------------------------------------------------------ *
 * Delete
 * ------------------------------------------------------------------ */

const PLAIN_TABLE_NAMES = {
  users: "accounts",
  roles: "roles",
  seat_plans: "seat plans",
  stations: "stations",
  train_names: "trains",
  coach_classes: "coach classes",
  coach_types: "coach types",
  trips: "departures",
  bookings: "bookings",
};

/** A foreign-key refusal, said as what it means. */
function refusal(err) {
  const text = err?.parent?.sqlMessage || err?.message || "";
  const child = /`[^`]+`\.`([^`]+)`/.exec(text)?.[1];
  const parent = /REFERENCES `([^`]+)`/.exec(text)?.[1];
  const what = PLAIN_TABLE_NAMES[parent] || parent || "rows";
  return new ApiError(
    409,
    `The demo's ${what} could not be deleted: ${child ? `rows in ${child}` : "something"} outside the demo still ` +
      "refer to them. Nothing was deleted."
  );
}

async function destroyNoted(model, transaction) {
  const Model = models[model];
  const ids = await trackedIds(model, { transaction });
  let removed = 0;
  for (let i = 0; i < ids.length; i += 1000) {
    removed += await Model.destroy({ where: { id: ids.slice(i, i + 1000) }, transaction });
  }
  return removed;
}

/**
 * Remove everything the demo created, in one transaction: all of it goes, or
 * none of it does.
 */
async function clear(ctx = {}) {
  await ctx.progress?.({ total: 2, done: 0, step: "Checking" });
  const before = (await status()).counts;

  await ctx.progress?.({ total: 2, done: 1, step: "Deleting" });
  await sequelize.transaction(async (transaction) => {
    // Again, inside: a ticket may have been bought since the button was pressed.
    const found = await blockers({ transaction });
    if (found.length) {
      throw new ApiError(409, `The demo data cannot be deleted yet. ${found.map((b) => b.message).join(" ")}`, {
        blockers: found,
      });
    }

    const s = await scope({ transaction });

    // Bookings first: they hold departures and accounts in place. None of
    // these has a valid ticket anyone outside the demo depends on — checked above.
    const inScope = bookingsInScope(s);
    if (inScope) await Booking.destroy({ where: inScope, transaction });

    if (s.users.length) {
      // What demo accounts did to things that are staying: their checks and
      // reports go; their name comes off decisions they made on real accounts.
      await TicketScan.destroy({ where: { checkedById: s.users }, transaction });
      await TicketReport.destroy({ where: { reportedById: s.users }, transaction });
      await TicketReport.update({ reviewedById: null }, { where: { reviewedById: s.users }, transaction });
      await AccountHold.update({ placedById: null }, { where: { placedById: s.users }, transaction });
      await AccountHold.update({ releasedById: null }, { where: { releasedById: s.users }, transaction });
    }

    // Departures, with their coaches, seats, holds and queues.
    if (s.trips.length) await Trip.destroy({ where: { id: s.trips }, transaction });

    // Then every other noted row, newest kind first, which is the reverse of
    // the order they were built in. Where that is not quite enough, a refused
    // delete is tried again after the rest: a later pass finds what held it
    // gone. Only a pass that removes nothing at all means something outside
    // the demo is holding on — and then the whole transaction is undone.
    const groups = await DemoRecord.findAll({
      attributes: ["model", [fn("MAX", col("id")), "last"]],
      group: ["model"],
      order: [[literal("last"), "DESC"]],
      raw: true,
      transaction,
    });
    let pending = groups.map((g) => g.model).filter((model) => models[model] && model !== "Trip");
    // Layouts demo planners drew after the demo was populated are theirs too.
    if (s.users.length) pending.unshift("SeatPlan:authored");

    let lastRefusal = null;
    while (pending.length) {
      const refused = [];
      for (const task of pending) {
        try {
          if (task === "SeatPlan:authored") {
            await SeatPlan.destroy({ where: { createdById: s.users }, transaction });
          } else {
            await destroyNoted(task, transaction);
          }
        } catch (err) {
          if (err.name !== "SequelizeForeignKeyConstraintError") throw err;
          lastRefusal = err;
          refused.push(task);
        }
      }
      if (refused.length === pending.length) throw refusal(lastRefusal);
      pending = refused;
    }

    await DemoRecord.destroy({ where: {}, transaction });
  });

  await ctx.progress?.({ total: 2, done: 2, step: "Done" });

  await audit.record({
    action: AUDIT_ACTIONS.DEMO_CLEAR,
    entity: { type: "demo_data", id: null, label: "demo data" },
    before,
    message:
      `demo data deleted — ${before.accounts} account(s), ${before.departures} departure(s), ` +
      `${before.bookings} booking(s)`,
  });

  return { removed: before };
}

module.exports = { JOB_TYPES, DEMO_ACCOUNTS, status, start, populate, clear, blockers };
