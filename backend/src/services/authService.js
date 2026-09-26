const bcrypt = require("bcryptjs");
const { User, Role, UserRole } = require("../models");
const ApiError = require("../utils/ApiError");
const env = require("../config/env");
const {
  signAccessToken,
  issueRefreshToken,
  findActiveRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  generateOtp,
} = require("./tokenService");
const { getAccess, invalidateUser } = require("./permissionService");
const { sendVerificationEmail, sendPasswordResetEmail } = require("./emailService");
const settings = require("./settingService");
const audit = require("./auditService");
const { AUDIT_ACTIONS } = require("../constants/auditActions");

const SALT_ROUNDS = 10;

/** Configurable at runtime, so code lifetimes can be tuned without a deploy. */
function verificationTtlMinutes() {
  return settings.get("auth.verification_code_ttl_minutes");
}

function otpExpiry() {
  return new Date(Date.now() + verificationTtlMinutes() * 60 * 1000);
}

/** Grant whichever role is flagged as the default for new registrations. */
async function grantDefaultRole(user) {
  const defaultRole = await Role.findOne({ where: { isDefault: true } });
  if (!defaultRole) {
    console.warn("[auth] No default role is configured — new account has no roles.");
    return;
  }
  await UserRole.findOrCreate({
    where: { userId: user.id, roleId: defaultRole.id },
    defaults: { userId: user.id, roleId: defaultRole.id, grantedById: null },
  });
  invalidateUser(user.id);
}

/**
 * Issue a session: a short-lived access token plus a revocable refresh token,
 * along with the caller's current roles and permissions so the client can gate
 * its UI without a second round trip.
 */
async function buildSession(user, context = {}) {
  const [refreshToken, access] = await Promise.all([
    issueRefreshToken(user, context),
    getAccess(user.id),
  ]);

  return {
    accessToken: signAccessToken(user),
    refreshToken,
    user: user.toPublicJSON(),
    roles: access.roles,
    permissions: access.permissions,
  };
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
        verificationTtlMinutes()
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
    isVerified: false,
    verificationCode: code,
    verificationCodeExpires: otpExpiry(),
  });

  await grantDefaultRole(user);
  await sendVerificationEmail(user.email, code, verificationTtlMinutes());
  return user.toPublicJSON();
}

/** Verify an email with its OTP and open a session. */
async function verifyEmail({ email, code }, context) {
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

  return buildSession(user, context);
}

/** Re-issue a verification code for an unverified account. */
async function resendVerification({ email }) {
  const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
  // Don't reveal whether the account exists / is verified.
  if (!user || user.isVerified) return;

  user.verificationCode = generateOtp();
  user.verificationCodeExpires = otpExpiry();
  await user.save();
  await sendVerificationEmail(user.email, user.verificationCode, verificationTtlMinutes());
}

/** Authenticate with email + password, opening a session. */
async function login({ email, password }, context) {
  const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
  if (!user) throw ApiError.unauthorized("Invalid credentials");

  const match = await user.verifyPassword(password);
  if (!match) throw ApiError.unauthorized("Invalid credentials");

  if (!user.isVerified) {
    throw ApiError.forbidden("Please verify your email before logging in");
  }

  return buildSession(user, context);
}

/**
 * Exchange a refresh token for a new session.
 *
 * The presented token is rotated — revoked and replaced — so a stolen token is
 * usable at most once before the legitimate holder's next refresh kills it.
 */
async function refresh({ refreshToken }, context) {
  const record = await findActiveRefreshToken(refreshToken);
  if (!record) throw ApiError.unauthorized("Invalid or expired session");

  const user = await User.findByPk(record.userId);
  if (!user || !user.isVerified) {
    throw ApiError.unauthorized("Invalid or expired session");
  }

  const nextRefreshToken = await rotateRefreshToken(record, user, context);
  const access = await getAccess(user.id);

  return {
    accessToken: signAccessToken(user),
    refreshToken: nextRefreshToken,
    user: user.toPublicJSON(),
    roles: access.roles,
    permissions: access.permissions,
  };
}

/** End one session. Silent whether or not the token was valid. */
async function logout({ refreshToken }) {
  await revokeRefreshToken(refreshToken);
}

/** Begin password reset: email a reset OTP (silent if account is unknown). */
async function forgotPassword({ email }) {
  const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
  if (!user) return; // Avoid account enumeration.

  user.verificationCode = generateOtp();
  user.verificationCodeExpires = otpExpiry();
  await user.save();
  await sendPasswordResetEmail(user.email, user.verificationCode, verificationTtlMinutes());
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

  // Whoever knew the old password no longer has a way in.
  await revokeAllForUser(user.id);
}

/**
 * The account holder's own travel details.
 *
 * Kept on the account rather than only on tickets so the common case — booking
 * for yourself — becomes confirming rather than re-typing. A mistyped National
 * ID is otherwise discovered by a ticket checker on a platform, which is the
 * worst possible moment.
 *
 * The same validation the booking form applies, because these details end up on
 * a ticket and have to survive the same scrutiny there.
 */
const NID_PATTERN = /^\d{10,17}$/;
const DOB_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function getProfile(userId) {
  const user = await User.findByPk(userId);
  if (!user) throw ApiError.notFound("Account not found");
  return user.toPublicJSON();
}

async function updateProfile(userId, { fullName, nid, dateOfBirth }) {
  const user = await User.findByPk(userId);
  if (!user) throw ApiError.notFound("Account not found");

  const name = String(fullName ?? user.fullName ?? "").trim();
  const id = String(nid ?? user.nid ?? "").trim();
  const dob = String(dateOfBirth ?? user.dateOfBirth ?? "").trim();

  if (name.length < 2) throw ApiError.badRequest("Enter your full name");
  if (!NID_PATTERN.test(id)) throw ApiError.badRequest("National ID must be 10 to 17 digits");
  if (!DOB_PATTERN.test(dob)) throw ApiError.badRequest("Date of birth must look like YYYY-MM-DD");
  if (new Date(dob) > new Date()) throw ApiError.badRequest("That date of birth is in the future");

  const before = { fullName: user.fullName, nid: user.nid, dateOfBirth: user.dateOfBirth };
  await user.update({ fullName: name, nid: id, dateOfBirth: dob });

  await audit.record({
    action: AUDIT_ACTIONS.PROFILE_UPDATE,
    entity: { type: "user", id: user.id, label: user.email },
    before,
    // The National ID is the point of the record, but writing it into the audit
    // log in full would scatter copies of it. The last four identify the change
    // without reproducing the number.
    after: { fullName: name, nid: `…${id.slice(-4)}`, dateOfBirth: dob },
    message: before.nid ? "travel details updated" : "travel details completed",
  });

  return user.toPublicJSON();
}

module.exports = {
  getProfile,
  updateProfile,
  register,
  verifyEmail,
  resendVerification,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
};
