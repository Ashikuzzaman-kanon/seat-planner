const { Op } = require("sequelize");
const AuditEvent = require("../models/mongo/AuditEvent");
const { isMongoConnected } = require("../config/mongo");
const { User } = require("../models");
const ApiError = require("../utils/ApiError");
const { toCsv } = require("../utils/csv");
const { todayInDhaka, addDays, DAY_NAMES } = require("../utils/dhakaTime");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { BROWSERS, SYSTEMS, BOT, TABLET, PHONE } = require("../utils/userAgent");

/**
 * The audit log, analysed: which operations happen, by whom, when and from
 * where — counted, over time, and by weekday and hour.
 *
 * An analysis picks the events (operations or whole groups of them, people,
 * outcome, a span of days or the last hour, hours of the day, days of the
 * week, test accounts or not), groups them by one or two fields (DIMENSIONS)
 * and counts each group: events, people, internet addresses, failures. With
 * the totals, the counts over time, a weekday × hour grid, the latest events
 * one by one and — for two to five people — each person's own, side by side.
 *
 * It all runs inside the database (MongoDB aggregation). Every field is from
 * the fixed list here, its expression written here; what a caller sends is
 * checked against a pattern and goes in as values only. Times are Dhaka's.
 */

const TZ = "Asia/Dhaka";
const DHAKA_OFFSET_MS = 6 * 3_600_000; // no daylight saving
const DAY_MS = 86_400_000;
const MAX_DAYS = 731;
const MAX_GROUPS = 500;
const LATEST = 50;
const MAX_COMPARE = 5;
const TEST_ACCOUNTS = /^unittest-/;

/* ------------------------------------------------------------------ *
 * Browser, system and device — worked out in the database by the same
 * rules utils/userAgent applies to the public page's visits
 * ------------------------------------------------------------------ */

const UA = { $ifNull: ["$context.userAgent", ""] };
const rx = (re) => ({ regex: re.source, options: re.flags.replace(/[^imsx]/g, "") });
const matches = (re) => ({ $regexMatch: { input: UA, ...rx(re) } });

const BROWSER = {
  $switch: {
    branches: BROWSERS.map(([name, re]) => ({
      case: matches(re),
      then: {
        $let: {
          vars: { m: { $regexFind: { input: UA, ...rx(re) } } },
          in: { $concat: [`${name} `, { $arrayElemAt: ["$$m.captures", 0] }] },
        },
      },
    })),
    default: null,
  },
};
const SYSTEM = { $switch: { branches: SYSTEMS.map(([name, re]) => ({ case: matches(re), then: name })), default: null } };
const DEVICE = {
  $cond: [
    { $eq: [UA, ""] },
    null,
    {
      $switch: {
        branches: [
          { case: matches(BOT), then: "bot" },
          { case: matches(TABLET), then: "tablet" },
          { case: matches(PHONE), then: "phone" },
        ],
        default: "computer",
      },
    },
  ],
};

/* ------------------------------------------------------------------ *
 * The fields an event can be grouped by
 * ------------------------------------------------------------------ */

const LOCAL = { date: "$at", timezone: TZ };
const HOUR = { $hour: LOCAL };
const WEEKDAY = { $dayOfWeek: LOCAL }; // 1 Sunday … 7 Saturday

