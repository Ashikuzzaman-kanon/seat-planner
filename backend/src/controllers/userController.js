const asyncHandler = require("../utils/asyncHandler");
const userService = require("../services/userService");

const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
  const result = await userService.listUsers({
    page,
    limit,
    search: req.query.search || "",
    roleId: req.query.roleId ? parseInt(req.query.roleId, 10) : undefined,
  });
  res.json(result);
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

module.exports = { listUsers, getUser, setRoles };
