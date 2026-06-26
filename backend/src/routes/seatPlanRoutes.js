const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const ctrl = require("../controllers/seatPlanController");
const {
  idRule,
  createPlanRules,
  updatePlanRules,
  rejectRules,
} = require("../validators/seatPlanValidators");
const { PERMISSIONS } = require("../constants/roles");

router.use(authenticate);

// Read — anyone who can view plans (visibility is further scoped in the service).
router.get("/", requirePermission(PERMISSIONS.PLAN_VIEW), ctrl.listPlans);
router.get("/:id", requirePermission(PERMISSIONS.PLAN_VIEW), idRule, validate, ctrl.getPlan);

// Create / update / delete — planners and above.
router.post("/", requirePermission(PERMISSIONS.PLAN_CREATE), createPlanRules, validate, ctrl.createPlan);
router.put("/:id", requirePermission(PERMISSIONS.PLAN_UPDATE), idRule, updatePlanRules, validate, ctrl.updatePlan);
router.delete("/:id", requirePermission(PERMISSIONS.PLAN_DELETE), idRule, validate, ctrl.deletePlan);

// Submit a draft/rejected plan for approval.
router.post("/:id/submit", requirePermission(PERMISSIONS.PLAN_UPDATE), idRule, validate, ctrl.submitPlan);

// Approve / reject — admins and super admins.
router.post("/:id/approve", requirePermission(PERMISSIONS.PLAN_APPROVE), idRule, validate, ctrl.approvePlan);
router.post("/:id/reject", requirePermission(PERMISSIONS.PLAN_APPROVE), idRule, rejectRules, validate, ctrl.rejectPlan);

module.exports = router;
