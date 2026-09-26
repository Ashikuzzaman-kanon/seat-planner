const asyncHandler = require("../utils/asyncHandler");
const makeReferenceService = require("../services/referenceService");
const { TrainName, CoachType, CoachClass } = require("../models");

/** Wraps a reference service into Express handlers. */
function makeReferenceController(service, label) {
  return {
    list: asyncHandler(async (req, res) => {
      const items = await service.list({ search: req.query.search || "" });
      res.json({ items });
    }),
    /*
     * The whole body is handed to the service, which picks out the fields that
     * resource actually declares. Rebuilding it as `{ name }` here quietly
     * dropped every other field — which is exactly what happened to a coach
     * class's standing capacity the first time one was saved.
     */
    create: asyncHandler(async (req, res) => {
      const item = await service.create(req.body);
      res.status(201).json({ message: `${label} created`, item });
    }),
    update: asyncHandler(async (req, res) => {
      const item = await service.update(req.params.id, req.body);
      res.json({ message: `${label} updated`, item });
    }),
    remove: asyncHandler(async (req, res) => {
      await service.remove(req.params.id);
      res.json({ message: `${label} deleted` });
    }),
  };
}

module.exports = {
  trainNames: makeReferenceController(
    makeReferenceService(TrainName, "Train name", "trainNameId"),
    "Train name"
  ),
  coachTypes: makeReferenceController(
    makeReferenceService(CoachType, "Coach type", "coachTypeId"),
    "Coach type"
  ),
  // A coach class is no longer only a name: it decides how many passengers may
  // stand in a coach of that class (§10), which is the primary control over
  // whether connecting standing is sold at all.
  coachClasses: makeReferenceController(
    makeReferenceService(CoachClass, "Coach class", "coachClassId", ["standingCapacity"]),
    "Coach class"
  ),
};
