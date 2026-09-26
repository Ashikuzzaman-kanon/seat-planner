const bcrypt = require("bcryptjs");
const { Role, User, UserRole } = require("../models");
const { findPermissionsByKeys } = require("../services/permissionService");
const { sanitizePermissionKeys } = require("../constants/permissions");

/**
 * Shared seeding helpers.
 *
 * These deliberately bypass the escalation guard that governs the API — seeding
 * runs as the system itself, before any administrator exists to be guarded.
 */

/**
 * Create or update a role and set exactly the permissions given.
 * `permissions: null` leaves existing assignments untouched, which is how the
 * super admin role is handled — it holds everything implicitly, so it needs no
 * rows at all.
 */
async function ensureRole(name, { description, isSystem = false, isDefault = false, permissions }) {
  const [role] = await Role.findOrCreate({
    where: { name },
    defaults: { name, description, isSystem, isDefault },
  });

  role.description = description ?? role.description;
  role.isSystem = isSystem;
  role.isDefault = isDefault;
  await role.save();

  if (permissions) {
    const rows = await findPermissionsByKeys(sanitizePermissionKeys(permissions));
    await role.setPermissions(rows);
  }

  return role;
}

/** Ensure exactly one role carries the default flag granted on registration. */
async function setDefaultRole(role) {
  await Role.update({ isDefault: false }, { where: { isDefault: true } });
  role.isDefault = true;
  await role.save();
}

/**
 * Create the user if missing, otherwise refresh its password and verification
 * state, then grant the named roles. Existing role grants are replaced.
 */
async function ensureUser({ fullName, email, password, roles = [] }) {
  const normalizedEmail = email.toLowerCase().trim();
  const passwordHash = await bcrypt.hash(password, 10);

  let user = await User.findOne({ where: { email: normalizedEmail } });
  let created = false;

  if (user) {
    user.fullName = fullName;
    user.passwordHash = passwordHash;
    user.isVerified = true;
    user.verificationCode = null;
    user.verificationCodeExpires = null;
    await user.save();
  } else {
    user = await User.create({
      fullName,
      email: normalizedEmail,
      passwordHash,
      isVerified: true,
    });
    created = true;
  }

  // Replace grants rather than accumulate them, so re-seeding is idempotent.
  await UserRole.destroy({ where: { userId: user.id } });
  const roleRows = await Role.findAll({ where: { name: roles } });
  await UserRole.bulkCreate(roleRows.map((r) => ({ userId: user.id, roleId: r.id })));

  return { user, created };
}

module.exports = { ensureRole, setDefaultRole, ensureUser };
