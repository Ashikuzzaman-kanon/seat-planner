const asyncHandler = require("../utils/asyncHandler");
const userService = require("../services/userService");
const restrictions = require("../services/restrictionService");

const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
  const result = await userService.listUsers({
    page,
    limit,
    search: req.query.search || "",
    roleId: req.query.roleId ? parseInt(req.query.roleId, 10) : undefined,
    status: req.query.status || undefined,
  });
  res.json(result);
});

/** Anyone signed in may open a profile; what it holds depends on who asks. */
const getProfile = asyncHandler(async (req, res) => {
  res.json({ profile: await userService.profileOf(req.params.id, req.user, req.access) });
});

const restrict = asyncHandler(async (req, res) => {
  res.status(201).json({ restriction: await restrictions.restrict(req.params.id, req.body, req.user, req.access) });
});

const liftRestriction = asyncHandler(async (req, res) => {
  res.json(await restrictions.lift(req.params.id, req.body || {}, req.user, req.access));
});

const restrictMany = asyncHandler(async (req, res) => {
  res.json(await restrictions.restrictMany(req.body.userIds, req.body, req.user, req.access));
});

const liftMany = asyncHandler(async (req, res) => {
  res.json(await restrictions.liftMany(req.body.userIds, req.body, req.user, req.access));
});

const getUser = asyncHandler(async (req, res) => {
  const user = await userService.getUser(req.params.id);
  res.json({ user });
});

const setRoles = asyncHandler(async (req, res) => {
  const user = await userService.setUserRoles({
    actingUser: req.user,
    actingAccess: req.access,
    targetUserId: req.params.id,
    roleIds: req.body.roleIds,
  });
  res.json({ message: "Roles updated", user });
});

module.exports = { listUsers, getUser, setRoles, getProfile, restrict, liftRestriction, restrictMany, liftMany };
