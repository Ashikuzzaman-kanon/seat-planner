const { fn, col } = require("sequelize");
const { SubscriptionPlatform, SubscriptionBlockedVersion, UserDevice, User } = require("../models");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const rules = require("../utils/subscriptionDevices");
const { VERSION_REFUSAL, cleanVersion, compareVersions, judgeVersion } = require("../utils/appVersion");
const audit = require("./auditService");

/**
 * Which versions of the apps may make a subscription check, platform by
 * platform.
 *
 * A caller says which version of its app is calling (`version`). Each platform
 * may require that it says, set the oldest version it still lets through, and
 * block single versions whatever the minimum. A check that fails here is
 * answered with an error the app can show — and before its password is even
 * looked at, so a refused version learns nothing about the account.
 *
 * Nothing is required to start with: a platform with no rules lets every
 * check through, with or without a version, as before.
 */

/** What the caller is told, and with which status. Two refusals share words: either way, update. */
const ANSWER = Object.freeze({
  [VERSION_REFUSAL.REQUIRED]: [400, "A version is required"],
  [VERSION_REFUSAL.INVALID]: [400, "The version is not valid. Send it as numbers and dots, such as 1.4.2"],
  [VERSION_REFUSAL.TOO_OLD]: [426, "This version is no longer supported. Please update."],
  [VERSION_REFUSAL.BLOCKED]: [426, "This version is no longer supported. Please update."],
});

/** And what the audit log is told. */
const WORDS = Object.freeze({
  [VERSION_REFUSAL.REQUIRED]: "no version was sent, and this platform requires one",
  [VERSION_REFUSAL.INVALID]: "the version sent is not one",
  [VERSION_REFUSAL.TOO_OLD]: "the version is older than this platform's minimum",
  [VERSION_REFUSAL.BLOCKED]: "the version is blocked on this platform",
});

const BLOCKED = { model: SubscriptionBlockedVersion, as: "blockedVersions" };

/**
 * Let a check through on its version, or refuse it. Returns the version,
 * cleaned — or null when none was sent and none is required.
 *
 * A platform that does not exist or is switched off has no rules here; the
 * device check turns those away afterwards, with nothing said.
 */
async function gate(sent, { email } = {}) {
  const value = rules.cleanPlatformValue(sent.platform);
  const platform = value ? await SubscriptionPlatform.findOne({ where: { value }, include: [{ ...BLOCKED, attributes: ["version"] }] }) : null;
  const policy =
    platform && platform.isActive
      ? { required: platform.versionRequired, minVersion: platform.minVersion, blocked: platform.blockedVersions.map((b) => b.version) }
      : {};

  const verdict = judgeVersion(sent.version, policy);
  if (!verdict.refusal) return verdict.version;

  // Recorded like any check that is answered, but with no account: the
  // password has not been checked, so all that is known is the address typed.
  const typed = String(email || "").toLowerCase().trim() || null;
  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_CHECK,
    actor: { id: null, email: typed },
    entity: { type: "user", id: null, label: typed },
    after: {
      platform: rules.asSent(sent.platform, 40).toLowerCase() || null,
      deviceId: rules.asSent(sent.deviceId, 128) || null,
      version: rules.asSent(sent.version, 40) || null,
      reason: verdict.refusal,
    },
    outcome: "failure",
    message: `subscription check refused on its version, before the password was checked: ${WORDS[verdict.refusal]}`,
  });
  const [status, message] = ANSWER[verdict.refusal];
  throw new ApiError(status, message);
}

/* ------------------------------------------------------------------ *
 * Looking after the rules
 * ------------------------------------------------------------------ */

/** Newest version first; devices that never said, last. */
const newestFirst = (a, b) => (a.version && b.version ? compareVersions(b.version, a.version) : a.version ? -1 : b.version ? 1 : 0);

/**
 * Every platform with its version rules, and the versions its devices last
 * checked in with — so a minimum is set knowing who it would turn away.
 */
