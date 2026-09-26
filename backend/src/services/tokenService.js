const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const env = require("../config/env");
const settings = require("./settingService");
const { RefreshToken } = require("../models");

/**
 * Two-token session model.
 *
 * The access token is a short-lived JWT carrying **identity only** — never a
 * frozen list of permissions. Permissions are resolved per request from the
 * database, so revoking a role takes effect within the access token's lifetime
 * rather than whenever the user next logs out.
 *
 * The refresh token is an opaque random string, stored only as a SHA-256 hash.
 * A leaked database therefore cannot be used to mint sessions, and any session
 * can be revoked server-side.
 */

/** "15m" | "30d" | "12h" | "45s" -> milliseconds. */
function parseDuration(value) {
  const match = /^(\d+)\s*([smhd])$/.exec(String(value).trim());
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(match[1]) * units[match[2]];
}

function signAccessToken(user) {
  // Lifetimes come from the settings store, so an administrator can trade
  // revocation latency against refresh traffic without a deploy.
  return jwt.sign({ sub: user.id }, env.jwt.secret, {
    expiresIn: `${settings.get("auth.access_token_ttl_minutes")}m`,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.secret);
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/** Mint a refresh token, persist its hash, and return the raw value once. */
async function issueRefreshToken(user, { userAgent, ipAddress } = {}) {
  const rawToken = crypto.randomBytes(48).toString("base64url");

  const ttlDays = settings.get("auth.refresh_token_ttl_days");

  await RefreshToken.create({
    userId: user.id,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
    userAgent: userAgent?.slice(0, 300) || null,
    ipAddress: ipAddress?.slice(0, 64) || null,
  });

  return rawToken;
}

/** Find the stored record for a raw token, or null if unknown/expired/revoked. */
async function findActiveRefreshToken(rawToken) {
  if (!rawToken) return null;
  const record = await RefreshToken.findOne({ where: { tokenHash: hashToken(rawToken) } });
  return record?.isActive ? record : null;
}

/**
 * Rotate a refresh token: the presented one is revoked and a fresh one issued.
 * Rotation means a stolen token is usable at most once before the legitimate
 * holder's next refresh invalidates it.
 */
async function rotateRefreshToken(record, user, context) {
  record.revokedAt = new Date();
  await record.save();
  return issueRefreshToken(user, context);
}

async function revokeRefreshToken(rawToken) {
  const record = await findActiveRefreshToken(rawToken);
  if (!record) return false;
  record.revokedAt = new Date();
  await record.save();
  return true;
}

/** Revoke every live session for a user — used when access is withdrawn. */
async function revokeAllForUser(userId) {
  const [count] = await RefreshToken.update(
    { revokedAt: new Date() },
    { where: { userId, revokedAt: null, expiresAt: { [Op.gt]: new Date() } } }
  );
  return count;
}

/** Generate a 6-digit numeric OTP for email verification / password reset. */
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  findActiveRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  generateOtp,
  parseDuration,
};
