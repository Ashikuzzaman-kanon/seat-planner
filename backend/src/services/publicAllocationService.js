const { Op, QueryTypes } = require("sequelize");
const { sequelize, PublicVisit, PublicVisitDay, User } = require("../models");
const { VISIT_OUTCOMES, VISIT_CHANNELS } = require("../models/PublicVisit");
const ApiError = require("../utils/ApiError");
const env = require("../config/env");
const settings = require("./settingService");
const features = require("./featureService");
const allocation = require("./allocationService");
const audit = require("./auditService");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { createLimiter } = require("../utils/rateLimiter");
const { issuePass, checkPass } = require("../utils/publicPass");
const { todayInDhaka, addDays } = require("../utils/dhakaTime");
const { searchOf, queryKeyOf } = require("./allocationRequestService");

/**
 * Seat Allocation for everyone, at /seat-allocation, without signing in —
 * a shop window for the site.
 *
 * Read-only: the same filters, list and grid as in the app, nothing that
 * changes anything. Switched on in Settings, and off with the Seat Allocation
 * tab when that is switched off for everyone.
 *
 * Guarded three ways: a limit on requests per internet address and for the
 * whole page (in memory — a flood is stopped, not booked); a bot check
 * (Cloudflare Turnstile, once its keys are set) whose pass lasts an hour; and
 * a number of free searches a day, per browser and per address, after which
 * a visitor is asked to sign in — counted from the visit records, so a
 * restart does not hand out a fresh allowance.
 *
 * Every request is recorded (public_visits, and the audit log): when, from
 * where, which browser, what was searched and what happened. Records older
 * than the days set in Settings are folded into each day's totals.
 *
 * The same table holds the searches made inside the app (channel "app",
 * services/allocationRequestService); everything here — the free searches,
 * the managers' view of the page — counts the public page's rows only.
 */

const FEATURE = "seat-allocation";
const PASS_MINUTES = 60;
const BLOCKED = [VISIT_OUTCOMES.RATE_LIMITED, VISIT_OUTCOMES.BOT_CHECK, VISIT_OUTCOMES.REFUSED];
const DAY_MS = 86_400_000;

const limiter = createLimiter();

/* ------------------------------------------------------------------ *
 * On or off
 * ------------------------------------------------------------------ */

function enabled() {
  return Boolean(settings.get("allocation.public_enabled")) && !features.offForEveryone(FEATURE);
}

/** For sessions and /auth/me: what signed-in people may see because it is public. */
function publicFeatures() {
  return enabled() ? [FEATURE] : [];
}

const botCheckOn = () => Boolean(env.publicPage.turnstileSiteKey && env.publicPage.turnstileSecretKey);

function status() {
  return {
    enabled: enabled(),
    botCheck: botCheckOn() ? { siteKey: env.publicPage.turnstileSiteKey } : null,
  };
}

/* ------------------------------------------------------------------ *
 * Errors the page knows how to show
 * ------------------------------------------------------------------ */

function coded(statusCode, message, code, details) {
  const error = new ApiError(statusCode, message, details);
  error.code = code;
  return error;
}

const offError = () => coded(404, "Seat Allocation is not open to the public right now.", "PUBLIC_OFF");

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

/** The Dhaka day a moment falls on, and when it began. */
const dayStart = (day = todayInDhaka()) => new Date(`${day}T00:00:00+06:00`);

/**
 * A moment as the database stores it (UTC, "YYYY-MM-DD HH:MM:SS"), for the
 * raw queries below: a Date passed to them as it is is written in the
 * server's local time, six hours out here.
 */
const utc = (date) => date.toISOString().slice(0, 19).replace("T", " ");

/**
 * Record one request: in public_visits, and in the audit log. Never fails the
 * request. Returns when the visit is saved — a search waits for it, since the
 * free searches are counted from these rows and the next search may come at
 * once; everything else carries on without waiting. A flood of refused
 * requests is recorded once a minute per address and outcome, so it cannot
 * fill the tables itself.
 */
function record(visitor, { kind, outcome, query = null, queryKey = null, results = null, user = null }) {
  if (BLOCKED.includes(outcome) && !limiter.hit(`rec:${visitor.ip}:${outcome}`, 1, 60_000).ok) return Promise.resolve();
  const saved = PublicVisit.create({
    kind,
    outcome,
    channel: VISIT_CHANNELS.PUBLIC,
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
    referrer: visitor.referrer,
    query,
    queryKey,
    results,
  }).catch((err) => console.error("[public] visit not recorded:", err.message));
  audit
    .record({
      action: AUDIT_ACTIONS.ALLOCATION_PUBLIC_VIEW,
      entity: { type: "allocation", id: queryKey || kind, label: `Public ${kind}` },
      after: {
        kind,
        outcome,
        query,
        results,
        visitorId: visitor.visitorId,
        country: visitor.country,
        city: visitor.city,
        browser: visitor.browser,
        os: visitor.os,
        device: visitor.device,
        language: visitor.language,
        referrer: visitor.referrer,
      },
      outcome: outcome === VISIT_OUTCOMES.SHOWN ? "success" : "failure",
      message: `Public seat allocation: ${kind}, ${outcome.replace(/_/g, " ")}`,
    })
    .catch(() => {});
  return saved;
}

