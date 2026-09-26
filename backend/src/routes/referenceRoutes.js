const express = require("express");
const { body } = require("express-validator");
const router = express.Router();
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { nameRules, idRule } = require("../validators/referenceValidators");
const { PERMISSIONS } = require("../constants/permissions");
const controllers = require("../controllers/referenceController");

// All reference routes require a logged-in user.
router.use(authenticate);

const manage = requirePermission(PERMISSIONS.REFERENCE_MANAGE);

/**
 * Mounts standard list/create/update/delete routes for one reference resource.
 * Reads are open to any authenticated user (planners need them for dropdowns);
 * writes require reference:manage (admins / super admins).
 */
function mountResource(path, ctrl, extraRules = []) {
  router.get(`/${path}`, ctrl.list);
  router.post(`/${path}`, manage, [...nameRules, ...extraRules], validate, ctrl.create);
  router.put(`/${path}/:id`, manage, [idRule, ...nameRules, ...extraRules].flat(), validate, ctrl.update);
  router.delete(`/${path}/:id`, manage, idRule, validate, ctrl.remove);
}

/**
 * Trains outgrew this table. They now carry codes, routes, composition and
 * schedules, all managed under /trains — and deleting one there is guarded
 * against destroying those, which a plain reference delete was not.
 *
 * The list survives read-only because the seat-plan editor needs it as a
 * dropdown, and planners hold no `network:view`. Writing a train through this
 * path is gone.
 */
router.get("/train-names", controllers.trainNames.list);

mountResource("coach-types", controllers.coachTypes);
/*
 * Standing capacity lives on the class because that is what decides it: a
 * Shovon coach has floor space and an AC cabin does not. Zero means the class
 * sells no standing at all, which is the default for every class.
 */
mountResource("coach-classes", controllers.coachClasses, [
  body("standingCapacity")
    .optional()
    .isInt({ min: 0, max: 200 })
    .withMessage("Standing capacity must be between 0 and 200"),
]);

module.exports = router;
