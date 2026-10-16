const { fn, col, literal, Op } = require("sequelize");
const {
  Subscription,
  SubscriptionPlatform,
  SubscriptionVersionRule,
  SubscriptionVersionBlock,
  UserDevice,
  User,
} = require("../models");
const { SUBSCRIPTION_STATUS: STATUS } = require("../models/UserSubscription");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const rules = require("../utils/subscriptionDevices");
const { VERSION_REFUSAL, cleanVersion, sentAVersion, compareVersions, judgeVersion } = require("../utils/appVersion");
const audit = require("./auditService");

/**
 * Which versions of the apps each subscription accepts on the subscription
 * check, platform by platform.
 *
 * A caller says which version of its app is calling (`version`). Each
 * subscription may, for each platform, require that it says, set the oldest
 * version it still accepts, and block single versions whatever the minimum. So
 * one version of an app can be fine for one subscription and too old for
 * another, and the check answers each subscription on its own: one that turns
 * the version away is `valid: false` with a message the app can show
 * (`MESSAGE`), and the others are answered as if it had not.
 *
 * One thing is decided for the whole call, before the password is looked at:
 * a version that is not one at all ("latest") is a mistake in the calling app,
 * not a rule, and is refused outright (`gate`).
 *
 * Nothing is required to start with: a subscription with no rules for a
 * platform accepts any version there, or none.
 */

/** What the app is told, on the entry of a subscription that turned its version away. */
const MESSAGE = Object.freeze({
  [VERSION_REFUSAL.REQUIRED]: "A version is required",
  [VERSION_REFUSAL.TOO_OLD]: "This version is no longer supported. Please update.",
  [VERSION_REFUSAL.BLOCKED]: "This version is no longer supported. Please update.",
});

const INVALID = "The version is not valid. Send it as numbers and dots, such as 1.4.2";

/** And what the audit log is told. */
const WORDS = Object.freeze({
  [VERSION_REFUSAL.REQUIRED]: "no version was sent, and one is required",
  [VERSION_REFUSAL.INVALID]: "the version sent is not one",
  [VERSION_REFUSAL.TOO_OLD]: "the version is older than the minimum",
  [VERSION_REFUSAL.BLOCKED]: "the version is blocked",
});

/**
 * Before the password: let the version through if it is one, or none was
 * sent. Returns it cleaned ("v1.04" → "1.4"), or null when none was sent.
 */
async function gate(sent, { email, action = AUDIT_ACTIONS.SUBSCRIPTION_CHECK } = {}) {
  if (!sentAVersion(sent.version)) return null;
  const version = cleanVersion(sent.version);
  if (version) return version;

  // Recorded like any check that is answered, but with no account: the
  // password has not been checked, so all that is known is the address typed.
  const typed = String(email || "").toLowerCase().trim() || null;
  await audit.record({
    action,
    actor: { id: null, email: typed },
    entity: { type: "user", id: null, label: typed },
    after: {
      platform: rules.asSent(sent.platform, 40).toLowerCase() || null,
      deviceId: rules.asSent(sent.deviceId, 128) || null,
      version: rules.asSent(sent.version, 40) || null,
      reason: VERSION_REFUSAL.INVALID,
    },
    outcome: "failure",
    message: `${action === AUDIT_ACTIONS.SUBSCRIPTION_CHECK ? "subscription check" : "seat plans"} refused before the password was checked: ${WORDS[VERSION_REFUSAL.INVALID]}`,
  });
  throw ApiError.badRequest(INVALID);
}

const WITH_BLOCKS = { model: SubscriptionVersionBlock, as: "blocks" };

/**
 * Which of these subscriptions turn the version away on this platform: a Map
 * of subscription id → refusal. `version` is as `gate` returned it.
 */
