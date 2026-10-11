/**
 * Operational error with an HTTP status code. Thrown anywhere in the request
 * lifecycle and translated to a JSON response by the global error handler.
 */
class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg = "Bad request", details) {
    return new ApiError(400, msg, details);
  }
  static unauthorized(msg = "Unauthorized") {
    return new ApiError(401, msg);
  }
  static forbidden(msg = "Forbidden") {
    return new ApiError(403, msg);
  }
  static notFound(msg = "Not found") {
    return new ApiError(404, msg);
  }
  static conflict(msg = "Conflict") {
    return new ApiError(409, msg);
  }
  /** `retryAfterSeconds` becomes the Retry-After header (see the error handler). */
  static tooManyRequests(msg = "Too many requests", retryAfterSeconds) {
    const error = new ApiError(429, msg);
    if (retryAfterSeconds > 0) error.retryAfterSeconds = Math.ceil(retryAfterSeconds);
    return error;
  }
}

module.exports = ApiError;