async function policies() {
  const [platforms, seen] = await Promise.all([
    SubscriptionPlatform.findAll({
      include: [{ ...BLOCKED, include: [{ model: User, as: "createdBy", attributes: ["id", "fullName"] }] }],
      order: [["id", "ASC"], [BLOCKED, "createdAt", "ASC"]],
    }),
    UserDevice.findAll({
      attributes: ["platformId", "appVersion", [fn("COUNT", col("id")), "devices"], [fn("MAX", col("last_seen_at")), "lastSeenAt"]],
      group: ["platformId", "appVersion"],
      raw: true,
    }),
  ]);
  return {
    platforms: platforms.map((p) => ({
      ...p.toPublicJSON(),
      blocked: p.blockedVersions.map((b) => b.toPublicJSON()),
      inUse: seen
        .filter((r) => r.platformId === p.id)
        .map((r) => ({ version: r.appVersion || null, devices: Number(r.devices), lastSeenAt: r.lastSeenAt }))
        .sort(newestFirst),
    })),
  };
}

async function platformOr404(id) {
  const platform = await SubscriptionPlatform.findByPk(id);
  if (!platform) throw ApiError.notFound("No such platform");
  return platform;
}
const entityOf = (platform) => ({ type: "subscription_platform", id: platform.id, label: platform.value });
const policyOf = (platform) => ({ versionRequired: platform.versionRequired, minVersion: platform.minVersion });
/** "2" and "2.0" are one version: changing one to the other changes nothing. */
const sameMinimum = (a, b) => (a && b ? compareVersions(a, b) === 0 : a === b);

/**
 * Change whether a platform requires a version, and its minimum. `minVersion`
 * empty or null clears it.
 */
async function setPolicy(platformId, { versionRequired, minVersion }) {
  const platform = await platformOr404(platformId);
  const before = policyOf(platform);

  if (versionRequired !== undefined) platform.versionRequired = Boolean(versionRequired);
  if (minVersion !== undefined) {
    if (minVersion === null || String(minVersion).trim() === "") platform.minVersion = null;
    else {
      const clean = cleanVersion(minVersion);
      if (!clean) throw ApiError.badRequest("The minimum version is not valid. Write it as numbers and dots, such as 1.4.2");
      platform.minVersion = clean;
    }
  }
  const after = policyOf(platform);
  if (before.versionRequired === after.versionRequired && sameMinimum(before.minVersion, after.minVersion)) {
    throw ApiError.badRequest("Nothing would change — it is already like that");
  }
  await platform.save();

  const said = [
    before.versionRequired !== after.versionRequired && (after.versionRequired ? "a version is now required" : "a version is no longer required"),
    !sameMinimum(before.minVersion, after.minVersion) && (after.minVersion ? `the minimum is now ${after.minVersion}` : "there is no longer a minimum"),
  ].filter(Boolean);
  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_VERSION_POLICY,
    entity: entityOf(platform),
    before,
    after,
    message: `${platform.name} app: ${said.join("; ")}`,
  });
  return policyOf(platform);
}

/** Turn one version of a platform's app away, whatever its minimum. */
async function block(platformId, { version, note }, actor) {
  const platform = await platformOr404(platformId);
  const clean = cleanVersion(version);
  if (!clean) throw ApiError.badRequest("The version is not valid. Write it as numbers and dots, such as 1.4.2");

  const already = await SubscriptionBlockedVersion.findAll({ where: { platformId: platform.id }, attributes: ["version"] });
  if (already.some((b) => compareVersions(b.version, clean) === 0)) throw ApiError.conflict(`Version ${clean} is already blocked`);

  const row = await SubscriptionBlockedVersion.create({
    platformId: platform.id,
    version: clean,
    note: typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : null,
    createdById: actor?.id ?? null,
  });
  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_VERSION_BLOCK,
    entity: entityOf(platform),
    after: { version: clean, note: row.note },
    message: `${platform.name} app version ${clean} blocked — checks from it are refused`,
  });
  return row.toPublicJSON();
}

/** Let a blocked version through again. */
async function unblock(platformId, blockedId) {
  const platform = await platformOr404(platformId);
  const row = await SubscriptionBlockedVersion.findOne({ where: { id: blockedId, platformId: platform.id } });
  if (!row) throw ApiError.notFound("That version is not blocked on this platform");
  await row.destroy();
  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_VERSION_UNBLOCK,
    entity: entityOf(platform),
    before: { version: row.version, note: row.note },
    message: `${platform.name} app version ${row.version} unblocked`,
  });
  return { unblocked: true };
}

module.exports = { gate, policies, setPolicy, block, unblock };
