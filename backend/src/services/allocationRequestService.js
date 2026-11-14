const { QueryTypes } = require("sequelize");
const { sequelize, PublicVisit, User, AllocationTrain } = require("../models");
const { VISIT_CHANNELS, VISIT_OUTCOMES } = require("../models/PublicVisit");
const ApiError = require("../utils/ApiError");
const settings = require("./settingService");
const { toCsv } = require("../utils/csv");
const { todayInDhaka, addDays, DAY_NAMES } = require("../utils/dhakaTime");

/**
 * Who looks at the seat allocation, and for what — on the public page and
 * inside the app — for those who hold allocation:requests.
 *
 * Both are rows of public_visits: the public page's (channel "public", see
 * publicAllocationService) and the searches made inside the app (channel
 * "app", recorded here). They are kept for the days set in Settings, then
 * folded into daily totals; the analysis covers the days kept.
 *
 * An analysis groups the requests by one or two fields (DIMENSIONS), within
 * a span of days and any filters, and counts each group: requests, people
 * (signed in), visitors (browsers) and the searches that found nothing.
 * Every field is from a fixed list, its SQL written here — nothing a caller
 * sends becomes SQL but values, passed as replacements.
 */

const DAY_MS = 86_400_000;
const MAX_DAYS = 731;
const MAX_GROUPS = 500;
const LATEST = 50;

/* ------------------------------------------------------------------ *
 * Recording a search made in the app
 * ------------------------------------------------------------------ */

/** What was searched, as recorded: the same shape on the public page and in the app. */
function searchOf(filters = {}) {
  return {
    from: filters.from || null,
    to: filters.to || null,
    train: filters.train ? Number(filters.train) : null,
    class: filters.classCode || null,
    show: filters.show === "all" ? "all" : "allocated",
    page: Number(filters.page) || 1,
  };
}

/** A search in a fixed form, so the same search can be counted together. Paging is the same search. */
function queryKeyOf({ from, to, train, classCode, show }) {
  return [from || "", to || "", train || "", classCode || "", show === "all" ? "all" : ""].join("|");
}

/**
 * Record one search made inside the app. Never fails the search; waits for
 * the row, so an analysis made straight after sees it. Not in the audit log:
 * these are searches by people signed in, not changes.
 */
async function recordAppSearch(visitor, user, filters, results) {
  try {
    await PublicVisit.create({
      channel: VISIT_CHANNELS.APP,
      kind: "list",
      outcome: VISIT_OUTCOMES.SHOWN,
      ip: visitor.ip,
      country: visitor.country,
      city: visitor.city,
      visitorId: visitor.visitorId,
      userId: user?.id ?? null,
      userAgent: visitor.userAgent,
      browser: visitor.browser,
      os: visitor.os,
      device: visitor.device,
      language: visitor.language,
      referrer: null,
      query: searchOf(filters),
      queryKey: queryKeyOf(filters),
      results,
    });
  } catch (err) {
    console.error("[allocation] search not recorded:", err.message);
  }
}

/* ------------------------------------------------------------------ *
 * The fields a request can be grouped by
 * ------------------------------------------------------------------ */

/** A field of the search, from its JSON; a JSON null reads as SQL NULL. */
const field = (name) => (a) => `NULLIF(JSON_UNQUOTE(JSON_EXTRACT(${a}.query, '$.${name}')), 'null')`;
const column = (name) => (a) => `${a}.${name}`;
const local = (a) => `DATE_ADD(${a}.created_at, INTERVAL 6 HOUR)`;
const host = (a) =>
  `NULLIF(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(${a}.referrer, '://', -1), '/', 1), '?', 1), '')`;

const fromOf = field("from");
const toOf = field("to");

