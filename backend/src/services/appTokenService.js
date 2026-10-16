const crypto = require("crypto");
const { Op } = require("sequelize");
const { AppToken, User } = require("../models");
const ApiError = require("../utils/ApiError");
const rules = require("../utils/subscriptionDevices");
const settings = require("./settingService");

/**
 * What a subscriber's app signs in with after its first check.
 *
 * The check, answered with the right password from a named device, also hands
 * back a token. The app then sends it — `Authorization: Bearer <token>` — in
 * place of the email and password, on the check and on seat plans, until it
 * runs out (setting `subscription.app_token_hours`). The app never has to keep
 * the password.
 *
 * A token is one account on one device. A new sign-in from that device
 * replaces it; it is revoked when the password changes or the account is
 * restricted (tokenService `revokeAllForUser`), and when staff remove or block
 * the device (`revokeForDevice`). Only its hash is stored.
 *
 * It proves who is calling and from where — nothing more. Every call it is
 * used on still decides afresh whether a subscription is running, the device
 * has a place and the app's version is accepted.
 */

const PREFIX = "spa_";
const SIGN_IN_AGAIN = "Sign in again";

const hash = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

/** The bearer token a request carries, or null. */
function bearerOf(req) {
  const header = req.get("authorization") || "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * A token for this account on the device the call named, or null when it
 * named none that can be one (no id, a malformed id, no platform). Replaces
 * any token the device already had.
 */
async function issue(user, sent, now = new Date()) {
  const device = rules.cleanDeviceId(sent.deviceId);
  const platform = rules.cleanPlatformValue(sent.platform);
  if (device.reason || !platform) return null;

  await AppToken.update(
    { revokedAt: now },
    { where: { userId: user.id, deviceId: device.id, platformValue: platform, revokedAt: null } }
  );
  const raw = PREFIX + crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + settings.get("subscription.app_token_hours") * 3_600_000);
  await AppToken.create({ userId: user.id, tokenHash: hash(raw), deviceId: device.id, platformValue: platform, expiresAt });
  return { token: raw, expiresAt };
}

/**
 * Who a token belongs to and the device it was given to, or 401. An account
 * restricted since — whose tokens are revoked anyway — is told it is.
 */
async function resolve(raw, now = new Date()) {
  const record = raw?.startsWith(PREFIX) ? await AppToken.findOne({ where: { tokenHash: hash(raw) } }) : null;
  if (!record || record.revokedAt || record.expiresAt <= now) throw ApiError.unauthorized(SIGN_IN_AGAIN);

  const user = await User.findByPk(record.userId);
  if (!user) throw ApiError.unauthorized(SIGN_IN_AGAIN);
  if (user.restrictedAt) throw ApiError.forbidden("This account is restricted. Contact an administrator.");

  await record.update({ lastUsedAt: now });
  return { user, device: { deviceId: record.deviceId, platform: record.platformValue }, expiresAt: record.expiresAt };
}

/** End every token an account has — a new password, a restriction. */
async function revokeAllForUser(userId, now = new Date()) {
  const [count] = await AppToken.update({ revokedAt: now }, { where: { userId, revokedAt: null, expiresAt: { [Op.gt]: now } } });
  return count;
}

/** End the token of one device — staff removed or blocked it. */
async function revokeForDevice(userId, deviceId, platformValue, now = new Date()) {
  const [count] = await AppToken.update(
    { revokedAt: now },
    { where: { userId, deviceId, platformValue, revokedAt: null } }
  );
  return count;
}

/** Drop tokens that ended more than a week ago. Called by the hourly sweep. */
async function prune(now = new Date()) {
  const before = new Date(now.getTime() - 7 * 86_400_000);
  return AppToken.destroy({ where: { [Op.or]: [{ expiresAt: { [Op.lt]: before } }, { revokedAt: { [Op.lt]: before } }] } });
}

module.exports = { PREFIX, SIGN_IN_AGAIN, bearerOf, issue, resolve, revokeAllForUser, revokeForDevice, prune };