async function refusals(platformId, subscriptionIds, version) {
  const found = new Map();
  if (!platformId || !subscriptionIds.length) return found;
  const held = await SubscriptionVersionRule.findAll({
    where: { platformId, subscriptionId: subscriptionIds },
    include: [{ ...WITH_BLOCKS, attributes: ["version"] }],
  });
  for (const rule of held) {
    const verdict = judgeVersion(version, {
      required: rule.versionRequired,
      minVersion: rule.minVersion,
      blocked: rule.blocks.map((b) => b.version),
    });
    if (verdict.refusal) found.set(rule.subscriptionId, verdict.refusal);
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * Looking after the rules
 * ------------------------------------------------------------------ */

/** Newest version first; devices that never said, last. */
const newestFirst = (a, b) => (a.version && b.version ? compareVersions(b.version, a.version) : a.version ? -1 : b.version ? 1 : 0);

const policyOf = (rule) => ({ versionRequired: rule?.versionRequired ?? false, minVersion: rule?.minVersion ?? null });

/** The accounts whose subscription to this one is running now, as SQL for an IN. */
const subscribersOf = (subscriptionId) =>
  literal(
    `(SELECT user_id FROM user_subscriptions WHERE subscription_id = ${Number(subscriptionId)} ` +
      `AND status = '${STATUS.ACTIVE}' AND expires_at > UTC_TIMESTAMP())`
  );

async function subscriptionOr404(id) {
  const subscription = await Subscription.findByPk(id, { attributes: ["id", "code", "name"] });
  if (!subscription) throw ApiError.notFound("No such subscription");
  return subscription;
}

async function pairOr404(subscriptionId, platformId) {
  const [subscription, platform] = await Promise.all([subscriptionOr404(subscriptionId), SubscriptionPlatform.findByPk(platformId)]);
  if (!platform) throw ApiError.notFound("No such platform");
  return { subscription, platform };
}

const entityOf = (subscription) => ({ type: "subscription", id: subscription.id, label: subscription.name });

/**
 * One subscription's rules on every platform, and the versions its
 * subscribers' devices last checked in with — so a minimum is set knowing who
 * it would turn away.
 */
async function policies(subscriptionId) {
  const subscription = await subscriptionOr404(subscriptionId);
  const [platforms, held, seen] = await Promise.all([
    SubscriptionPlatform.findAll({ order: [["id", "ASC"]] }),
    SubscriptionVersionRule.findAll({
      where: { subscriptionId: subscription.id },
      include: [{ ...WITH_BLOCKS, include: [{ model: User, as: "createdBy", attributes: ["id", "fullName"] }] }],
      order: [[WITH_BLOCKS, "createdAt", "ASC"]],
    }),
    UserDevice.findAll({
      attributes: ["platformId", "appVersion", [fn("COUNT", col("id")), "devices"], [fn("MAX", col("last_seen_at")), "lastSeenAt"]],
      where: { userId: { [Op.in]: subscribersOf(subscription.id) } },
      group: ["platformId", "appVersion"],
      raw: true,
    }),
  ]);
  return {
    subscription: { id: subscription.id, code: subscription.code, name: subscription.name },
    platforms: platforms.map((p) => {
      const rule = held.find((r) => r.platformId === p.id);
      return {
        ...p.toPublicJSON(),
        ...policyOf(rule),
        blocked: rule ? rule.blocks.map((b) => b.toPublicJSON()) : [],
        inUse: seen
          .filter((r) => r.platformId === p.id)
          .map((r) => ({ version: r.appVersion || null, devices: Number(r.devices), lastSeenAt: r.lastSeenAt }))
          .sort(newestFirst),
      };
    }),
  };
}

/** "2" and "2.0" are one version: changing one to the other changes nothing. */
const sameMinimum = (a, b) => (a && b ? compareVersions(a, b) === 0 : a === b);

/**
 * Change whether a subscription requires a version on a platform, and its
 * minimum there. `minVersion` empty or null clears it.
 */
async function setPolicy(subscriptionId, platformId, { versionRequired, minVersion }) {
  const { subscription, platform } = await pairOr404(subscriptionId, platformId);
  const rule =
    (await SubscriptionVersionRule.findOne({ where: { subscriptionId: subscription.id, platformId: platform.id } })) ||
    SubscriptionVersionRule.build({ subscriptionId: subscription.id, platformId: platform.id });
  const before = policyOf(rule);

  if (versionRequired !== undefined) rule.versionRequired = Boolean(versionRequired);
  if (minVersion !== undefined) {
    if (minVersion === null || String(minVersion).trim() === "") rule.minVersion = null;
    else {
      const clean = cleanVersion(minVersion);
      if (!clean) throw ApiError.badRequest("The minimum version is not valid. Write it as numbers and dots, such as 1.4.2");
      rule.minVersion = clean;
    }
  }
  const after = policyOf(rule);
  if (before.versionRequired === after.versionRequired && sameMinimum(before.minVersion, after.minVersion)) {
    throw ApiError.badRequest("Nothing would change — it is already like that");
  }
  await rule.save();

  const said = [
    before.versionRequired !== after.versionRequired && (after.versionRequired ? "a version is now required" : "a version is no longer required"),
    !sameMinimum(before.minVersion, after.minVersion) && (after.minVersion ? `the minimum is now ${after.minVersion}` : "there is no longer a minimum"),
  ].filter(Boolean);
  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_VERSION_POLICY,
    entity: entityOf(subscription),
    before: { platform: platform.value, ...before },
    after: { platform: platform.value, ...after },
    message: `${subscription.name}, ${platform.name} app: ${said.join("; ")}`,
  });
  return after;
}

/** Turn one version of a platform's app away for one subscription, whatever its minimum. */
async function block(subscriptionId, platformId, { version, note }, actor) {
  const { subscription, platform } = await pairOr404(subscriptionId, platformId);
  const clean = cleanVersion(version);
  if (!clean) throw ApiError.badRequest("The version is not valid. Write it as numbers and dots, such as 1.4.2");

  const [rule] = await SubscriptionVersionRule.findOrCreate({ where: { subscriptionId: subscription.id, platformId: platform.id } });
  const already = await SubscriptionVersionBlock.findAll({ where: { ruleId: rule.id }, attributes: ["version"] });
  if (already.some((b) => compareVersions(b.version, clean) === 0)) throw ApiError.conflict(`Version ${clean} is already blocked`);

  const row = await SubscriptionVersionBlock.create({
    ruleId: rule.id,
    version: clean,
    note: typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : null,
    createdById: actor?.id ?? null,
  });
  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_VERSION_BLOCK,
    entity: entityOf(subscription),
    after: { platform: platform.value, version: clean, note: row.note },
    message: `${subscription.name}, ${platform.name} app version ${clean} blocked — checks from it are refused`,
  });
  return row.toPublicJSON();
}

/** Let a blocked version through again. */
async function unblock(subscriptionId, platformId, blockedId) {
  const { subscription, platform } = await pairOr404(subscriptionId, platformId);
  const row = await SubscriptionVersionBlock.findOne({
    where: { id: blockedId },
    include: [{ model: SubscriptionVersionRule, as: "rule", attributes: [], where: { subscriptionId: subscription.id, platformId: platform.id } }],
  });
  if (!row) throw ApiError.notFound("That version is not blocked for this subscription on this platform");
  await row.destroy();
  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_VERSION_UNBLOCK,
    entity: entityOf(subscription),
    before: { platform: platform.value, version: row.version, note: row.note },
    message: `${subscription.name}, ${platform.name} app version ${row.version} unblocked`,
  });
  return { unblocked: true };
}

module.exports = { MESSAGE, WORDS, gate, refusals, policies, setPolicy, block, unblock };
