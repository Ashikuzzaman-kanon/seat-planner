const ApiError = require("../utils/ApiError");

/**
 * Permission guards. Roles are flat, so there is no "minimum role" check —
 * privilege comes only from the permissions a caller actually holds.
 *
 * Must run after `authenticate`, which populates `req.permissions`.
 *
 *   router.post("/", authenticate, requirePermission(PERMISSIONS.PLAN_CREATE), handler)
 */

function ensureAuthenticated(req) {
  if (!req.user || !req.permissions) throw ApiError.unauthorized();
}

/** Caller must hold every listed permission. */
function requirePermission(...permissions) {
  return (req, _res, next) => {
    try {
      ensureAuthenticated(req);
    } catch (err) {
      return next(err);
    }

    const missing = permissions.filter((p) => !req.permissions.has(p));
    if (missing.length) {
      return next(ApiError.forbidden("You do not have permission to perform this action"));
    }
    next();
  };
}

/** Caller must hold at least one of the listed permissions. */
function requireAnyPermission(...permissions) {
  return (req, _res, next) => {
    try {
      ensureAuthenticated(req);
    } catch (err) {
      return next(err);
    }

    if (!permissions.some((p) => req.permissions.has(p))) {
      return next(ApiError.forbidden("You do not have permission to perform this action"));
    }
    next();
  };
}

/**
 * Only the super admin. For the feature switches: they apply to the super admin
 * too, so a role holding them could hide the super admin's own tabs.
 */
function requireSuperAdmin(message = "Only the super admin can do this") {
  return (req, _res, next) => {
    try {
      ensureAuthenticated(req);
    } catch (err) {
      return next(err);
    }
    if (!req.access?.isSuperAdmin) return next(ApiError.forbidden(message));
    next();
  };
}

module.exports = { requirePermission, requireAnyPermission, requireSuperAdmin };
