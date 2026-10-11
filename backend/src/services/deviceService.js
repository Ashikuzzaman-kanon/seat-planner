const { Op, QueryTypes } = require("sequelize");
const { sequelize, User, SubscriptionPlatform, UserDevice, UserDeviceRefusal, UserSubscription } = require("../models");
const { SUBSCRIPTION_STATUS: STATUS } = require("../models/UserSubscription");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const rules = require("../utils/subscriptionDevices");
const audit = require("./auditService");

const { REASON } = rules;

/**
 * The devices a subscription is used on.
 *
 * Three things live here: the platforms there are (data, made by whoever
 * manages subscriptions), the decision each check makes about the device it
 * came from, and what staff can do to a device afterwards.
 *
 * ## The decision
 *
 * A check names a device and a platform. If the account has seen the device
 * it keeps its place; if not, and a place is free, it takes one; otherwise it
 * is turned away. A subscription is then valid on the device if its place is
 * within what that subscription allows on that platform.
 *
 * ## What the caller learns
 *
 * Nothing but `valid: false`. Every reason a device can be turned away for is
 * written down — in `user_device_refusals`, which staff read on the account's
 * device screen, and in the audit log when there is one — and none of them is
 * returned. Telling a caller "limit reached" or "blocked" is telling it what
 * to change next.
 *
 * ## What is written down
 *
 * Every check, not only the remarkable ones: `noteCheck` puts one entry in the
 * audit log for each check that is answered, whether it came from a device on
 * its first call or its thousandth, and whether the answer was yes or no. A
 * device taking a place is a second entry of its own, because that is a
 * change to the account and not only a question asked of it.
 */

const person = (user) => ({ id: user.id, email: user.email });
const account = (user) => ({ type: "user", id: user.id, label: user.email });
const clean = (text) => (typeof text === "string" && text.trim() ? text.trim() : null);

/**
 * The device a check says it came from, as it goes on record: whatever was
 * sent, cut to fit, or null where nothing was.
 */
const asRecorded = (sent = {}) => ({
  platform: rules.asSent(sent.platform, 40).toLowerCase() || null,
  deviceId: rules.asSent(sent.deviceId, 128) || null,
});

/* ------------------------------------------------------------------ *
 * Platforms
 * ------------------------------------------------------------------ */

/** Every platform, oldest first — the order they are shown and asked for in. */
const allPlatforms = (options = {}) => SubscriptionPlatform.findAll({ order: [["id", "ASC"]], ...options });

/** The ones that can be asked for and checked from. */
const activePlatforms = (options = {}) =>
  SubscriptionPlatform.findAll({ where: { isActive: true }, order: [["id", "ASC"]], ...options });

/** For the pages: staff see the switched-off ones too. */
async function platforms({ staff = false } = {}) {
  const rows = staff ? await allPlatforms() : await activePlatforms();
  return { platforms: rows.map((p) => p.toPublicJSON()), maxDevices: rules.MAX_DEVICES };
}

async function platformOr404(id, options) {
  const platform = await SubscriptionPlatform.findByPk(id, options);
  if (!platform) throw ApiError.notFound("No such platform");
  return platform;
}

const platformEntity = (platform) => ({ type: "subscription_platform", id: platform.id, label: platform.value });

async function createPlatform({ value, name }, actor) {
  const cleanValue = rules.cleanPlatformValue(value);
  if (!cleanValue) {
    throw ApiError.badRequest(
      "A platform value is lowercase letters and digits, with single - _ or . between them, up to 40 characters"
    );
  }
  const title = clean(name);
  if (!title) throw ApiError.badRequest("A platform needs a name");
  if (await SubscriptionPlatform.findOne({ where: { value: cleanValue }, attributes: ["id"] })) {
    throw ApiError.conflict("There is already a platform with that value");
  }

  const platform = await SubscriptionPlatform.create({ value: cleanValue, name: title, createdById: actor?.id ?? null });
  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_PLATFORM_CREATE,
    entity: platformEntity(platform),
    after: platform.toPublicJSON(),
    message: `platform "${platform.value}" created — subscriptions already running allow none of it until someone raises their count`,
  });
  return platform.toPublicJSON();
}

/** Rename, or switch on and off. The value never changes. */
async function updatePlatform(id, { name, isActive }) {
  const platform = await platformOr404(id);
  const before = platform.toPublicJSON();

  if (name !== undefined) {
    const title = clean(name);
    if (!title) throw ApiError.badRequest("A platform needs a name");
    platform.name = title;
  }
  if (isActive !== undefined) platform.isActive = Boolean(isActive);
  await platform.save();

  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_PLATFORM_UPDATE,
    entity: platformEntity(platform),
    before,
    after: platform.toPublicJSON(),
    message:
      before.isActive !== platform.isActive
        ? `platform "${platform.value}" switched ${platform.isActive ? "on" : "off"}`
        : `platform "${platform.value}" renamed`,
  });
  return platform.toPublicJSON();
}