/* ------------------------------------------------------------------ *
 * Limits
 * ------------------------------------------------------------------ */

const secondsToMidnight = (now = Date.now()) => Math.ceil((dayStart(addDays(todayInDhaka(), 1)) - now) / 1000);

/**
 * Count one request against the limits: per address a minute and a day, and
 * for the whole page a second. Throws, after recording it, when one is over.
 */
function throttle(visitor, kind, user = null) {
  const perSecond = settings.get("allocation.public_requests_per_second");
  const perMinute = settings.get("allocation.public_requests_per_minute");
  const perDay = settings.get("allocation.public_requests_per_day");
  const ip = visitor.ip || "unknown";
  const all = limiter.hit("all", perSecond, 1000);
  const minute = limiter.hit(`ip:${ip}`, perMinute, 60_000);
  // A day by Dhaka's calendar: the key carries the date, and the window is long
  // enough never to roll over within it.
  const day = limiter.hit(`day:${ip}:${todayInDhaka()}`, perDay, 400 * DAY_MS);
  const over = [all, minute].find((h) => !h.ok) || (!day.ok ? { retryAfterSeconds: secondsToMidnight() } : null);
  if (!over) return;
  record(visitor, { kind, outcome: VISIT_OUTCOMES.RATE_LIMITED, user });
  const error = coded(
    429,
    day.ok ? "Too many requests. Wait a moment and try again." : "Too many requests from your connection today. Try again tomorrow.",
    "RATE_LIMITED"
  );
  error.retryAfterSeconds = over.retryAfterSeconds;
  throw error;
}

/* ------------------------------------------------------------------ *
 * The bot check
 * ------------------------------------------------------------------ */

