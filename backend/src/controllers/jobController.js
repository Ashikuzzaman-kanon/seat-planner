const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const jobService = require("../services/jobService");
const { PERMISSIONS } = require("../constants/permissions");

const list = asyncHandler(async (req, res) => {
  res.json(
    await jobService.list({
      status: req.query.status,
      type: req.query.type,
      page: req.query.page,
      limit: req.query.limit,
    })
  );
});

/**
 * One job.
 *
 * Readable by `job:view`, and also by whoever queued it: the operator who
 * cancelled a departure should be able to watch its refunds finish without
 * being given the whole jobs screen. Anyone else is told it does not exist.
 */
const get = asyncHandler(async (req, res) => {
  const job = await jobService.get(req.params.id);
  const mine = job.createdById && job.createdById === req.user.id;
  if (!mine && !req.permissions.has(PERMISSIONS.JOB_VIEW)) {
    throw ApiError.notFound("Job not found");
  }
  res.json({
    job: {
      ...job.toPublicJSON(),
      createdBy: job.createdBy
        ? { id: job.createdBy.id, name: job.createdBy.fullName, email: job.createdBy.email }
        : null,
    },
  });
});

const retry = asyncHandler(async (req, res) => {
  const job = await jobService.retry(req.params.id);
  res.json({ message: `Job #${job.id} queued to run again`, job: job.toPublicJSON() });
});

module.exports = { list, get, retry };
