const asyncHandler = require("../utils/asyncHandler");
const featureService = require("../services/featureService");

const list = asyncHandler(async (_req, res) => {
  res.json(await featureService.list());
});

const people = asyncHandler(async (req, res) => {
  res.json({ people: await featureService.people(req.query.search) });
});

const set = asyncHandler(async (req, res) => {
  const feature = await featureService.set(req.params.key, req.body, req.user);
  res.json({ message: `${feature.label} is ${feature.state === "on" ? "on" : "switched off"}`, feature });
});

module.exports = { list, people, set };