const dayText = (iso) =>
  new Date(`${iso}T00:00:00+06:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  });
const hourText = (h) => `${String(h).padStart(2, "0")}:00–${String((Number(h) + 1) % 24).padStart(2, "0")}:00`;

/**
 * key → { group, label, expr, name(value, extra) for people to read, none:
 * what an empty value means, number: values are numbers, extra: something
 * kept with each group to name it by }. `role` counts an event once for each
 * role its person held.
 */
const DIMENSIONS = {
  action: { group: "What", label: "Operation", expr: "$action" },
  area: {
    group: "What",
    label: "Operation group",
    expr: { $arrayElemAt: [{ $split: ["$action", "."] }, 0] },
    name: (v) => `${v}.*`,
  },
  outcome: {
    group: "What",
    label: "Outcome",
    expr: "$outcome",
    name: (v) => (v === "failure" ? "Failed" : "Succeeded"),
  },
  targetType: { group: "What", label: "Target type", expr: { $ifNull: ["$entity.type", null] }, none: "No target" },
  target: {
    group: "What",
    label: "Target",
    expr: {
      $cond: [
        { $eq: [{ $ifNull: ["$entity.id", null] }, null] },
        null,
        { $concat: [{ $ifNull: ["$entity.type", "?"] }, " #", "$entity.id"] },
      ],
    },
    extra: "$entity.label",
    name: (v, label) => (label ? `${label} (${v})` : v),
    none: "No target",
  },
  person: {
    group: "Who",
    label: "Person",
    expr: { $ifNull: ["$actor.id", null] },
    extra: "$actor.email",
    number: true,
    none: "No one signed in",
  },
  role: { group: "Who", label: "Role", expr: "$actor.roles", none: "No role" },
  ip: { group: "Who", label: "Internet address", expr: { $ifNull: ["$context.ipAddress", null] }, none: "Unknown" },
  browser: { group: "Device", label: "Browser", expr: BROWSER, none: "Unknown" },
  os: { group: "Device", label: "Operating system", expr: SYSTEM, none: "Unknown" },
  device: { group: "Device", label: "Device", expr: DEVICE, none: "Unknown" },
  hour: { group: "Time", label: "Hour of the day", expr: HOUR, number: true, name: hourText },
  weekday: { group: "Time", label: "Day of the week", expr: WEEKDAY, number: true, name: (v) => DAY_NAMES[Number(v) - 1] || v },
  day: { group: "Time", label: "Day", expr: { $dateToString: { format: "%Y-%m-%d", ...LOCAL } }, name: dayText },
  // Weeks start on Saturday, as Bangladesh's working week does.
  week: {
    group: "Time",
    label: "Week",
    expr: {
      $dateToString: {
        format: "%Y-%m-%d",
        date: { $dateTrunc: { date: "$at", unit: "week", timezone: TZ, startOfWeek: "saturday" } },
        timezone: TZ,
      },
    },
    name: (v) => `Week from ${dayText(v)}`,
  },
  month: {
    group: "Time",
    label: "Month",
    expr: { $dateToString: { format: "%Y-%m", ...LOCAL } },
    name: (v) =>
      new Date(`${v}-15T00:00:00+06:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: TZ }),
  },
};

const DIMENSION_LIST = Object.entries(DIMENSIONS).map(([key, d]) => ({ key, group: d.group, label: d.label }));

/* ------------------------------------------------------------------ *
 * What a caller asks for, checked
 * ------------------------------------------------------------------ */

const ACTION = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
const AREA = /^[a-z][a-z0-9_]*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HOURS = /^(\d{1,2})-(\d{1,2})$/;