const station = (s) => String(s).replace(/_/g, " ");
const day = (iso) =>
  new Date(`${iso}T00:00:00+06:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dhaka",
  });
const KINDS = { list: "Search", meta: "Opened the page", status: "Checked the page is open", pass: "Bot check" };
const OUTCOMES = {
  shown: "Shown",
  sign_in: "Asked to sign in",
  rate_limited: "Too many requests",
  bot_check: "Stopped by the bot check",
  off: "Page switched off",
  refused: "Refused",
};

/**
 * key → { group, label, sql(alias), name(value) for the people who read it,
 * none: what an empty value means }. `station` and `role` are built
 * differently (see source() and roleJoin); their sql is for the grouping.
 */
const DIMENSIONS = {
  channel: {
    group: "Where",
    label: "Public page or app",
    sql: column("channel"),
    name: (v) => (v === "app" ? "In the app" : "Public page"),
  },
  signedIn: {
    group: "Who",
    label: "Signed in or not",
    sql: (a) => `IF(${a}.user_id IS NULL, 'no', 'yes')`,
    name: (v) => (v === "yes" ? "Signed in" : "Not signed in"),
  },
  person: { group: "Who", label: "Person", sql: column("user_id"), none: "Not signed in" },
  role: { group: "Who", label: "Role", sql: () => "r.name", none: "Not signed in" },
  visitor: {
    group: "Who",
    label: "Browser (visitor)",
    sql: column("visitor_id"),
    name: (v) => `Browser ${v.slice(0, 8)}…`,
    none: "No browser id",
  },
  ip: { group: "Who", label: "Internet address", sql: column("ip"), none: "Unknown" },
  journey: {
    group: "Journey",
    label: "From → to",
    sql: (a) => `CONCAT(IFNULL(${fromOf(a)}, ''), '|', IFNULL(${toOf(a)}, ''))`,
    name: (v) => {
      const [f, t] = v.split("|");
      return f && t ? `${station(f)} → ${station(t)}` : f ? `From ${station(f)}` : t ? `To ${station(t)}` : "Any journey";
    },
  },
  station: { group: "Journey", label: "Station (from or to)", sql: () => "v.station", name: station, none: "No station chosen" },
  from: { group: "Journey", label: "From", sql: fromOf, name: station, none: "Any station" },
  to: { group: "Journey", label: "To", sql: toOf, name: station, none: "Any station" },
  train: { group: "Journey", label: "Train", sql: field("train"), none: "Any train" },
  class: { group: "Journey", label: "Class", sql: field("class"), none: "Any class" },
  show: {
    group: "Journey",
    label: "Not allocated shown too",
    sql: field("show"),
    name: (v) => (v === "all" ? "Not allocated shown too" : "Allocated only"),
    none: "—",
  },
  search: {
    group: "Journey",
    label: "The whole search",
    sql: column("query_key"),
    name: (v) => {
      const [f, t, train, cls, show] = v.split("|");
      const where = f && t ? `${station(f)} → ${station(t)}` : f ? `From ${station(f)}` : t ? `To ${station(t)}` : null;
      const parts = [train && `Train ${train}`, where, cls, show === "all" && "not allocated too"].filter(Boolean);
      return parts.length ? parts.join(" · ") : "Everything";
    },
    none: "—",
  },
  outcome: { group: "Outcome", label: "Outcome", sql: column("outcome"), name: (v) => OUTCOMES[v] || v },
  found: {
    group: "Outcome",
    label: "Found something or nothing",
    sql: (a) =>
      `CASE WHEN ${a}.kind <> 'list' OR ${a}.outcome <> 'shown' THEN NULL WHEN ${a}.results = 0 THEN 'nothing' ELSE 'found' END`,
    name: (v) => (v === "nothing" ? "Found nothing" : "Found pairs"),
    none: "Not a search shown",
  },
  kind: { group: "Outcome", label: "Request type", sql: column("kind"), name: (v) => KINDS[v] || v },
  country: { group: "Place & device", label: "Country", sql: column("country"), none: "Unknown" },
  city: { group: "Place & device", label: "City", sql: column("city"), none: "Unknown" },
  device: { group: "Place & device", label: "Device", sql: column("device"), none: "Unknown" },
  browser: { group: "Place & device", label: "Browser", sql: column("browser"), none: "Unknown" },
  os: { group: "Place & device", label: "Operating system", sql: column("os"), none: "Unknown" },
  language: { group: "Place & device", label: "Language", sql: column("language"), none: "Unknown" },
  site: {
    group: "Place & device",
    label: "Came from (site)",
    sql: (a) => `IF(LEFT(${host(a)}, 4) = 'www.', SUBSTRING(${host(a)}, 5), ${host(a)})`,
    none: "No site (typed in, or a bookmark)",
  },
  hour: {
    group: "Time",
    label: "Hour of the day",
    sql: (a) => `HOUR(${local(a)})`,
    name: (v) => `${String(v).padStart(2, "0")}:00–${String((Number(v) + 1) % 24).padStart(2, "0")}:00`,
  },
  weekday: {
    group: "Time",
    label: "Day of the week",
    sql: (a) => `DAYOFWEEK(${local(a)})`,
    name: (v) => DAY_NAMES[Number(v) - 1] || v,
  },
  day: { group: "Time", label: "Day", sql: (a) => `DATE_FORMAT(${local(a)}, '%Y-%m-%d')`, name: day },
  // Weeks start on Saturday, as Bangladesh's working week does.
  week: {
    group: "Time",
    label: "Week",
    sql: (a) => `DATE_FORMAT(DATE_SUB(DATE(${local(a)}), INTERVAL (DAYOFWEEK(${local(a)}) % 7) DAY), '%Y-%m-%d')`,
    name: (v) => `Week from ${day(v)}`,
  },
  month: {
    group: "Time",
    label: "Month",
    sql: (a) => `DATE_FORMAT(${local(a)}, '%Y-%m')`,
    name: (v) =>
      new Date(`${v}-15T00:00:00+06:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Asia/Dhaka" }),
  },
};