async function verifyTurnstile(token, ip) {
  try {
    const res = await fetch(env.publicPage.turnstileVerifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: env.publicPage.turnstileSecretKey,
        response: String(token || ""),
        ...(ip ? { remoteip: ip } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    return data.success === true;
  } catch {
    return false;
  }
}

/** A browser that passed the bot check gets a pass for an hour. With no bot check set up, none is needed. */
async function pass(visitor, token) {
  if (!botCheckOn()) return { required: false, pass: null, expiresAt: null };
  if (!visitor.visitorId) throw ApiError.badRequest("Reload the page and try again");
  if (!(await verifyTurnstile(token, visitor.ip))) {
    record(visitor, { kind: "pass", outcome: VISIT_OUTCOMES.BOT_CHECK });
    throw coded(403, "The check that you are not a robot did not pass. Try again.", "BOT_CHECK");
  }
  record(visitor, { kind: "pass", outcome: VISIT_OUTCOMES.SHOWN });
  return { required: true, ...issuePass(visitor.visitorId, PASS_MINUTES) };
}

function requirePass(visitor, passText, user, kind) {
  if (!botCheckOn() || user) return;
  if (checkPass(passText, visitor.visitorId)) return;
  record(visitor, { kind, outcome: VISIT_OUTCOMES.BOT_CHECK });
  throw coded(403, "Please confirm you are not a robot.", "BOT_CHECK", { siteKey: env.publicPage.turnstileSiteKey });
}

/* ------------------------------------------------------------------ *
 * What the public sees
 * ------------------------------------------------------------------ */

/** The filters and how current the data is — without who uploaded what. */
async function meta() {
  const m = await allocation.meta();
  const census = m.latest?.census;
  const counts = m.latest?.counts;
  const dates = [census?.at, counts?.at].filter(Boolean).map((d) => new Date(d));
  return {
    trains: m.trains.map(({ number, name }) => ({ number, name })),
    stations: m.stations,
    classes: m.classes,
    totals: { trains: m.totals.trains, pairs: m.totals.pairs, allocated: m.totals.allocated },
    lastUpdated: dates.length ? new Date(Math.max(...dates)) : null,
    railwayChecked: census?.scannedFrom ? { from: census.scannedFrom, to: census.scannedTo } : null,
  };
}

/** What everyone sees on arriving — every allocated pair, no filter chosen. Not counted as a search. */
const ARRIVAL = queryKeyOf({});

async function overFreeSearches(visitor, key) {
  const free = settings.get("allocation.public_free_searches");
  const perIp = settings.get("allocation.public_searches_per_ip_day");
  const since = dayStart();
  if (key === ARRIVAL) return false;
  const shown = {
    channel: VISIT_CHANNELS.PUBLIC,
    kind: "list",
    outcome: VISIT_OUTCOMES.SHOWN,
    createdAt: { [Op.gte]: since },
    queryKey: { [Op.notIn]: [ARRIVAL] },
  };
  // The same search again — the next page, coming back to it — is free.
  if (await PublicVisit.count({ where: { ...shown, visitorId: visitor.visitorId, queryKey: key } })) return false;
  const mine = await PublicVisit.count({ where: { ...shown, visitorId: visitor.visitorId }, distinct: true, col: "query_key" });
  if (mine >= free) return true;
  if (!visitor.ip) return false;
  const [{ n }] = await sequelize.query(
    `SELECT COUNT(DISTINCT visitor_id, query_key) AS n FROM public_visits
      WHERE channel = 'public' AND ip = :ip AND kind = 'list' AND outcome = 'shown' AND query_key IS NOT NULL
        AND query_key <> :arrival AND created_at >= :since`,
    { replacements: { ip: visitor.ip, since: utc(since), arrival: ARRIVAL }, type: QueryTypes.SELECT }
  );
  return Number(n) >= perIp;
}

/**
 * A search. Anyone signed in searches freely; anyone else has the free
 * searches of the day, and is then asked to sign in.
 */
async function list(visitor, filters, user = null) {
  if (!visitor.visitorId) throw ApiError.badRequest("Reload the page and try again");
  const query = searchOf(filters);
  const queryKey = queryKeyOf(filters);
  if (!user && (await overFreeSearches(visitor, queryKey))) {
    await record(visitor, { kind: "list", outcome: VISIT_OUTCOMES.SIGN_IN, query, queryKey });
    throw coded(
      403,
      "You have used today's free searches. Sign in or create a free account to keep searching.",
      "SIGN_IN_REQUIRED",
      { freeSearches: settings.get("allocation.public_free_searches") }
    );
  }
  const result = await allocation.list(filters);
  await record(visitor, { kind: "list", outcome: VISIT_OUTCOMES.SHOWN, query, queryKey, results: result.total, user });
  return { ...result, items: result.items.map(({ source, ...rest }) => rest) };
}

/* ------------------------------------------------------------------ *
 * For the Requests tab: how the public page is used
 * ------------------------------------------------------------------ */

const blockedSql = `outcome IN (${BLOCKED.map((o) => `'${o}'`).join(",")})`;

async function totalsSince(since) {
  const [row] = await sequelize.query(
    `SELECT COUNT(*) AS requests,
            COALESCE(SUM(kind = 'list' AND outcome = 'shown'), 0) AS searches,
            COUNT(DISTINCT visitor_id) AS visitors,
            COALESCE(SUM(outcome = 'sign_in'), 0) AS prompted,
            COALESCE(SUM(${blockedSql}), 0) AS blocked
       FROM public_visits WHERE channel = 'public' AND created_at >= :since`,
    { replacements: { since: utc(since) }, type: QueryTypes.SELECT }
  );
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)]));
}

async function journeysSince(since, limit = 10) {
  const rows = await sequelize.query(
    `SELECT query_key AS queryKey, ANY_VALUE(query) AS query, COUNT(*) AS searches, COUNT(DISTINCT visitor_id) AS visitors
       FROM public_visits
      WHERE channel = 'public' AND kind = 'list' AND outcome = 'shown' AND query_key IS NOT NULL AND created_at >= :since
      GROUP BY query_key ORDER BY searches DESC LIMIT ${Number(limit)}`,
    { replacements: { since: utc(since) }, type: QueryTypes.SELECT }
  );
  return rows.map((r) => ({
    query: typeof r.query === "string" ? JSON.parse(r.query) : r.query,
    searches: Number(r.searches),
    visitors: Number(r.visitors),
  }));
}

async function spreadSince(since, column) {
  const rows = await sequelize.query(
    `SELECT ${column} AS value, COUNT(DISTINCT visitor_id) AS visitors FROM public_visits
      WHERE channel = 'public' AND created_at >= :since GROUP BY ${column} ORDER BY visitors DESC LIMIT 6`,
    { replacements: { since: utc(since) }, type: QueryTypes.SELECT }
  );
  return rows.map((r) => ({ value: r.value, visitors: Number(r.visitors) }));
}

