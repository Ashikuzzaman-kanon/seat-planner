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

/*
 * Audit entries for the account flows.
 *
 * These requests carry nobody signed in, so the entry names the account
 * itself as the actor — or, when no account matched, just the address that
 * was typed. Passwords and codes are never written; only what happened, and
 * (from the request context) the IP address and browser it came from.
 */
const who = (user, email) => ({ id: user?.id ?? null, email: user?.email ?? email ?? null });
const account = (user, email) => ({ type: "user", id: user?.id ?? null, label: user?.email ?? email ?? null });

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
      await audit.record({
        action: AUDIT_ACTIONS.AUTH_REGISTER,
        actor: who(existing),
        entity: account(existing),
        after: { fullName: existing.fullName, verified: false },
        message: "registered again before verifying — a new code was sent",
      });
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
  await audit.record({
    action: AUDIT_ACTIONS.AUTH_REGISTER,
    actor: who(user),
    entity: account(user),
    after: { fullName: user.fullName, verified: false },
    message: "account created — waiting for email verification",
  });
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

  await audit.record({
    action: AUDIT_ACTIONS.AUTH_VERIFY_EMAIL,
    actor: who(user),
    entity: account(user),
    after: { verified: true },
    message: "email verified — account active and signed in",
  });

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
  const typed = email.toLowerCase().trim();
  const user = await User.findOne({ where: { email: typed } });

  // The caller is told only "invalid credentials" either way; the log says
  // which, because telling a typo from someone guessing is what it is for.
  const refuse = async (reason, error) => {
    await audit.record({
      action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
      actor: who(user, typed),
      entity: account(user, typed),
      after: { reason },
      outcome: "failure",
      message: `sign-in refused: ${reason}`,
    });
    throw error;
  };

  if (!user) return refuse("no account with that email", ApiError.unauthorized("Invalid credentials"));

  const match = await user.verifyPassword(password);
  if (!match) return refuse("wrong password", ApiError.unauthorized("Invalid credentials"));

  if (!user.isVerified) {
    return refuse("email not verified yet", ApiError.forbidden("Please verify your email before logging in"));
  }

  const session = await buildSession(user, context);
  await audit.record({
    action: AUDIT_ACTIONS.AUTH_LOGIN,
    actor: { ...who(user), roles: session.roles.map((r) => r.name ?? r) },
    entity: account(user),
    message: "signed in",
  });
  return session;
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
  const typed = email.toLowerCase().trim();
  const user = await User.findOne({ where: { email: typed } });
  if (!user) {
    // The caller is told nothing either way (no account enumeration); the log
    // still notes the attempt.
    await audit.record({
      action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET_REQUEST,
      actor: who(null, typed),
      entity: account(null, typed),
      after: { codeSent: false },
      outcome: "failure",
      message: "password reset asked for an address with no account — nothing sent",
    });
    return;
  }

  user.verificationCode = generateOtp();
  user.verificationCodeExpires = otpExpiry();
  await user.save();
  await sendPasswordResetEmail(user.email, user.verificationCode, verificationTtlMinutes());
  await audit.record({
    action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET_REQUEST,
    actor: who(user),
    entity: account(user),
    after: { codeSent: true },
    message: "password reset requested — code emailed",
  });
}

/** Complete password reset using the emailed OTP. */
async function resetPassword({ email, code, newPassword }) {
  const typed = email.toLowerCase().trim();
  const user = await User.findOne({ where: { email: typed } });

  const refuse = async (reason, error) => {
    await audit.record({
      action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET_FAILED,
      actor: who(user, typed),
      entity: account(user, typed),
      after: { reason },
      outcome: "failure",
      message: `password reset refused: ${reason}`,
    });
    throw error;
  };

  if (!user) return refuse("no account with that email", ApiError.badRequest("Invalid reset request"));

  if (!user.verificationCode || user.verificationCode !== code) {
    return refuse("wrong code", ApiError.badRequest("Invalid or expired reset code"));
  }
  if (!user.verificationCodeExpires || new Date() > user.verificationCodeExpires) {
    return refuse("code expired", ApiError.badRequest("Invalid or expired reset code"));
  }

  user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  user.verificationCode = null;
  user.verificationCodeExpires = null;
  // Resetting a password also confirms ownership of the email.
  user.isVerified = true;
  await user.save();

  // Whoever knew the old password no longer has a way in.
  await revokeAllForUser(user.id);

  await audit.record({
    action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET,
    actor: who(user),
    entity: account(user),
    after: { sessionsSignedOut: true },
    message: "password reset — every existing session signed out",
  });
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
