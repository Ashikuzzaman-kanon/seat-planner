const asyncHandler = require("../utils/asyncHandler");
const userService = require("../services/userService");

const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
  const result = await userService.listUsers({
    page,
    limit,
    search: req.query.search || "",
    role: req.query.role,
  });
  res.json(result);
});

const getUser = asyncHandler(async (req, res) => {
  const user = await userService.getUser(req.params.id);
  res.json({ user });
});

const changeRole = asyncHandler(async (req, res) => {
  const user = await userService.changeRole({
    actingUser: req.user,
    targetUserId: req.params.id,
    newRole: req.body.role,
  });
  res.json({ message: "Role updated", user });
});

module.exports = { listUsers, getUser, changeRole };
