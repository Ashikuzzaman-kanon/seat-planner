const asyncHandler = require("../utils/asyncHandler");
const railwayService = require("../services/railwayService");
const railwaySync = require("../services/railwaySyncService");

const status = asyncHandler(async (_req, res) => {
  const [loaded, sync] = await Promise.all([railwayService.status(), railwaySync.status()]);
  res.json({ ...loaded, sync });
});

/** 202 with the job: loading takes a minute or two on a free-tier database. */
const load = asyncHandler(async (req, res) => {
  const { job, started } = await railwayService.start({ actorId: req.user.id });
  res.status(202).json({
    message: started ? "Loading railway data" : `Railway data is already being loaded (job #${job.id})`,
    job: job.toPublicJSON(),
  });
});

/** 202 with the job: asking the railway for every train takes a minute or so. */
const check = asyncHandler(async (req, res) => {
  const { job, started } = await railwaySync.startCheck({ actorId: req.user.id });
  res.status(202).json({
    message: started ? "Checking with the railway" : `Already checking with the railway (job #${job.id})`,
    job: job.toPublicJSON(),
  });
});

const applySync = asyncHandler(async (req, res) => {
  const { job } = await railwaySync.startApply(Number(req.params.id), { actorId: req.user.id });
  res.status(202).json({ message: "Applying the railway's timetable", job: job.toPublicJSON() });
});

module.exports = { status, load, check, applySync };
