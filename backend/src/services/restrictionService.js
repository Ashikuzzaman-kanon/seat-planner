const { sequelize, User, Role, Permission, AccountRestriction } = require("../models");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { refusalToRestrict } = require("../utils/restrictionRules");
const { getAccess } = require("./permissionService");
const { revokeAllForUser } = require("./tokenService");
const audit = require("./auditService");

/**
 * Restricted accounts: stopped from using the system at all until someone
 * lifts it.
 *
 * What a restriction does is enforced elsewhere, and everywhere it has to be:
 * sign-in and the subscription check refuse it (authService
 * `checkCredentials`), every request from a session already open is refused
 * (middleware/auth), and a session cannot be renewed (authService `refresh`).
 * Restricting also ends every session the account has, so nothing it already
 * holds outlives the decision.
 *
 * Here: placing and lifting one, one account or several at a time, under the
 * rules of utils/restrictionRules — and the history of both.
 */

const WITH_PEOPLE = [
  { model: User, as: "restrictedBy", attributes: ["id", "fullName"] },
  { model: User, as: "liftedBy", attributes: ["id", "fullName"] },
];
const entityOf = (user) => ({ type: "user", id: user.id, label: user.email });
const clean = (text) => (typeof text === "string" && text.trim() ? text.trim() : null);

/** Every restriction an account has had, newest first. */
async function historyOf(userId) {
  const rows = await AccountRestriction.findAll({
    where: { userId },
    include: WITH_PEOPLE,
    order: [["restrictedAt", "DESC"], ["id", "DESC"]],
  });
  return rows.map((r) => r.toPublicJSON());
}

/** The restriction in force on an account, or null. */
async function currentOf(userId) {
  const row = await AccountRestriction.findOne({
    where: { userId, liftedAt: null },
    include: WITH_PEOPLE,
    order: [["restrictedAt", "DESC"], ["id", "DESC"]],
  });
  return row ? row.toPublicJSON() : null;
}

/** What every new account is given (the default role): never a reason one cannot be restricted. */
async function baselinePermissions() {
  const role = await Role.findOne({
    where: { isDefault: true },
    include: [{ model: Permission, as: "permissions", attributes: ["key"], through: { attributes: [] } }],
  });
  return role ? role.permissions.map((p) => p.key) : [];
}

/** Why `actor` may not restrict, or lift a restriction on, `target` — or null. */
async function refusalFor(actor, actorAccess, target) {
  const [targetAccess, baseline] = await Promise.all([getAccess(target.id), baselinePermissions()]);
  return refusalToRestrict({ actorId: actor.id, actorAccess, targetId: target.id, targetAccess, baseline });
}

/** Throws unless `actor` may restrict, or lift a restriction on, `target`. */
async function assertMayAct(actor, actorAccess, target) {
  const refusal = await refusalFor(actor, actorAccess, target);
  if (refusal) throw ApiError.forbidden(refusal);
}

/**
 * Restrict one account. `reason` is required: it is the first thing anyone
 * asks when they find an account they cannot use.
 */
async function restrict(targetId, { reason }, actor, actorAccess) {
  const why = clean(reason);
  if (!why) throw ApiError.badRequest("Say why the account is being restricted");

  const found = await User.findByPk(targetId);
  if (!found) throw ApiError.notFound("No such account");
  await assertMayAct(actor, actorAccess, found);

  const now = new Date();
  const row = await sequelize.transaction(async (transaction) => {
    // Locked and read again, so two people restricting at once make one row.
    const target = await User.findByPk(found.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (target.restrictedAt) throw ApiError.conflict("This account is already restricted");
    await target.update({ restrictedAt: now }, { transaction });
    return AccountRestriction.create(
      { userId: target.id, reason: why, restrictedById: actor.id, restrictedAt: now },
      { transaction }
    );
  });

  // Every session it has ends now, rather than when its access token runs out.
  await revokeAllForUser(found.id);

  await audit.record({
    action: AUDIT_ACTIONS.ACCOUNT_RESTRICT,
    entity: entityOf(found),
    before: { restricted: false },
    after: { restricted: true, reason: why },
    message: `account restricted — it cannot sign in, and its sessions were ended: ${why}`,
  });
  return currentOf(row.userId);
}

/** Lift the restriction on one account. */
async function lift(targetId, { note }, actor, actorAccess) {
  const found = await User.findByPk(targetId);
  if (!found) throw ApiError.notFound("No such account");
  await assertMayAct(actor, actorAccess, found);

  const said = clean(note);
  const now = new Date();
  const lifted = await sequelize.transaction(async (transaction) => {
    const target = await User.findByPk(found.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!target.restrictedAt) throw ApiError.conflict("This account is not restricted");
    await target.update({ restrictedAt: null }, { transaction });
    const [count] = await AccountRestriction.update(
      { liftedAt: now, liftedById: actor.id, liftNote: said },
      { where: { userId: target.id, liftedAt: null }, transaction }
    );
    return count;
  });

  await audit.record({
    action: AUDIT_ACTIONS.ACCOUNT_UNRESTRICT,
    entity: entityOf(found),
    before: { restricted: true },
    after: { restricted: false, note: said },
    message: `restriction lifted — the account can sign in again${said ? `: ${said}` : ""}`,
  });
  return { lifted: lifted > 0 };
}

/**
 * The same for several accounts at once. Each is decided on its own, so one
 * that may not be touched does not stop the rest; the answer says, for each,
 * whether it was done and if not, why.
 */
async function forEach(userIds, work) {
  const results = [];
  for (const userId of [...new Set(userIds.map(Number))]) {
    try {
      await work(userId);
      results.push({ userId, done: true });
    } catch (err) {
      if (!err.isOperational) throw err;
      results.push({ userId, done: false, error: err.message });
    }
  }
  return { results, done: results.filter((r) => r.done).length };
}

const restrictMany = (userIds, { reason }, actor, actorAccess) =>
  clean(reason)
    ? forEach(userIds, (id) => restrict(id, { reason }, actor, actorAccess))
    : Promise.reject(ApiError.badRequest("Say why the accounts are being restricted"));

const liftMany = (userIds, { note }, actor, actorAccess) => forEach(userIds, (id) => lift(id, { note }, actor, actorAccess));

/** Whether `actor` could restrict or lift on `target` right now — for showing the buttons. */
async function mayAct(actor, actorAccess, target) {
  return !(await refusalFor(actor, actorAccess, target));
}

module.exports = { historyOf, currentOf, restrict, lift, restrictMany, liftMany, mayAct };
