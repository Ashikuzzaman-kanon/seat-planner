const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { verifyAccessToken } = require("../services/tokenService");
const { getAccess } = require("../services/permissionService");
const { setContext } = require("../utils/requestContext");
const { User } = require("../models");

/**
 * Authenticates the request from the `Authorization: Bearer <token>` header and
 * resolves the caller's current access.
 *
 * The token carries identity only. Roles and permissions are resolved here, per
 * request, from the database — so a revoked role stops working almost
 * immediately rather than surviving until the token expires.
 *
 * Attaches:
 *   req.user        the User row
 *   req.access      { isSuperAdmin, roles, permissions }
 *   req.permissions a Set of permission keys, for fast checks
 */
const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw ApiError.unauthorized("Missing or malformed Authorization header");
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw ApiError.unauthorized("Invalid or expired token");
  }

  const user = await User.findByPk(payload.sub);
  if (!user) {
    throw ApiError.unauthorized("User no longer exists");
  }
  if (!user.isVerified) {
    throw ApiError.forbidden("Account is not verified");
  }

  const access = await getAccess(user.id);

  req.user = user;
  req.access = access;
  req.permissions = new Set(access.permissions);

  // Now that the caller is known, the audit log can attribute their actions
  // without every service having to be handed an actor.
  setContext({
    actor: {
      id: user.id,
      email: user.email,
      roles: access.roles.map((r) => r.name),
    },
  });

  next();
});

module.exports = authenticate;
