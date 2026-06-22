const { validationResult } = require("express-validator");
const ApiError = require("../utils/ApiError");

/**
 * Runs after a list of express-validator checks. Collects any validation
 * errors into a single 400 response.
 */
function validate(req, _res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const details = result.array().map((e) => ({
    field: e.path,
    message: e.msg,
  }));
  next(ApiError.badRequest("Validation failed", details));
}

module.exports = validate;
