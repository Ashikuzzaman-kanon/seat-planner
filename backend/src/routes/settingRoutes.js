const express = require("express");
const router = express.Router();
const settingController = require("../controllers/settingController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const { PERMISSIONS } = require("../constants/permissions");

router.use(authenticate);

router.get("/", requirePermission(PERMISSIONS.SETTING_VIEW), settingController.listSettings);

router.put(
  "/:key",
  requirePermission(PERMISSIONS.SETTING_MANAGE),
  settingController.updateSetting
);

module.exports = router;
