const jwt = require("jsonwebtoken");
const env = require("../config/env");

/** Sign a short-lived access token carrying the user's id and role. */
function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.jwt.secret, {
    expiresIn: env.jwt.expiresIn,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.secret);
}

/** Generate a 6-digit numeric OTP for email verification / password reset. */
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = { signAccessToken, verifyAccessToken, generateOtp };
