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
    create: asyncHandler(async (req, res) => {
      const item = await service.create({ name: req.body.name });
      res.status(201).json({ message: `${label} created`, item });
    }),
    update: asyncHandler(async (req, res) => {
      const item = await service.update(req.params.id, { name: req.body.name });
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
  coachClasses: makeReferenceController(
    makeReferenceService(CoachClass, "Coach class", "coachClassId"),
    "Coach class"
  ),
};