const DIMENSION_LIST = Object.entries(DIMENSIONS).map(([key, d]) => ({ key, group: d.group, label: d.label }));

/* ------------------------------------------------------------------ *
 * What a caller asks for, checked
 * ------------------------------------------------------------------ */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * { by, where, since, until, all } from the query string:
 *   by     "train" or "train,outcome" — one or two fields
 *   w      "field:value", repeated — filters; "field:" alone is "none"
 *   since, until  Dhaka days, inclusive (default: the last 30)
 *   all    "1" counts every request, not only searches
 */
function readAsk(q = {}) {
  const by = String(q.by || "channel")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!by.length || by.length > 2 || new Set(by).size !== by.length || by.some((k) => !DIMENSIONS[k])) {
    throw ApiError.badRequest("by is one or two of the fields, such as train or train,outcome");
  }
  const raw = q.w === undefined ? [] : Array.isArray(q.w) ? q.w : [q.w];
  const where = [];
  for (const item of raw) {
    const text = String(item);
    const at = text.indexOf(":");
    const key = at < 0 ? text : text.slice(0, at);
    if (!DIMENSIONS[key] || at < 0) throw ApiError.badRequest(`w is field:value, such as train:705 — not "${text.slice(0, 40)}"`);
    const value = text.slice(at + 1);
    where.push({ key, value: value === "" ? null : value.slice(0, 300) });
  }
  if (where.length > 12) throw ApiError.badRequest("At most 12 filters");
  const today = todayInDhaka();
  const until = q.until ? String(q.until) : today;
  const since = q.since ? String(q.since) : addDays(until, -29);
  if (!DAY_RE.test(since) || !DAY_RE.test(until) || since > until) {
    throw ApiError.badRequest("since and until are days (YYYY-MM-DD), since first");
  }
  const days = Math.round((Date.parse(until) - Date.parse(since)) / DAY_MS) + 1;
  if (days > MAX_DAYS) throw ApiError.badRequest(`At most ${MAX_DAYS} days at once`);
  return { by, where, since, until, days, all: q.all === "1" || q.all === "true" || q.all === true };
}

/* ------------------------------------------------------------------ *
 * SQL
 * ------------------------------------------------------------------ */

const startOf = (d) => new Date(`${d}T00:00:00+06:00`);
const utc = (date) => date.toISOString().slice(0, 19).replace("T", " ");