async function visits() {
  const today = dayStart();
  const week = new Date(today.getTime() - 6 * DAY_MS);
  const month = new Date(today.getTime() - 29 * DAY_MS);
  const [t, w, m, journeys, countries, devices, latest, earlier] = await Promise.all([
    totalsSince(today),
    totalsSince(week),
    totalsSince(month),
    journeysSince(month),
    spreadSince(month, "country"),
    spreadSince(month, "device"),
    PublicVisit.findAll({
      where: { channel: VISIT_CHANNELS.PUBLIC },
      include: [{ model: User, as: "user", attributes: ["id", "fullName"] }],
      order: [["id", "DESC"]],
      limit: 50,
    }),
    PublicVisitDay.findAll({ where: { channel: VISIT_CHANNELS.PUBLIC }, order: [["day", "ASC"]] }),
  ]);
  return {
    enabled: enabled(),
    botCheck: botCheckOn(),
    edgeSecret: Boolean(env.publicPage.edgeSecret),
    keptDays: settings.get("allocation.public_visit_days"),
    today: t,
    week: w,
    month: m,
    journeys,
    countries,
    devices,
    latest: latest.map((v) => ({
      at: v.createdAt,
      kind: v.kind,
      outcome: v.outcome,
      ip: v.ip,
      country: v.country,
      city: v.city,
      browser: v.browser,
      os: v.os,
      device: v.device,
      language: v.language,
      referrer: v.referrer,
      visitorId: v.visitorId,
      user: v.user ? { id: v.user.id, fullName: v.user.fullName } : null,
      query: v.query,
      results: v.results,
    })),
    earlier: earlier.length
      ? {
          from: earlier[0].day,
          to: earlier[earlier.length - 1].day,
          days: earlier.length,
          requests: earlier.reduce((s, d) => s + d.requests, 0),
          searches: earlier.reduce((s, d) => s + d.searches, 0),
        }
      : null,
  };
}

/**
 * The daily sweep: fold the requests older than the days kept into each
 * day's totals — the public page's and the app's apart — then delete them.
 * Whole Dhaka days only.
 */
async function prune() {
  const keep = settings.get("allocation.public_visit_days");
  const cutoff = dayStart(addDays(todayInDhaka(), -keep + 1));
  const days = await sequelize.query(
    `SELECT DATE(DATE_ADD(created_at, INTERVAL 6 HOUR)) AS day, channel,
            COUNT(*) AS requests,
            COALESCE(SUM(kind = 'list' AND outcome = 'shown'), 0) AS searches,
            COUNT(DISTINCT visitor_id) AS visitors,
            COALESCE(SUM(outcome = 'sign_in'), 0) AS prompted,
            COALESCE(SUM(${blockedSql}), 0) AS blocked
       FROM public_visits WHERE created_at < :cutoff GROUP BY day, channel`,
    { replacements: { cutoff: utc(cutoff) }, type: QueryTypes.SELECT }
  );
  for (const d of days) {
    const day = typeof d.day === "string" ? d.day.slice(0, 10) : new Date(d.day).toISOString().slice(0, 10);
    const start = dayStart(day);
    const top = await sequelize.query(
      `SELECT ANY_VALUE(query) AS query, COUNT(*) AS searches FROM public_visits
        WHERE channel = :channel AND kind = 'list' AND outcome = 'shown' AND query_key IS NOT NULL
          AND created_at >= :start AND created_at < :end
        GROUP BY query_key ORDER BY searches DESC LIMIT 10`,
      {
        replacements: { channel: d.channel, start: utc(start), end: utc(new Date(start.getTime() + DAY_MS)) },
        type: QueryTypes.SELECT,
      }
    );
    const add = {
      requests: Number(d.requests),
      searches: Number(d.searches),
      visitors: Number(d.visitors),
      prompted: Number(d.prompted),
      blocked: Number(d.blocked),
    };
    const [row, made] = await PublicVisitDay.findOrCreate({
      where: { day, channel: d.channel },
      defaults: { day, channel: d.channel, ...add, journeys: [] },
    });
    const journeys = top.map((r) => ({ query: typeof r.query === "string" ? JSON.parse(r.query) : r.query, searches: Number(r.searches) }));
    if (made) await row.update({ journeys });
    else {
      await row.update({
        requests: row.requests + add.requests,
        searches: row.searches + add.searches,
        visitors: row.visitors + add.visitors,
        prompted: row.prompted + add.prompted,
        blocked: row.blocked + add.blocked,
        journeys: [...(row.journeys || []), ...journeys],
      });
    }
  }
  const deleted = await PublicVisit.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
  return { days: days.length, deleted };
}

module.exports = {
  FEATURE,
  enabled,
  publicFeatures,
  status,
  offError,
  record,
  throttle,
  pass,
  requirePass,
  meta,
  list,
  queryKeyOf,
  visits,
  prune,
  limiter,
};