/** A query value as a list: repeated, comma-separated, or both. */
const listOf = (v) =>
  (v === undefined ? [] : Array.isArray(v) ? v : [v])
    .flatMap((x) => String(x).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
const bad = (message) => ApiError.badRequest(message);

/**
 * From the query string:
 *   action  operations, such as auth.login (repeat, or comma-separate)
 *   area    whole groups of operations, such as subscription
 *   person  people by id; "none" is events with no one signed in
 *   outcome success or failure
 *   since, until  Dhaka days, inclusive (default: the last 30) — or
 *   last    the last so many minutes (5 to 1440)
 *   hours   a span of hours of the day, "9-13" (9:00 to 13:00; "22-3" runs past midnight)
 *   days    days of the week, 1 Sunday … 7 Saturday
 *   tests   "1" counts the automated test accounts too
 *   by      one or two fields (default: action)
 *   w       a filter, field:value, repeated; "field:" alone is none
 *   compare "1": each of two to five people, side by side
 */
function readAsk(q = {}) {
  const actions = listOf(q.action);
  if (actions.length > 150 || actions.some((a) => a.length > 80 || !ACTION.test(a))) {
    throw bad("action is an operation such as auth.login");
  }
  const areas = listOf(q.area);
  if (areas.length > 40 || areas.some((a) => a.length > 40 || !AREA.test(a))) {
    throw bad("area is a group of operations such as subscription");
  }
  const people = listOf(q.person).map((p) => (p === "none" ? null : Number(p)));
  if (people.length > 20 || people.some((p) => p !== null && !(Number.isInteger(p) && p > 0))) {
    throw bad("person is a person's id, or none");
  }
  const outcome = q.outcome ? String(q.outcome) : null;
  if (outcome && !["success", "failure"].includes(outcome)) throw bad("outcome is success or failure");

  const by = listOf(q.by);
  if (!by.length) by.push("action");
  if (by.length > 2 || new Set(by).size !== by.length || by.some((k) => !DIMENSIONS[k])) {
    throw bad("by is one or two of the fields, such as action or person,hour");
  }
  // Filters are taken whole: a value may hold a comma.
  const where = (q.w === undefined ? [] : [].concat(q.w)).map((item) => {
    const text = String(item);
    const at = text.indexOf(":");
    const key = at < 0 ? text : text.slice(0, at);
    if (at < 0 || !DIMENSIONS[key]) throw bad(`w is field:value, such as action:auth.login — not "${text.slice(0, 40)}"`);
    const value = text.slice(at + 1);
    return { key, value: value === "" ? null : value.slice(0, 300) };
  });
  if (where.length > 12) throw bad("At most 12 filters");

  // The span: the last so many minutes, or whole Dhaka days.
  let span;
  if (q.last !== undefined && q.last !== "") {
    const minutes = Number(q.last);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) throw bad("last is 5 to 1440 minutes");
    const end = new Date();
    span = { last: minutes, start: new Date(end.getTime() - minutes * 60_000), end, days: 1 };
  } else {
    const until = q.until ? String(q.until) : todayInDhaka();
    const since = q.since ? String(q.since) : addDays(until, -29);
    if (!DAY.test(since) || !DAY.test(until) || since > until) throw bad("since and until are days (YYYY-MM-DD), since first");
    const days = Math.round((Date.parse(until) - Date.parse(since)) / DAY_MS) + 1;
    if (days > MAX_DAYS) throw bad(`At most ${MAX_DAYS} days at once`);
    span = { since, until, days, start: new Date(`${since}T00:00:00+06:00`), end: new Date(`${addDays(until, 1)}T00:00:00+06:00`) };
  }

  let hours = null;
  if (q.hours) {
    const m = HOURS.exec(String(q.hours));
    const from = m && Number(m[1]);
    const to = m && Number(m[2]);
    if (!m || from > 23 || to > 24 || from === to) throw bad('hours is a span such as "9-13" or "22-3"');
    const count = (to - from + 24) % 24 || 24; // "0-24" is the whole day
    hours = Array.from({ length: count }, (_, i) => (from + i) % 24);
  }
  const days = listOf(q.days).map(Number);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw bad("days are days of the week, 1 Sunday … 7 Saturday");

  const compare = (q.compare === "1" || q.compare === "true") && people.filter((p) => p !== null).length >= 2;
  if (compare && people.filter((p) => p !== null).length > MAX_COMPARE) throw bad(`Compare up to ${MAX_COMPARE} people`);

  return {
    actions,
    areas,
    people,
    outcome,
    by,
    where,
    span,
    hours: hours && hours.length < 24 ? hours : null,
    days: days.length && days.length < 7 ? [...new Set(days)].sort() : null,
    tests: q.tests === "1" || q.tests === "true",
    compare,
  };
}

/* ------------------------------------------------------------------ *
 * The pipelines
 * ------------------------------------------------------------------ */

/** A filter on one field's value. */
function filterOf({ key, value }) {
  if (key === "role") {
    return value === null ? { $or: [{ "actor.roles": { $size: 0 } }, { "actor.roles": { $exists: false } }] } : { "actor.roles": value };
  }
  const d = DIMENSIONS[key];
  const typed = value === null ? null : d.number ? Number(value) : value;
  return { $expr: { $eq: [{ $ifNull: [d.expr, null] }, typed] } };
}