/** The WHERE for an ask, on table alias `a`, with its replacements. */
function whereOf(ask, a) {
  const parts = [`${a}.created_at >= :since`, `${a}.created_at < :until`];
  const replacements = { since: utc(startOf(ask.since)), until: utc(startOf(addDays(ask.until, 1))) };
  if (!ask.all && !ask.where.some((w) => w.key === "kind")) parts.push(`${a}.kind = 'list'`);
  ask.where.forEach(({ key, value }, i) => {
    const p = `w${i}`;
    if (key === "station") {
      if (value === null) parts.push(`(${fromOf(a)} IS NULL AND ${toOf(a)} IS NULL)`);
      else parts.push(`(${fromOf(a)} = :${p} OR ${toOf(a)} = :${p})`);
    } else if (key === "role") {
      if (value === null) parts.push(`${a}.user_id IS NULL`);
      else {
        parts.push(
          `${a}.user_id IN (SELECT ur.user_id FROM user_roles ur JOIN roles rr ON rr.id = ur.role_id WHERE rr.name = :${p})`
        );
      }
    } else {
      const sql = DIMENSIONS[key].sql(a);
      parts.push(value === null ? `${sql} IS NULL` : `${sql} = :${p}`);
    }
    if (value !== null) replacements[p] = value;
  });
  return { sql: parts.join(" AND "), replacements };
}

/**
 * The rows to group, as `v`. By station, a search from one station to
 * another counts for both: the rows come twice, once for each end.
 */
function source(ask, byStation) {
  if (!byStation) {
    const w = whereOf(ask, "v");
    return { from: "public_visits v", where: `WHERE ${w.sql}`, replacements: w.replacements };
  }
  const w = whereOf(ask, "pv");
  const f = fromOf("pv");
  const t = toOf("pv");
  return {
    from: `(SELECT pv.*, COALESCE(${f}, ${t}) AS station FROM public_visits pv WHERE ${w.sql}
            UNION ALL
            SELECT pv.*, ${t} AS station FROM public_visits pv
             WHERE ${w.sql} AND ${f} IS NOT NULL AND ${t} IS NOT NULL AND ${t} <> ${f}) v`,
    where: "",
    replacements: w.replacements,
  };
}

/** The SQL for the groups of an ask — exported for the unit tests. */
function groupsSql(ask) {
  const src = source(ask, ask.by.includes("station"));
  const join = ask.by.includes("role")
    ? " LEFT JOIN user_roles ur ON ur.user_id = v.user_id LEFT JOIN roles r ON r.id = ur.role_id"
    : "";
  const keys = ask.by.map((k, i) => `${DIMENSIONS[k].sql("v")} AS g${i}`).join(", ");
  const groupBy = ask.by.map((_, i) => `g${i}`).join(", ");
  return {
    sql: `SELECT ${keys}, COUNT(*) AS requests, COUNT(DISTINCT v.user_id) AS people,
                 COUNT(DISTINCT v.visitor_id) AS visitors,
                 COALESCE(SUM(v.kind = 'list' AND v.outcome = 'shown' AND v.results = 0), 0) AS nothing,
                 MAX(v.created_at) AS lastAt
            FROM ${src.from}${join} ${src.where}
           GROUP BY ${groupBy}
           ORDER BY requests DESC, ${groupBy}
           LIMIT ${MAX_GROUPS + 1}`,
    replacements: src.replacements,
  };
}

/** Hours over a day or two, days up to three months, weeks beyond. */
function bucketOf(ask) {
  if (ask.days <= 2) return { size: "hour", sql: `DATE_FORMAT(${local("v")}, '%Y-%m-%d %H')` };
  if (ask.days <= 92) return { size: "day", sql: DIMENSIONS.day.sql("v") };
  return { size: "week", sql: DIMENSIONS.week.sql("v") };
}

