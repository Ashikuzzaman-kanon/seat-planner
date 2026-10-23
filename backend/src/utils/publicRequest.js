const crypto = require("crypto");
const env = require("../config/env");
const { parseUserAgent } = require("./userAgent");

/**
 * Who a request to the public Seat Allocation page comes from, as far as can
 * be told without a sign-in.
 *
 * The browser talks to the web app, whose server passes the request on to the
 * API (frontend/src/middleware.js) with the visitor's real address and rough
 * location, and a secret shared between the two. With the secret set
 * (PUBLIC_EDGE_SECRET), only those headers are believed, and a request
 * without the secret is refused — nobody can call the API directly and claim
 * another address. Without it (a developer's machine, the tests), the
 * headers are taken as they come; in production that would let an address
 * be faked, so the server says so when it starts.
 */
const VISITOR_ID = /^[A-Za-z0-9-]{16,64}$/;

const clip = (text, max) => {
  const s = String(text ?? "").trim();
  return s ? s.slice(0, max) : null;
};

function edgeVouches(req) {
  const secret = env.publicPage.edgeSecret;
  if (!secret) return null; // not configured: nothing to check
  const given = Buffer.from(String(req.headers["x-sp-edge"] || ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function firstForwarded(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || null;
}

/**
 * { ip, country, city, visitorId, userAgent, browser, os, device, bot,
 *   language, referrer, vouched }
 * `vouched`: true with the secret, false with a wrong or missing one, null
 * when no secret is configured.
 */
function readVisitor(req) {
  const vouched = edgeVouches(req);
  const fromEdge = vouched === true || (vouched === null && !env.isProduction);
  const ip = (fromEdge && clip(req.headers["x-sp-client-ip"], 64)) || clip(firstForwarded(req), 64) || clip(req.ip, 64);
  let city = fromEdge ? clip(req.headers["x-sp-city"], 80) : null;
  try {
    if (city) city = decodeURIComponent(city);
  } catch {
    /* keep it as it came */
  }
  const ua = clip(req.headers["user-agent"], 400);
  const visitor = String(req.headers["x-sp-visitor"] || "");
  return {
    ip,
    country: fromEdge ? clip(req.headers["x-sp-country"], 8) : null,
    city,
    visitorId: VISITOR_ID.test(visitor) ? visitor : null,
    userAgent: ua,
    ...parseUserAgent(ua),
    language: clip(String(req.headers["accept-language"] || "").split(",")[0], 60),
    // The page the visitor came from (Facebook, a search…): the browser sends
    // it, since its own Referer for an API call is just this site.
    referrer: clip(req.headers["x-sp-referrer"], 300),
    vouched,
  };
}

module.exports = { readVisitor, VISITOR_ID };
