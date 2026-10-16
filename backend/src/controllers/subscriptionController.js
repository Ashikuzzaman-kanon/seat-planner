const asyncHandler = require("../utils/asyncHandler");
const { PERMISSIONS } = require("../constants/permissions");
const subscriptions = require("../services/subscriptionService");
const devices = require("../services/deviceService");
const auth = require("../services/authService");
const versions = require("../services/appVersionService");
const feed = require("../services/seatPlanFeedService");
const { AUDIT_ACTIONS } = require("../constants/auditActions");

const can = (req, permission) => req.permissions.has(permission);
const reviewer = (req) => can(req, PERMISSIONS.SUBSCRIPTION_APPROVE);
/** Whoever manages or approves sees every subscription, with its numbers. */
const staff = (req) => reviewer(req) || can(req, PERMISSIONS.SUBSCRIPTION_MANAGE);
const actor = (req) => ({ id: req.user.id, fullName: req.user.fullName, email: req.user.email });

/**
 * Whether an email and password hold valid subscriptions on the device the
 * call came from — for a caller outside the app, which has no session and
 * wants none.
 *
 * The answer names the account and says yes or no for every subscription
 * there is; no dates, and no reason for a no — except a subscription that
 * turns the app's version away, which says so on its entry. The password is
 * checked exactly as sign-in checks it, the pause after wrong ones included
 * (authService `checkCredentials`). `deviceId` and `platform` are
 * deliberately not validated here: a missing or malformed one is not a 400
 * that explains itself, it is `valid: false` like any other device that is
 * not let in.
 *
 * Every call leaves an entry in the audit log, with the device it said it
 * came from: `auth.login_failed` when the password was not taken, and
 * `subscription.check` with what was answered when it was.
 */
const check = asyncHandler(async (req, res) => {
  const sent = { deviceId: req.body.deviceId, platform: req.body.platform, version: req.body.version };
  // Before the password: a version that is not one at all is the calling
  // app's mistake, refused for the whole call (appVersionService `gate`).
  // Each subscription's own rules come later, with its answer.
  sent.version = await versions.gate(sent, { email: req.body.email });
  const user = await auth.checkCredentials(req.body, {
    purpose: "subscription check",
    detail: devices.asRecorded(sent),
  });
  res.set("Cache-Control", "no-store");
  res.json({
    user: { name: user.fullName, email: user.email },
    subscriptions: await subscriptions.validityFor(user, sent),
  });
});

// Whoever sets version rules picks from every subscription too, closed ones included.
/**
 * A train's seat plans — all of them, one class (`class`), or one coach
 * (`coach`) — for an app signed in as a subscriber whose subscription
 * includes seat plans. The same sign-in, device and version rules as `check`
 * (seatPlanFeedService).
 */
const seatPlans = asyncHandler(async (req, res) => {
  const sent = { deviceId: req.body.deviceId, platform: req.body.platform, version: req.body.version };
  sent.version = await versions.gate(sent, { email: req.body.email, action: AUDIT_ACTIONS.SUBSCRIPTION_SEAT_PLANS });
  const user = await auth.checkCredentials(req.body, { purpose: "seat plans", detail: devices.asRecorded(sent) });
  const answer = await feed.forSubscriber(user, sent, { train: req.body.train, className: req.body.class, coach: req.body.coach });
  res.set("Cache-Control", "no-store");
  res.json(answer);
});

const list = asyncHandler(async (req, res) => {
  res.json(await subscriptions.list(req.user.id, { staff: staff(req) || can(req, PERMISSIONS.SUBSCRIPTION_VERSIONS) }));
});

const mine = asyncHandler(async (req, res) => {
  res.json(await subscriptions.mine(req.user.id));
});

const create = asyncHandler(async (req, res) => {
  res.status(201).json({ subscription: await subscriptions.create(req.body, actor(req)) });
});

const update = asyncHandler(async (req, res) => {
  res.json({ subscription: await subscriptions.update(req.params.id, req.body, actor(req)) });
});

const remove = asyncHandler(async (req, res) => {
  res.json(await subscriptions.remove(req.params.id));
});

const request = asyncHandler(async (req, res) => {
  res.status(201).json({ subscription: await subscriptions.request(req.params.id, req.user, req.body?.devices) });
});

const members = asyncHandler(async (req, res) => {
  res.json(
    await subscriptions.members({
      status: req.query.status,
      subscriptionId: req.query.subscriptionId,
      search: req.query.search,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 25,
    })
  );
});

const pendingCount = asyncHandler(async (_req, res) => {
  res.json(await subscriptions.pendingCount());
});

const approve = asyncHandler(async (req, res) => {
  res.json({ subscription: await subscriptions.approve(req.params.id, req.body, actor(req)) });
});

const decline = asyncHandler(async (req, res) => {
  res.json({ subscription: await subscriptions.decline(req.params.id, req.body, actor(req)) });
});

const cancel = asyncHandler(async (req, res) => {
  res.json({
    subscription: await subscriptions.cancel(req.params.id, req.body, actor(req), { staff: reviewer(req) }),
  });
});

const amend = asyncHandler(async (req, res) => {
  res.json({ subscription: await subscriptions.amend(req.params.id, req.body, actor(req)) });
});

/* ---------------- Platforms ---------------- */

const platforms = asyncHandler(async (req, res) => {
  res.json(await devices.platforms({ staff: staff(req) }));
});

const createPlatform = asyncHandler(async (req, res) => {
  res.status(201).json({ platform: await devices.createPlatform(req.body, actor(req)) });
});

const updatePlatform = asyncHandler(async (req, res) => {
  res.json({ platform: await devices.updatePlatform(req.params.id, req.body) });
});

const removePlatform = asyncHandler(async (req, res) => {
  res.json(await devices.removePlatform(req.params.id));
});

/* ---------------- Devices ---------------- */

/** The caller's own devices: to look at, not to change. */
const myDevices = asyncHandler(async (req, res) => {
  res.json(await devices.devicesOf(req.user.id));
});

const userDevices = asyncHandler(async (req, res) => {
  res.json(await devices.devicesOfUser(req.params.userId));
});

const updateDevice = asyncHandler(async (req, res) => {
  res.json({ device: await devices.updateDevice(req.params.id, req.body) });
});

const removeDevice = asyncHandler(async (req, res) => {
  res.json(await devices.removeDevice(req.params.id));
});

/* ---------------- App versions ---------------- */

const versionPolicies = asyncHandler(async (req, res) => {
  res.json(await versions.policies(req.params.id));
});

const setVersionPolicy = asyncHandler(async (req, res) => {
  res.json({ policy: await versions.setPolicy(req.params.id, req.params.platformId, req.body) });
});

const blockVersion = asyncHandler(async (req, res) => {
  res.status(201).json({ blocked: await versions.block(req.params.id, req.params.platformId, req.body, actor(req)) });
});

const unblockVersion = asyncHandler(async (req, res) => {
  res.json(await versions.unblock(req.params.id, req.params.platformId, req.params.blockedId));
});

module.exports = {
  check,
  seatPlans,
  list,
  mine,
  create,
  update,
  remove,
  request,
  members,
  pendingCount,
  approve,
  decline,
  cancel,
  amend,
  platforms,
  createPlatform,
  updatePlatform,
  removePlatform,
  myDevices,
  userDevices,
  updateDevice,
  removeDevice,
  versionPolicies,
  setVersionPolicy,
  blockVersion,
  unblockVersion,
};