/** The events an ask picks — exported for the unit tests. */
function matchOf(ask) {
  const and = [{ at: { $gte: ask.span.start, $lt: ask.span.end } }];
  const which = [];
  if (ask.actions.length) which.push({ action: { $in: ask.actions } });
  if (ask.areas.length) which.push({ action: { $regex: `^(${ask.areas.join("|")})\\.` } });
  if (which.length) and.push({ $or: which });
  if (ask.people.length) {
    const ids = ask.people.filter((p) => p !== null);
    const who = [];
    if (ids.length) who.push({ "actor.id": { $in: ids } });
    if (ask.people.includes(null)) who.push({ "actor.id": null });
    and.push({ $or: who });
  }
  if (ask.outcome) and.push({ outcome: ask.outcome });
  if (!ask.tests) and.push({ "actor.email": { $not: TEST_ACCOUNTS } });
  if (ask.hours) and.push({ $expr: { $in: [HOUR, ask.hours] } });
  if (ask.days) and.push({ $expr: { $in: [WEEKDAY, ask.days] } });
  for (const w of ask.where) and.push(filterOf(w));
  return { $and: and };
}

const COUNTS = {
  events: { $sum: 1 },
  people: { $addToSet: "$actor.id" },
  ips: { $addToSet: "$context.ipAddress" },
  failures: { $sum: { $cond: [{ $eq: ["$outcome", "failure"] }, 1, 0] } },
  lastAt: { $max: "$at" },
};
/** Sets of who and where, counted — without the empty ones. */
const SIZES = {
  people: { $size: { $setDifference: ["$people", [null]] } },
  ips: { $size: { $setDifference: ["$ips", [null]] } },
};

/** The groups of an ask, counted — exported for the unit tests. */
function groupsPipeline(ask) {
  const id = {};
  const extras = {};
  ask.by.forEach((key, i) => {
    id[`g${i}`] = DIMENSIONS[key].expr;
    if (DIMENSIONS[key].extra) extras[`x${i}`] = { $last: DIMENSIONS[key].extra };
  });
  return [
    { $match: matchOf(ask) },
    ...(ask.by.includes("role") ? [{ $unwind: { path: "$actor.roles", preserveNullAndEmptyArrays: true } }] : []),
    { $group: { _id: id, ...COUNTS, ...extras } },
    { $set: SIZES },
    { $sort: { events: -1, _id: 1 } },
    { $limit: MAX_GROUPS + 1 },
  ];
}

/** By 5 minutes over the last hours, by the hour over a day or two, by day up to three months, by week beyond. */
function bucketOf(span) {
  if (span.last && span.last <= 180) {
    return {
      size: "5min",
      expr: {
        $dateToString: {
          format: "%Y-%m-%d %H:%M",
          date: { $dateTrunc: { date: "$at", unit: "minute", binSize: 5, timezone: TZ } },
          timezone: TZ,
        },
      },
    };
  }
  if (span.last || span.days <= 2) return { size: "hour", expr: { $dateToString: { format: "%Y-%m-%d %H", ...LOCAL } } };
  if (span.days <= 92) return { size: "day", expr: DIMENSIONS.day.expr };
  return { size: "week", expr: DIMENSIONS.week.expr };
}

