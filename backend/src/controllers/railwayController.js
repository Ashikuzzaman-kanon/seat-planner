const asyncHandler = require("../utils/asyncHandler");
const railwayService = require("../services/railwayService");

const status = asyncHandler(async (_req, res) => {
  res.json(await railwayService.status());
});

/** 202 with the job: loading takes a minute or two on a free-tier database. */
const load = asyncHandler(async (req, res) => {
  const { job, started } = await railwayService.start({ actorId: req.user.id });
  res.status(202).json({
    message: started ? "Loading railway data" : `Railway data is already being loaded (job #${job.id})`,
    job: job.toPublicJSON(),
  });
});

module.exports = { status, load };
