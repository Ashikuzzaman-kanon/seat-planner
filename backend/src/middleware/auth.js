const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { verifyAccessToken } = require("../services/tokenService");
const { User } = require("../models");

/**
 * Authenticates the request from the `Authorization: Bearer <token>` header,
 * loads the user, and attaches it to `req.user`. Rejects unknown/unverified
 * tokens.
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
  } catch (err) {
    throw ApiError.unauthorized("Invalid or expired token");
  }

  const user = await User.findByPk(payload.sub);
  if (!user) {
    throw ApiError.unauthorized("User no longer exists");
  }
  if (!user.isVerified) {
    throw ApiError.forbidden("Account is not verified");
  }

  req.user = user;
  next();
});

module.exports = authenticate;
