const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { nameRules, idRule } = require("../validators/referenceValidators");
const { PERMISSIONS } = require("../constants/roles");
const controllers = require("../controllers/referenceController");

// All reference routes require a logged-in user.
router.use(authenticate);

const manage = requirePermission(PERMISSIONS.REFERENCE_MANAGE);

/**
 * Mounts standard list/create/update/delete routes for one reference resource.
 * Reads are open to any authenticated user (planners need them for dropdowns);
 * writes require reference:manage (admins / super admins).
 */
function mountResource(path, ctrl) {
  router.get(`/${path}`, ctrl.list);
  router.post(`/${path}`, manage, nameRules, validate, ctrl.create);
  router.put(`/${path}/:id`, manage, idRule, nameRules, validate, ctrl.update);
  router.delete(`/${path}/:id`, manage, idRule, validate, ctrl.remove);
}

mountResource("train-names", controllers.trainNames);
mountResource("coach-types", controllers.coachTypes);
mountResource("coach-classes", controllers.coachClasses);

module.exports = router;
