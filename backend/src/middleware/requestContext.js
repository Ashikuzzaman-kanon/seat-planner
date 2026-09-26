const { runWithContext, getContext } = require("../utils/requestContext");

/**
 * Opens a context for the lifetime of the request. Must be registered before
 * the routes, so everything downstream — including the audit log — can see who
 * is acting and which request they are part of.
 */
function requestContextMiddleware(req, res, next) {
  runWithContext(
    {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
      method: req.method,
      path: req.originalUrl,
    },
    () => {
      // Expose the id so a client can quote it when reporting a problem.
      res.setHeader("X-Request-Id", getContext().requestId);
      next();
    }
  );
}

module.exports = requestContextMiddleware;
