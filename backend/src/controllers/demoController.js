const asyncHandler = require("../utils/asyncHandler");
const demoService = require("../services/demoService");

const status = asyncHandler(async (_req, res) => {
  res.json(await demoService.status());
});

/**
 * Both answer 202 with the job: populating takes a while on a free-tier
 * database, and the screen follows the job rather than holding a request open.
 */
const populate = asyncHandler(async (req, res) => {
  const { job, started } = await demoService.start("populate", { actorId: req.user.id });
  res.status(202).json({
    message: started ? "Populating demo data" : `Demo data is already being populated (job #${job.id})`,
    job: job.toPublicJSON(),
  });
});

const clear = asyncHandler(async (req, res) => {
  const { job, started } = await demoService.start("clear", { actorId: req.user.id });
  res.status(202).json({
    message: started ? "Deleting demo data" : `Demo data is already being deleted (job #${job.id})`,
    job: job.toPublicJSON(),
  });
});

module.exports = { status, populate, clear };
