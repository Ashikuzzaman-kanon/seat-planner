/**
 * Who may restrict whom, as a pure function.
 *
 * Restricting an account takes it out of the system entirely, so the rules
 * are the escalation guard's (roleService `assertCanGrantPermissions`) turned
 * the other way: nobody may switch off someone who can do more than they can.
 * Without that, anyone holding `user:restrict` could lock out the people who
 * would otherwise undo it.
 *
 *   - Not your own account: nobody locks themselves out by accident.
 *   - Not a super admin's: the install must keep a way in.
 *   - Not an account holding any permission you do not — leaving out the
 *     `baseline`: what every new account is given to buy tickets. Those are
 *     not power over anyone, and an administrator who never signed up as a
 *     passenger must still be able to restrict one. A super admin is exempt,
 *     holding everything.
 *
 * Lifting a restriction follows the same rules, so a decision made by someone
 * with more access cannot be undone by someone with less.
 *
 * `actorAccess` and `targetAccess` are permissionService `getAccess` results;
 * `baseline` the default role's permission keys. Returns the reason it is
 * refused, in words, or null when it is allowed.
 */
function refusalToRestrict({ actorId, actorAccess, targetId, targetAccess, baseline = [] }) {
  if (Number(actorId) === Number(targetId)) return "You cannot restrict or lift a restriction on your own account";
  if (targetAccess.isSuperAdmin) return "A super admin's account cannot be restricted";
  if (actorAccess.isSuperAdmin) return null;
  const held = new Set([...actorAccess.permissions, ...baseline]);
  const beyond = targetAccess.permissions.filter((p) => !held.has(p));
  return beyond.length ? "This account holds permissions you do not, so only someone who holds them too can restrict it" : null;
}

module.exports = { refusalToRestrict };