/** Every bucket of the span, so a quiet one shows as nothing rather than missing. */
function bucketsOf(ask, size) {
  const out = [];
  if (size === "hour") {
    for (let d = ask.since; d <= ask.until; d = addDays(d, 1)) {
      for (let h = 0; h < 24; h++) out.push(`${d} ${String(h).padStart(2, "0")}`);
    }
  } else if (size === "day") {
    for (let d = ask.since; d <= ask.until; d = addDays(d, 1)) out.push(d);
  } else {
    const weekday = new Date(`${ask.since}T12:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
    const back = (weekday + 1) % 7; // to the Saturday on or before
    for (let d = addDays(ask.since, -back); d <= ask.until; d = addDays(d, 7)) out.push(d);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Names for the values
 * ------------------------------------------------------------------ */

async function namer(by, rows) {
  // Ids and train numbers only: a filter may carry anything.
  const values = (i) => [...new Set(rows.map((r) => r[`g${i}`]).filter((v) => /^\d{1,9}$/.test(v ?? "")))];
  const people = new Map();
  const trains = new Map();
  for (const [i, key] of by.entries()) {
    if (key === "person" && values(i).length) {
      const users = await User.findAll({ where: { id: values(i).map(Number) }, attributes: ["id", "fullName", "email"] });
      for (const u of users) people.set(String(u.id), u.fullName ? `${u.fullName} (${u.email})` : u.email);
    }
    if (key === "train" && values(i).length) {
      const found = await AllocationTrain.findAll({ where: { number: values(i).map(Number) }, attributes: ["number", "name"] });
      for (const t of found) trains.set(String(t.number), `${t.number} ${t.name}`);
    }
  }
  return (key, value) => {
    const d = DIMENSIONS[key];
    if (value === null || value === undefined) return d.none || "Unknown";
    if (key === "person") return people.get(value) || `Account ${value} (deleted)`;
    if (key === "train") return trains.get(value) || `Train ${value}`;
    return d.name ? d.name(value) : value;
  };
}

/* ------------------------------------------------------------------ *
 * The analysis
 * ------------------------------------------------------------------ */

const str = (v) => (v === null || v === undefined ? null : String(v));
const num = (v) => Number(v || 0);

async function groups(ask) {
  const { sql, replacements } = groupsSql(ask);
  const rows = await sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  const truncated = rows.length > MAX_GROUPS;
  const kept = rows.slice(0, MAX_GROUPS).map((r) => ({ ...r, g0: str(r.g0), g1: str(r.g1) }));
  const name = await namer(ask.by, kept);
  return {
    truncated,
    rows: kept.map((r) => ({
      values: ask.by.map((_, i) => r[`g${i}`]),
      labels: ask.by.map((k, i) => name(k, r[`g${i}`])),
      requests: num(r.requests),
      people: num(r.people),
      visitors: num(r.visitors),
      nothing: num(r.nothing),
      lastAt: r.lastAt,
    })),
  };
}

async function totals(ask) {
  const w = whereOf(ask, "v");
  const [row] = await sequelize.query(
    `SELECT COUNT(*) AS requests, COUNT(DISTINCT v.user_id) AS people, COUNT(DISTINCT v.visitor_id) AS visitors,
            COALESCE(SUM(v.kind = 'list' AND v.outcome = 'shown' AND v.results = 0), 0) AS nothing,
            COALESCE(SUM(v.channel = 'public'), 0) AS public, COALESCE(SUM(v.channel = 'app'), 0) AS app,
            MIN(v.created_at) AS firstAt, MAX(v.created_at) AS lastAt
       FROM public_visits v WHERE ${w.sql}`,
    { replacements: w.replacements, type: QueryTypes.SELECT }
  );
  return {
    requests: num(row.requests),
    people: num(row.people),
    visitors: num(row.visitors),
    nothing: num(row.nothing),
    public: num(row.public),
    app: num(row.app),
    firstAt: row.firstAt,
    lastAt: row.lastAt,
  };
}

async function series(ask) {
  const bucket = bucketOf(ask);
  const w = whereOf(ask, "v");
  const rows = await sequelize.query(
    `SELECT ${bucket.sql} AS b, COUNT(*) AS requests, COUNT(DISTINCT v.user_id) AS people,
            COUNT(DISTINCT v.visitor_id) AS visitors
       FROM public_visits v WHERE ${w.sql} GROUP BY b`,
    { replacements: w.replacements, type: QueryTypes.SELECT }
  );
  const by = new Map(rows.map((r) => [String(r.b), r]));
  return {
    size: bucket.size,
    points: bucketsOf(ask, bucket.size).map((b) => {
      const r = by.get(b);
      return { at: b, requests: num(r?.requests), people: num(r?.people), visitors: num(r?.visitors) };
    }),
  };
}

async function latest(ask) {
  const w = whereOf(ask, "v");
  const rows = await sequelize.query(
    `SELECT v.id, v.created_at AS at, v.channel, v.kind, v.outcome, v.ip, v.country, v.city, v.browser, v.os,
            v.device, v.language, v.referrer, v.visitor_id AS visitorId, v.query, v.results,
            u.id AS userId, u.full_name AS fullName, u.email
       FROM public_visits v LEFT JOIN users u ON u.id = v.user_id
      WHERE ${w.sql} ORDER BY v.id DESC LIMIT ${LATEST}`,
    { replacements: w.replacements, type: QueryTypes.SELECT }
  );
  return rows.map(({ userId, fullName, email, query, ...r }) => ({
    ...r,
    query: typeof query === "string" ? JSON.parse(query) : query,
    user: userId ? { id: userId, fullName, email } : null,
  }));
}

/** The days in the span whose requests are gone, kept as each day's totals only. */
async function rolledUp(ask) {
  const rows = await sequelize.query(
    `SELECT channel, MIN(day) AS first, MAX(day) AS last, COUNT(*) AS days,
            SUM(requests) AS requests, SUM(searches) AS searches
       FROM public_visit_days WHERE day >= :since AND day <= :until GROUP BY channel`,
    { replacements: { since: ask.since, until: ask.until }, type: QueryTypes.SELECT }
  );
  if (!rows.length) return null;
  const iso = (d) => (typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));
  return {
    from: rows.map((r) => iso(r.first)).sort()[0],
    to: rows.map((r) => iso(r.last)).sort().slice(-1)[0],
    requests: rows.reduce((s, r) => s + num(r.requests), 0),
    searches: rows.reduce((s, r) => s + num(r.searches), 0),
    byChannel: Object.fromEntries(rows.map((r) => [r.channel, { requests: num(r.requests), searches: num(r.searches) }])),
  };
}

/** The whole analysis: totals, the groups, the counts over time, the latest requests. */
async function analyse(query) {
  const ask = readAsk(query);
  const [t, g, s, l, earlier] = await Promise.all([totals(ask), groups(ask), series(ask), latest(ask), rolledUp(ask)]);
  return {
    ask: { by: ask.by, where: ask.where, since: ask.since, until: ask.until, all: ask.all },
    keptDays: settings.get("allocation.public_visit_days"),
    dimensions: DIMENSION_LIST,
    filters: await filterNames(ask.where),
    totals: t,
    groups: g.rows,
    truncated: g.truncated,
    series: s,
    latest: l,
    earlier,
  };
}

/** The filters, with names, for the chips that show them. */
async function filterNames(where) {
  const rows = [Object.fromEntries(where.map((w, i) => [`g${i}`, w.value]))];
  const name = await namer(
    where.map((w) => w.key),
    rows
  );
  return where.map((w) => ({ ...w, field: DIMENSIONS[w.key].label, label: name(w.key, w.value) }));
}

/** The groups as a spreadsheet: one line each, the fields' names then the counts. */
async function csv(query) {
  const ask = readAsk(query);
  const g = await groups(ask);
  const header = [...ask.by.map((k) => DIMENSIONS[k].label), "Requests", "People", "Visitors", "Found nothing", "Last"];
  return toCsv([
    header,
    ...g.rows.map((r) => [
      ...r.labels,
      r.requests,
      r.people,
      r.visitors,
      r.nothing,
      r.lastAt ? new Date(r.lastAt).toISOString() : "",
    ]),
  ]);
}

/** Today's searches, both channels: the count on the Requests tab. */
async function today() {
  const [row] = await sequelize.query(
    `SELECT COUNT(*) AS searches, COUNT(DISTINCT user_id) AS people, COUNT(DISTINCT visitor_id) AS visitors
       FROM public_visits WHERE kind = 'list' AND created_at >= :start`,
    { replacements: { start: utc(startOf(todayInDhaka())) }, type: QueryTypes.SELECT }
  );
  return { searches: num(row.searches), people: num(row.people), visitors: num(row.visitors) };
}

module.exports = {
  DIMENSIONS,
  searchOf,
  queryKeyOf,
  recordAppSearch,
  readAsk,
  groupsSql,
  analyse,
  csv,
  today,
};
