const express = require("express");
const router = express.Router();
const auditController = require("../controllers/auditController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const { PERMISSIONS } = require("../constants/permissions");

router.use(authenticate);

const canView = requirePermission(PERMISSIONS.AUDIT_VIEW);
router.get("/", canView, auditController.listEvents);
// The same events analysed — checked field by field in the service.
router.get("/analysis", canView, auditController.analyse);
router.get("/analysis.csv", canView, auditController.analysisSheet);
router.get("/people", canView, auditController.people);

module.exports = router;
