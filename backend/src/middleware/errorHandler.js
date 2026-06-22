const env = require("../config/env");
const ApiError = require("../utils/ApiError");

// 404 for unmatched routes.
function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// Centralized error -> JSON translator.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  // Sequelize unique constraint -> 409
  if (err.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({
      error: { message: "A record with that value already exists" },
    });
  }
  if (err.name === "SequelizeValidationError") {
    return res.status(400).json({
      error: {
        message: "Validation failed",
        details: err.errors.map((e) => ({ field: e.path, message: e.message })),
      },
    });
  }

  const statusCode = err.statusCode || 500;
  const payload = { error: { message: err.message || "Internal server error" } };
  if (err.details) payload.error.details = err.details;
  if (!env.isProduction && statusCode === 500) payload.error.stack = err.stack;

  if (statusCode >= 500) console.error(err);

  res.status(statusCode).json(payload);
}

module.exports = { notFound, errorHandler };
