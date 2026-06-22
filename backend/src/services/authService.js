const bcrypt = require("bcryptjs");
const { User } = require("../models");
const ApiError = require("../utils/ApiError");
const env = require("../config/env");
const { ROLES } = require("../constants/roles");
const {
  signAccessToken,
  generateOtp,
} = require("./tokenService");
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
} = require("./emailService");

const SALT_ROUNDS = 10;

function otpExpiry() {
  return new Date(Date.now() + env.verification.ttlMinutes * 60 * 1000);
}

/** Register a new (unverified) account and email a verification code. */
async function register({ fullName, email, password }) {
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await User.findOne({ where: { email: normalizedEmail } });
  if (existing) {
    // Re-registering an unverified account just refreshes the code.
    if (!existing.isVerified) {
      existing.fullName = fullName;
      existing.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      existing.verificationCode = generateOtp();
      existing.verificationCodeExpires = otpExpiry();
      await existing.save();
      await sendVerificationEmail(
        existing.email,
        existing.verificationCode,
        env.verification.ttlMinutes
      );
      return existing.toPublicJSON();
    }
    throw ApiError.conflict("Email is already registered");
  }

  const code = generateOtp();
  const user = await User.create({
    fullName,
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
    role: ROLES.USER,
    isVerified: false,
    verificationCode: code,
    verificationCodeExpires: otpExpiry(),
  });

  await sendVerificationEmail(user.email, code, env.verification.ttlMinutes);
  return user.toPublicJSON();
}

/** Verify an email with its OTP and issue an access token. */
async function verifyEmail({ email, code }) {
  const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
  if (!user) throw ApiError.badRequest("Invalid verification request");
  if (user.isVerified) throw ApiError.badRequest("Account is already verified");

  if (
    !user.verificationCode ||
    user.verificationCode !== code ||
    !user.verificationCodeExpires ||
    new Date() > user.verificationCodeExpires
  ) {
    throw ApiError.badRequest("Invalid or expired verification code");
  }

  user.isVerified = true;
  user.verificationCode = null;
  user.verificationCodeExpires = null;
  await user.save();

  return { token: signAccessToken(user), user: user.toPublicJSON() };
}

/** Re-issue a verification code for an unverified account. */
async function resendVerification({ email }) {
  const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
  // Don't reveal whether the account exists / is verified.
  if (!user || user.isVerified) return;

  user.verificationCode = generateOtp();
  user.verificationCodeExpires = otpExpiry();
  await user.save();
  await sendVerificationEmail(
    user.email,
    user.verificationCode,
    env.verification.ttlMinutes
  );
}

/** Authenticate with email + password, returning a token. */
async function login({ email, password }) {
  const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
  if (!user) throw ApiError.unauthorized("Invalid credentials");

  const match = await user.verifyPassword(password);
  if (!match) throw ApiError.unauthorized("Invalid credentials");

  if (!user.isVerified) {
    throw ApiError.forbidden("Please verify your email before logging in");
  }

  return { token: signAccessToken(user), user: user.toPublicJSON() };
}

/** Begin password reset: email a reset OTP (silent if account is unknown). */
async function forgotPassword({ email }) {
  const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
  if (!user) return; // Avoid account enumeration.

  user.verificationCode = generateOtp();
  user.verificationCodeExpires = otpExpiry();
  await user.save();
  await sendPasswordResetEmail(
    user.email,
    user.verificationCode,
    env.verification.ttlMinutes
  );
}

/** Complete password reset using the emailed OTP. */
async function resetPassword({ email, code, newPassword }) {
  const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
  if (!user) throw ApiError.badRequest("Invalid reset request");

  if (
    !user.verificationCode ||
    user.verificationCode !== code ||
    !user.verificationCodeExpires ||
    new Date() > user.verificationCodeExpires
  ) {
    throw ApiError.badRequest("Invalid or expired reset code");
  }

  user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  user.verificationCode = null;
  user.verificationCodeExpires = null;
  // Resetting a password also confirms ownership of the email.
  user.isVerified = true;
  await user.save();
}

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  login,
  forgotPassword,
  resetPassword,
};
