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
const features = require("./featureService");
const { sendVerificationEmail, sendPasswordResetEmail } = require("./emailService");
const settings = require("./settingService");
const audit = require("./auditService");
const inbox = require("./inboxService");
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
    unavailableFeatures: features.unavailableFor(user, access),
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
  if (user.restrictedAt) throw ApiError.forbidden(RESTRICTED);

  user.isVerified = true;
  user.lastSignInAt = new Date();
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

/*
 * A hash nobody's password matches, compared against when no account does —
 * so "no such account" takes as long to answer as "wrong password", and the
 * time an answer takes does not say which it was.
 */
const NOBODYS_HASH = bcrypt.hashSync("no account has this password", SALT_ROUNDS);

/** What a restricted account is told — at sign-in, and by the subscription check. */
const RESTRICTED = "This account is restricted. Contact an administrator.";

/*
 * Password attempts for one address are checked one at a time. Without this, a
 * guesser sending fifty at once would have all fifty compared before the first
 * wrong one was counted, and the pause below would limit nothing. A queue in
 * memory is enough because the API runs as a single process; no database
 * connection is held while an attempt waits its turn.
 */
const attempts = new Map();

function oneAtATime(key, work) {
  const turn = (attempts.get(key) || Promise.resolve()).catch(() => {}).then(work);
  attempts.set(key, turn);
  turn
    .catch(() => {})
    .finally(() => {
      if (attempts.get(key) === turn) attempts.delete(key);
    });
  return turn;
}

/** The 429 for an account whose sign-in is paused. */
function paused(until, now) {
  const seconds = Math.max(1, Math.ceil((until - now) / 1000));
  const minutes = Math.ceil(seconds / 60);
  return ApiError.tooManyRequests(
    `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`,
    seconds
  );
}

/**
 * Count a wrong password, and pause the account when it completes a run of
 * them. Returns when the pause ends, or null if this one did not cause one.
 *
 * A run only counts while the wrong passwords keep coming: four mistakes last
 * week and one today is one, not five.
 */
async function noteWrongPassword(user, now) {
  const limit = settings.get("auth.max_failed_sign_ins");
  const minutes = settings.get("auth.lockout_minutes");
  const stale = !user.lastFailedSignInAt || now - user.lastFailedSignInAt > minutes * 60_000;
  const run = (stale ? 0 : user.failedSignIns) + 1;

  if (run < limit) {
    await user.update({ failedSignIns: run, lastFailedSignInAt: now });
    return null;
  }

  const lockedUntil = new Date(now.getTime() + minutes * 60_000);
  await user.update({ failedSignIns: 0, lastFailedSignInAt: now, lockedUntil });

  await audit.record({
    action: AUDIT_ACTIONS.AUTH_LOCKED,
    actor: who(user),
    entity: account(user),
    after: { wrongPasswords: limit, lockedUntil },
    outcome: "failure",
    message: `sign-in paused for ${minutes} minutes after ${limit} wrong passwords in a row`,
  });
  // Told in the app, where the account's owner — still signed in, if they
  // were — will see it whether or not the guesses were theirs.
  await inbox.tryAdd(user.id, {
    type: "account.sign_in_paused",
    category: inbox.CATEGORY.ACCOUNT,
    tone: "warning",
    title: "Sign-in paused after wrong passwords",
    body:
      `The wrong password was entered ${limit} times in a row, so signing in is paused for ${minutes} ` +
      "minutes. If that was not you, nobody got in — but consider changing your password.",
    link: "/dashboard/profile",
    key: `account:${user.id}:sign-in-paused:${lockedUntil.toISOString()}`,
  });
  return lockedUntil;
}

/**
 * Check an email and password, without signing anyone in. Returns the account.
 *
 * Sign-in and the subscription check API both come through here, so the two
 * cannot differ in what they accept — and a guesser does not get a second,
 * softer door to try.
 *
 * ## The pause
 *
 * After `auth.max_failed_sign_ins` wrong passwords in a row the account takes
 * no password at all for `auth.lockout_minutes` — a correct one included, or
 * the pause would only slow a guesser down. It answers 429 with Retry-After.
 * Resetting the password ends it, and sessions already open are untouched, so
 * the owner of an account someone else is guessing at is not signed out.
 *
 * It is per account rather than per caller address: the site's traffic reaches
 * the API through its hosting proxy, so callers' addresses cannot be told
 * apart, and a limit on that one shared address would let a single person
 * stop everybody signing in.
 *
 * `detail` goes on the record of a refusal beside its reason — the device a
 * subscription check said it came from, so a run of wrong passwords can be
 * traced to where it was tried.
 */
function checkCredentials({ email, password }, { purpose = "sign-in", detail = {} } = {}) {
  const typed = email.toLowerCase().trim();

  return oneAtATime(typed, async () => {
    const user = await User.findOne({ where: { email: typed } });

    // The caller is told only "invalid credentials" either way; the log says
    // which, because telling a typo from someone guessing is what it is for.
    const refuse = async (reason, error) => {
      await audit.record({
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
        actor: who(user, typed),
        entity: account(user, typed),
        after: { reason, ...detail },
        outcome: "failure",
        message: `${purpose} refused: ${reason}`,
      });
      throw error;
    };

    if (!user) {
      await bcrypt.compare(password, NOBODYS_HASH);
      return refuse("no account with that email", ApiError.unauthorized("Invalid credentials"));
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      return refuse("paused after wrong passwords", paused(user.lockedUntil, now));
    }

    if (!(await user.verifyPassword(password))) {
      const lockedUntil = await noteWrongPassword(user, now);
      return refuse(
        "wrong password",
        lockedUntil ? paused(lockedUntil, now) : ApiError.unauthorized("Invalid credentials")
      );
    }

    if (user.failedSignIns || user.lockedUntil) {
      await user.update({ failedSignIns: 0, lastFailedSignInAt: null, lockedUntil: null });
    }

    // Only after the password: whether an account is restricted is told to
    // whoever holds it, not to anyone who types its address.
    if (user.restrictedAt) {
      return refuse("account restricted", ApiError.forbidden(RESTRICTED));
    }

    if (!user.isVerified) {
      return refuse("email not verified yet", ApiError.forbidden("Please verify your email before logging in"));
    }
    return user;
  });
}

/** Authenticate with email + password, opening a session. */
async function login({ email, password }, context) {
  const user = await checkCredentials({ email, password });
  await user.update({ lastSignInAt: new Date() });

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
  if (!user || !user.isVerified || user.restrictedAt) {
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
    unavailableFeatures: features.unavailableFor(user, access),
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
  // And ends any pause wrong passwords had earned: the owner is plainly here.
  user.failedSignIns = 0;
  user.lastFailedSignInAt = null;
  user.lockedUntil = null;
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
  checkCredentials,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
};
