const express = require("express");
const router = express.Router();
const auditController = require("../controllers/auditController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const { PERMISSIONS } = require("../constants/permissions");

router.use(authenticate);

router.get("/", requirePermission(PERMISSIONS.AUDIT_VIEW), auditController.listEvents);

module.exports = router;
