const crypto = require("crypto");
const env = require("../config/env");

/**
 * A pass for a browser that has got through the bot check: its visitor id and
 * an expiry, signed, so it need not take the check again on every search.
 *
 *   "<expires, ms>.<signature>"   tied to one visitor id
 */
const key = () => crypto.createHash("sha256").update(`public-pass:${env.jwt.secret}`).digest();
const sign = (visitorId, expires) => crypto.createHmac("sha256", key()).update(`${visitorId}.${expires}`).digest("base64url");

function issuePass(visitorId, minutes = 60, now = Date.now()) {
  const expires = now + minutes * 60_000;
  return { pass: `${expires}.${sign(visitorId, expires)}`, expiresAt: new Date(expires) };
}

function checkPass(pass, visitorId, now = Date.now()) {
  const [expiresText, signature] = String(pass || "").split(".");
  const expires = Number(expiresText);
  if (!visitorId || !signature || !Number.isFinite(expires) || expires < now) return false;
  const expected = Buffer.from(sign(visitorId, expires));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

module.exports = { issuePass, checkPass };
