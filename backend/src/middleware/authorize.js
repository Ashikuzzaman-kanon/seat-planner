const ApiError = require("../utils/ApiError");
const { roleHasPermission, ROLE_RANK } = require("../constants/roles");

/**
 * Guards a route by required permission(s). The user must hold ALL listed
 * permissions. Must run after `authenticate`.
 *
 *   router.post("/", authenticate, requirePermission(PERMISSIONS.PLAN_CREATE), handler)
 */
function requirePermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    const ok = permissions.every((p) => roleHasPermission(req.user.role, p));
    if (!ok) {
      return next(ApiError.forbidden("You do not have permission to perform this action"));
    }
    next();
  };
}

/** Guards a route by minimum role rank (e.g. "admin or higher"). */
function requireMinRole(minRole) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if ((ROLE_RANK[req.user.role] ?? -1) < (ROLE_RANK[minRole] ?? Infinity)) {
      return next(ApiError.forbidden("Insufficient role"));
    }
    next();
  };
}

module.exports = { requirePermission, requireMinRole };
