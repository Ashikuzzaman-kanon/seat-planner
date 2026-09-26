const asyncHandler = require("../utils/asyncHandler");
const settingService = require("../services/settingService");

const listSettings = asyncHandler(async (_req, res) => {
  res.json({ settings: await settingService.list() });
});

const updateSetting = asyncHandler(async (req, res) => {
  const setting = await settingService.set({
    key: req.params.key,
    value: req.body.value,
    actingUser: req.user,
  });
  res.json({ message: "Setting updated", setting });
});

module.exports = { listSettings, updateSetting };
