const asyncHandler = require("../utils/asyncHandler");
const { PERMISSIONS } = require("../constants/permissions");
const subscriptions = require("../services/subscriptionService");
const auth = require("../services/authService");

const can = (req, permission) => req.permissions.has(permission);
const reviewer = (req) => can(req, PERMISSIONS.SUBSCRIPTION_APPROVE);
/** Whoever manages or approves sees every subscription, with its numbers. */
const staff = (req) => reviewer(req) || can(req, PERMISSIONS.SUBSCRIPTION_MANAGE);
const actor = (req) => ({ id: req.user.id, fullName: req.user.fullName, email: req.user.email });

/**
 * Whether an email and password hold valid subscriptions — for a caller
 * outside the app, which has no session and wants none.
 *
 * The answer names the account and says yes or no for every subscription
 * there is; no dates. The password is checked exactly as sign-in checks it,
 * the pause after wrong ones included (authService `checkCredentials`).
 */
const check = asyncHandler(async (req, res) => {
  const user = await auth.checkCredentials(req.body, { purpose: "subscription check" });
  res.set("Cache-Control", "no-store");
  res.json({
    user: { name: user.fullName, email: user.email },
    subscriptions: await subscriptions.validityFor(user.id),
  });
});

const list = asyncHandler(async (req, res) => {
  res.json(await subscriptions.list(req.user.id, { staff: staff(req) }));
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
  res.status(201).json({ subscription: await subscriptions.request(req.params.id, req.user) });
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

const extend = asyncHandler(async (req, res) => {
  res.json({ subscription: await subscriptions.extend(req.params.id, req.body, actor(req)) });
});

module.exports = {
  check,
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
  extend,
};