/** Only one nothing depends on can go; otherwise it is switched off. */
async function removePlatform(id) {
  const platform = await platformOr404(id);

  const devices = await UserDevice.count({ where: { platformId: platform.id } });
  // The id is an integer of ours, so it is safe to build the JSON path from it.
  const [{ n: allowed }] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM user_subscriptions WHERE JSON_EXTRACT(device_limits, '$."${Number(platform.id)}"') > 0`,
    { type: QueryTypes.SELECT }
  );
  if (devices || Number(allowed)) {
    throw ApiError.conflict(
      "Subscriptions or devices use this platform, so it cannot be deleted — switch it off instead"
    );
  }

  const before = platform.toPublicJSON();
  await platform.destroy();
  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_PLATFORM_DELETE,
    entity: platformEntity(platform),
    before,
    message: `platform "${platform.value}" deleted`,
  });
  return { deleted: true };
}

/**
 * A subscription's limits as the pages show them: one entry per platform that
 * is offered, or that it still allows something on.
 */
function limitsOut(limits, platformRows) {
  return platformRows
    .map((p) => ({ platformId: p.id, value: p.value, name: p.name, isActive: p.isActive, limit: rules.limitFor(limits, p.id) }))
    .filter((entry) => entry.isActive || entry.limit > 0);
}

/* ------------------------------------------------------------------ *
 * The decision
 * ------------------------------------------------------------------ */

/** Keep at most this many refusal rows per account — the newest. */
const REFUSALS_KEPT = 100;
/** And none older than this. */
const REFUSAL_DAYS = 90;

const REASON_WORDS = Object.freeze({
  [REASON.NO_DEVICE]: "the call carried no device id",
  [REASON.BAD_DEVICE]: "the device id sent is not a usable one",
  [REASON.UNKNOWN_PLATFORM]: "the platform sent does not exist",
  [REASON.PLATFORM_OFF]: "the platform is switched off",
  [REASON.BLOCKED]: "the device is blocked",
  [REASON.LIMIT_REACHED]: "every place on that platform is taken",
  [REASON.BEYOND_LIMIT]: "the device has a place, but beyond what the subscription allows now",
  [REASON.NO_SUBSCRIPTION]: "the account has no subscription running",
});

/**
 * Keep the row staff read on the account's device screen: that this device
 * was turned away, why, and how many times. Never throws: failing to keep it
 * must not turn into a different answer for the caller.
 */
async function keepRefusal(user, sent, reason) {
  const platformValue = rules.asSent(sent.platform, 40).toLowerCase();
  const deviceId = rules.asSent(sent.deviceId, 128);

  try {
    // The time is the database's UTC clock, not a Date passed in: a raw query
    // writes a Date in this machine's own timezone, hours off wherever that is
    // not UTC.
    await sequelize.query(
      `INSERT INTO user_device_refusals (user_id, platform_value, device_id, reason, attempts, last_at, created_at, updated_at)
       VALUES (:userId, :platformValue, :deviceId, :reason, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE attempts = attempts + 1, last_at = VALUES(last_at), updated_at = VALUES(updated_at)`,
      { replacements: { userId: user.id, platformValue, deviceId, reason }, type: QueryTypes.INSERT }
    );

    // Someone sending a new id each time would otherwise grow this without end.
    if ((await UserDeviceRefusal.count({ where: { userId: user.id } })) > REFUSALS_KEPT) {
      const kept = await UserDeviceRefusal.findAll({
        where: { userId: user.id },
        attributes: ["id"],
        order: [["lastAt", "DESC"], ["id", "DESC"]],
        limit: REFUSALS_KEPT,
      });
      await UserDeviceRefusal.destroy({ where: { userId: user.id, id: { [Op.notIn]: kept.map((r) => r.id) } } });
    }
  } catch (err) {
    console.error(`[devices] could not record a refusal for user ${user.id}: ${err.message}`);
  }
}

/**
 * Decide which of an account's running subscriptions the device in this check
 * may use.
 *
 * Returns `{ allowed, reason, detail, added }`: `allowed` is the ids of those
 * subscriptions, empty when it may use none — and then `reason` says why.
 * `added` is true when the device took a place just now, and `detail` is what
 * the numbers were, for the record.
 *
 * `memberships` are the account's valid UserSubscription rows. With none there
 * is nothing to use a device on: that is its own reason, and not a device
 * being turned away, so no refusal row is kept for it.
 */
async function admit(user, sent, memberships, now = new Date()) {
  const verdict = (found = {}) => ({ allowed: new Set(), reason: null, detail: {}, added: false, ...found });
  if (!memberships.length) return verdict({ reason: REASON.NO_SUBSCRIPTION });

  const refuse = async (reason, detail = {}) => {
    await keepRefusal(user, sent, reason);
    return verdict({ reason, detail });
  };

  const device = rules.cleanDeviceId(sent.deviceId);
  if (device.reason) return refuse(device.reason);

  const value = rules.cleanPlatformValue(sent.platform);
  const platform = value ? await SubscriptionPlatform.findOne({ where: { value } }) : null;
  if (!platform) return refuse(REASON.UNKNOWN_PLATFORM);
  if (!platform.isActive) return refuse(REASON.PLATFORM_OFF);

  // A new device may take a place if any running subscription has one to give.
  const most = Math.max(...memberships.map((m) => rules.limitFor(m.deviceLimits, platform.id)));

  const outcome = await sequelize.transaction(async (transaction) => {
    // One check at a time per account: two new devices arriving together must
    // not both take the last place.
    await User.findByPk(user.id, { attributes: ["id"], transaction, lock: transaction.LOCK.UPDATE });

    const devices = await UserDevice.findAll({
      where: { userId: user.id, platformId: platform.id },
      order: [["id", "ASC"]],
      transaction,
    });
    const known = devices.find((d) => d.deviceId.toLowerCase() === device.id.toLowerCase());
    if (known?.isBlocked) return { reason: REASON.BLOCKED };

    if (known) {
      await known.update({ lastSeenAt: now, checks: known.checks + 1 }, { transaction });
      return { place: rules.placeOf(devices, device.id) };
    }

    const taken = devices.filter((d) => !d.isBlocked).length;
    if (taken >= most) return { reason: REASON.LIMIT_REACHED, detail: { devicesOnPlatform: taken, mostAllowed: most } };

    const added = await UserDevice.create(
      { userId: user.id, platformId: platform.id, deviceId: device.id, lastSeenAt: now },
      { transaction }
    );
    return { place: taken + 1, added };
  });

  if (outcome.reason) return refuse(outcome.reason, outcome.detail);

  if (outcome.added) {
    await audit.record({
      action: AUDIT_ACTIONS.SUBSCRIPTION_DEVICE_ADD,
      actor: person(user),
      entity: account(user),
      after: { platform: platform.value, deviceId: device.id, place: outcome.place, mostAllowed: most },
      message: `a new ${platform.name} device took place ${outcome.place} of ${most} on the account`,
    });
  }

  const allowed = memberships.filter((m) => outcome.place <= rules.limitFor(m.deviceLimits, platform.id));
  if (!allowed.length) return refuse(REASON.BEYOND_LIMIT, { place: outcome.place, mostAllowed: most });
  return verdict({
    allowed: new Set(allowed.map((m) => m.subscriptionId)),
    added: Boolean(outcome.added),
    detail: { place: outcome.place, mostAllowed: most },
  });
}

/**
 * Put a check that was answered in the audit log — every one: from a device
 * on its first call or one seen a thousand times, answered yes or no.
 *
 * `verdict` is what `admit` decided and `validCodes` the subscriptions that came
 * back valid. With none, the entry carries the reason — which is the only
 * place a caller's "not valid" is explained.
 */
async function noteCheck(user, sent, verdict, validCodes) {
  const valid = validCodes.length > 0;
  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_CHECK,
    actor: person(user),
    entity: account(user),
    after: {
      ...asRecorded(sent),
      valid: validCodes,
      ...(valid ? {} : { reason: verdict.reason }),
      ...(verdict.added ? { newDevice: true } : {}),
      ...verdict.detail,
    },
    outcome: valid ? "success" : "failure",
    message: valid
      ? `subscription check answered "valid" for ${validCodes.join(", ")}${verdict.added ? " — from a new device, which took a place" : ""}`
      : `subscription check answered "not valid": ${REASON_WORDS[verdict.reason] || verdict.reason}`,
  });
}

/* ------------------------------------------------------------------ *
 * Looking, and what staff can do
 * ------------------------------------------------------------------ */

const WITH_PLATFORM = [{ model: SubscriptionPlatform, as: "platform", attributes: ["id", "value", "name", "isActive"] }];

const deviceOut = (device, { staff }) => {
  const json = device.toPublicJSON();
  return {
    ...json,
    // A note is staff talking to staff.
    note: staff ? json.note : undefined,
    platform: device.platform
      ? { id: device.platform.id, value: device.platform.value, name: device.platform.name }
      : undefined,
  };
};

/**
 * An account's devices, and how many places are used on each platform.
 *
 * The account's owner sees their devices and nothing more. `staff` adds the
 * notes and the refusals with their reasons.
 */
async function devicesOf(userId, { staff = false } = {}) {
  const now = new Date();
  const [devices, platformRows, memberships, refusals] = await Promise.all([
    UserDevice.findAll({ where: { userId }, include: WITH_PLATFORM, order: [["id", "ASC"]] }),
    allPlatforms(),
    UserSubscription.findAll({ where: { userId, status: STATUS.ACTIVE, expiresAt: { [Op.gt]: now } } }),
    staff
      ? UserDeviceRefusal.findAll({ where: { userId }, order: [["lastAt", "DESC"], ["id", "DESC"]], limit: REFUSALS_KEPT })
      : [],
  ]);

  const usage = platformRows
    .map((p) => ({
      platformId: p.id,
      value: p.value,
      name: p.name,
      isActive: p.isActive,
      used: devices.filter((d) => d.platformId === p.id && !d.isBlocked).length,
      // The most any running subscription allows: what a new device is measured against.
      allowed: Math.max(0, ...memberships.map((m) => rules.limitFor(m.deviceLimits, p.id))),
    }))
    .filter((u) => u.isActive || u.used > 0 || u.allowed > 0);

  return {
    devices: devices.map((d) => deviceOut(d, { staff })),
    usage,
    ...(staff ? { refusals: refusals.map((r) => r.toPublicJSON()) } : {}),
  };
}

/** One account's devices, for staff, with who the account is. */
async function devicesOfUser(userId) {
  const user = await User.findByPk(userId, { attributes: ["id", "fullName", "email"] });
  if (!user) throw ApiError.notFound("No such account");
  return { user: { id: user.id, fullName: user.fullName, email: user.email }, ...(await devicesOf(user.id, { staff: true })) };
}

async function deviceOr404(id) {
  const device = await UserDevice.findByPk(id, {
    include: [...WITH_PLATFORM, { model: User, as: "user", attributes: ["id", "fullName", "email"] }],
  });
  if (!device) throw ApiError.notFound("No such device");
  return device;
}

const deviceEntity = (device) => ({
  type: "user_device",
  id: device.id,
  label: `${device.user?.email || `user ${device.userId}`} — ${device.platform?.value || device.platformId} ${device.deviceId}`,
});

/** Change the note, or block and unblock. */
async function updateDevice(id, { note, isBlocked }) {
  const device = await deviceOr404(id);
  const before = { note: device.note, isBlocked: device.isBlocked };

  if (note !== undefined) device.note = clean(note);
  if (isBlocked !== undefined) device.isBlocked = Boolean(isBlocked);
  await device.save();

  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_DEVICE_UPDATE,
    entity: deviceEntity(device),
    before,
    after: { note: device.note, isBlocked: device.isBlocked },
    message:
      before.isBlocked !== device.isBlocked
        ? `device ${device.isBlocked ? "blocked — it is no longer valid and its place is free" : "unblocked — it has its place in the order back"}`
        : "device note changed",
  });
  return deviceOut(device, { staff: true });
}

/**
 * Forget a device. Its place is free at once — and the same device may take
 * one again the next time it checks in, if there is room. To keep one out,
 * block it instead.
 */
async function removeDevice(id) {
  const device = await deviceOr404(id);
  const before = deviceOut(device, { staff: true });
  await device.destroy();

  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_DEVICE_DELETE,
    entity: deviceEntity(device),
    before,
    message: "device removed from the account — its place is free",
  });
  return { deleted: true };
}

/** Drop refusals too old to matter. Called by the hourly sweep. */
async function pruneRefusals(now = new Date()) {
  return UserDeviceRefusal.destroy({
    where: { lastAt: { [Op.lt]: new Date(now.getTime() - REFUSAL_DAYS * 86_400_000) } },
  });
}

module.exports = {
  allPlatforms,
  activePlatforms,
  platforms,
  createPlatform,
  updatePlatform,
  removePlatform,
  limitsOut,
  asRecorded,
  admit,
  noteCheck,
  devicesOf,
  devicesOfUser,
  updateDevice,
  removeDevice,
  pruneRefusals,
  REFUSALS_KEPT,
};