/** A moment, as Dhaka's clock shows it: "2026-11-01 09:35". */
const dhaka = (date) => new Date(date.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");

/** Every bucket of the span, so a quiet one shows as nothing rather than missing. */
function bucketsOf(span, size) {
  const out = [];
  if (size === "5min" || (size === "hour" && span.last)) {
    const step = size === "5min" ? 5 * 60_000 : 3_600_000;
    const first = Math.floor((span.start.getTime() + DHAKA_OFFSET_MS) / step) * step - DHAKA_OFFSET_MS;
    for (let t = first; t < span.end.getTime(); t += step) {
      out.push(size === "5min" ? dhaka(new Date(t)) : dhaka(new Date(t)).slice(0, 13));
    }
  } else if (size === "hour") {
    for (let d = span.since; d <= span.until; d = addDays(d, 1)) {
      for (let h = 0; h < 24; h++) out.push(`${d} ${String(h).padStart(2, "0")}`);
    }
  } else if (size === "day") {
    for (let d = span.since; d <= span.until; d = addDays(d, 1)) out.push(d);
  } else {
    const weekday = new Date(`${span.since}T12:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
    for (let d = addDays(span.since, -((weekday + 1) % 7)); d <= span.until; d = addDays(d, 7)) out.push(d);
  }
  return out;
}

const aggregate = (pipeline) => AuditEvent.aggregate(pipeline);

async function totals(ask) {
  const [row] = await aggregate([
    { $match: matchOf(ask) },
    { $group: { _id: null, ...COUNTS, firstAt: { $min: "$at" } } },
    { $set: SIZES },
  ]);
  return {
    events: row?.events || 0,
    people: row?.people || 0,
    ips: row?.ips || 0,
    failures: row?.failures || 0,
    firstAt: row?.firstAt || null,
    lastAt: row?.lastAt || null,
  };
}

async function series(ask) {
  const bucket = bucketOf(ask.span);
  const rows = await aggregate([
    { $match: matchOf(ask) },
    { $group: { _id: bucket.expr, events: { $sum: 1 }, people: { $addToSet: "$actor.id" } } },
    { $set: { people: SIZES.people } },
  ]);
  const at = new Map(rows.map((r) => [r._id, r]));
  return {
    size: bucket.size,
    points: bucketsOf(ask.span, bucket.size).map((b) => ({
      at: b,
      events: at.get(b)?.events || 0,
      people: at.get(b)?.people || 0,
    })),
  };
}

/** Weekday × hour: rows Saturday to Friday, as the week runs here; 24 hours each. */
async function heatmap(ask) {
  const rows = await aggregate([
    { $match: matchOf(ask) },
    { $group: { _id: { d: WEEKDAY, h: HOUR }, events: { $sum: 1 } } },
  ]);
  const count = new Map(rows.map((r) => [`${r._id.d}:${r._id.h}`, r.events]));
  return [7, 1, 2, 3, 4, 5, 6].map((d) => ({
    weekday: d,
    name: DAY_NAMES[d - 1],
    hours: Array.from({ length: 24 }, (_, h) => count.get(`${d}:${h}`) || 0),
  }));
}

async function latest(ask) {
  return AuditEvent.find(matchOf(ask)).sort({ at: -1 }).limit(LATEST).lean();
}

/* ------------------------------------------------------------------ *
 * Names
 * ------------------------------------------------------------------ */

/** People's names from the database, emails as the log keeps them: "Ashik (a@b.c)". */
async function peopleNamed(ids, emails = new Map()) {
  const wanted = [...new Set(ids.filter((id) => Number.isInteger(id)))];
  const users = wanted.length ? await User.findAll({ where: { id: wanted }, attributes: ["id", "fullName", "email"] }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return (id) => {
    if (id === null || id === undefined) return DIMENSIONS.person.none;
    const u = byId.get(Number(id));
    const email = u?.email || emails.get(Number(id));
    if (u?.fullName) return email ? `${u.fullName} (${email})` : u.fullName;
    return email || `Account ${id} (deleted)`;
  };
}

async function namer(by, rows) {
  const personAt = by.indexOf("person");
  const person =
    personAt < 0
      ? null
      : await peopleNamed(
          rows.map((r) => r._id[`g${personAt}`]),
          new Map(rows.map((r) => [r._id[`g${personAt}`], r[`x${personAt}`]]))
        );
  return (key, value, extra) => {
    const d = DIMENSIONS[key];
    if (key === "person") return person(value);
    if (value === null || value === undefined) return d.none || "Unknown";
    return d.name ? d.name(value, extra) : String(value);
  };
}

const str = (v) => (v === null || v === undefined ? null : String(v));

async function groups(ask) {
  const rows = await aggregate(groupsPipeline(ask));
  const kept = rows.slice(0, MAX_GROUPS);
  const name = await namer(ask.by, kept);
  return {
    truncated: rows.length > MAX_GROUPS,
    rows: kept.map((r) => ({
      values: ask.by.map((_, i) => str(r._id[`g${i}`])),
      labels: ask.by.map((key, i) => name(key, r._id[`g${i}`] ?? null, r[`x${i}`])),
      events: r.events,
      people: r.people,
      ips: r.ips,
      failures: r.failures,
      lastAt: r.lastAt,
    })),
  };
}

/** The filters, named, for the chips that show them. */
async function filterNames(ask) {
  const person = await peopleNamed(ask.where.filter((w) => w.key === "person").map((w) => Number(w.value)));
  return ask.where.map((w) => ({
    ...w,
    field: DIMENSIONS[w.key].label,
    label:
      w.key === "person"
        ? person(w.value === null ? null : Number(w.value))
        : w.value === null
        ? DIMENSIONS[w.key].none || "Unknown"
        : DIMENSIONS[w.key].name
        ? DIMENSIONS[w.key].name(w.value)
        : w.value,
  }));
}

/** Every operation there is: the catalogue, and any the log holds that it no longer lists. */
async function operations() {
  const seen = await AuditEvent.distinct("action");
  return [...new Set([...Object.values(AUDIT_ACTIONS), ...seen])].sort();
}

/* ------------------------------------------------------------------ *
 * The analysis
 * ------------------------------------------------------------------ */

const unavailable = () => ({ available: false });

async function analyse(query) {
  const ask = readAsk(query);
  if (!isMongoConnected()) return unavailable();
  const [t, g, s, h, l, ops, filters, compared] = await Promise.all([
    totals(ask),
    groups(ask),
    series(ask),
    heatmap(ask),
    latest(ask),
    operations(),
    filterNames(ask),
    ask.compare ? compare(ask) : null,
  ]);
  return {
    available: true,
    ask: { by: ask.by, where: ask.where, span: ask.span, hours: ask.hours, days: ask.days },
    dimensions: DIMENSION_LIST,
    operations: ops,
    filters,
    totals: t,
    groups: g.rows,
    truncated: g.truncated,
    series: s,
    heatmap: h,
    latest: l,
    compare: compared,
  };
}

/** Each person on their own: the same totals, counts over time and weekday × hour. */
async function compare(ask) {
  const ids = ask.people.filter((p) => p !== null);
  const name = await peopleNamed(ids);
  return Promise.all(
    ids.map(async (id) => {
      const own = { ...ask, people: [id] };
      const [t, s, h] = await Promise.all([totals(own), series(own), heatmap(own)]);
      return { person: { id, label: name(id) }, totals: t, series: s, heatmap: h };
    })
  );
}

/** The groups as a spreadsheet. */
async function csv(query) {
  const ask = readAsk(query);
  if (!isMongoConnected()) throw new ApiError(503, "The audit log is unavailable");
  const g = await groups(ask);
  return toCsv([
    [...ask.by.map((k) => DIMENSIONS[k].label), "Events", "People", "Internet addresses", "Failures", "Last"],
    ...g.rows.map((r) => [...r.labels, r.events, r.people, r.ips, r.failures, r.lastAt ? new Date(r.lastAt).toISOString() : ""]),
  ]);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** People who appear in the log, by part of their email or name — for choosing whom to look at. */
async function people(search = "") {
  if (!isMongoConnected()) return [];
  const text = String(search).trim().slice(0, 60);
  const named = text
    ? (await User.findAll({ where: { fullName: { [Op.like]: `%${text}%` } }, attributes: ["id"], limit: 50 })).map((u) => u.id)
    : [];
  const rows = await aggregate([
    {
      $match: {
        "actor.id": { $ne: null },
        ...(text ? { $or: [{ "actor.email": { $regex: escapeRegExp(text), $options: "i" } }, { "actor.id": { $in: named } }] } : {}),
      },
    },
    { $group: { _id: "$actor.id", email: { $last: "$actor.email" }, events: { $sum: 1 }, lastAt: { $max: "$at" } } },
    { $sort: { events: -1 } },
    { $limit: 20 },
  ]);
  const name = await peopleNamed(
    rows.map((r) => r._id),
    new Map(rows.map((r) => [r._id, r.email]))
  );
  return rows.map((r) => ({ id: r._id, label: name(r._id), email: r.email, events: r.events, lastAt: r.lastAt }));
}

module.exports = {
  DIMENSIONS,
  readAsk,
  matchOf,
  groupsPipeline,
  bucketsOf,
  analyse,
  csv,
  people,
};
