const { Role, Permission } = require("../models");
const ApiError = require("../utils/ApiError");
const { sanitizePermissionKeys, isValidPermission } = require("../constants/permissions");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { findPermissionsByKeys, invalidateAll } = require("./permissionService");
const audit = require("./auditService");

const ROLE_INCLUDE = [
  { model: Permission, as: "permissions", through: { attributes: [] } },
];

/* ------------------------------------------------------------------ *
 * The escalation guard
 * ------------------------------------------------------------------ */

/**
 * Roles are flat, so delegation is the only thing standing between a
 * role-manager and total control. The rule: **you cannot grant a permission you
 * do not hold yourself**. Without it, `role:create` would be a one-step path to
 * super admin — create a role with every permission, assign it, done.
 *
 * Super admin is exempt, holding everything by definition.
 */
function assertCanGrantPermissions(actingAccess, permissionKeys) {
  if (actingAccess.isSuperAdmin) return;

  const held = new Set(actingAccess.permissions);
  const excess = permissionKeys.filter((key) => !held.has(key));

  if (excess.length) {
    throw ApiError.forbidden(
      `You cannot grant permissions you do not hold yourself: ${excess.join(", ")}`
    );
  }
}

/**
 * Editing or deleting a role is as powerful as creating one, so the same rule
 * applies to what the role *already* holds — otherwise a weaker administrator
 * could reshape a stronger role, or delete it out from under everyone using it.
 */
function assertCanManageRole(actingAccess, role) {
  if (actingAccess.isSuperAdmin) return;

  if (role.isSystem) {
    throw ApiError.forbidden("System roles can only be managed by a super admin");
  }

  assertCanGrantPermissions(
    actingAccess,
    (role.permissions || []).map((p) => p.key)
  );
}

/** Whether a caller is allowed to grant or revoke a whole role. */
function assertCanAssignRole(actingAccess, role) {
  if (actingAccess.isSuperAdmin) return;

  if (role.isSuperAdmin) {
    throw ApiError.forbidden("Only a super admin can grant or revoke the super admin role");
  }

  assertCanGrantPermissions(
    actingAccess,
    (role.permissions || []).map((p) => p.key)
  );
}

/* ------------------------------------------------------------------ *
 * CRUD
 * ------------------------------------------------------------------ */

async function listRoles() {
  const roles = await Role.findAll({ include: ROLE_INCLUDE, order: [["name", "ASC"]] });
  return roles.map((r) => r.toPublicJSON());
}

async function findRoleOr404(id) {
  const role = await Role.findByPk(id, { include: ROLE_INCLUDE });
  if (!role) throw ApiError.notFound("Role not found");
  return role;
}

async function getRole(id) {
  const role = await findRoleOr404(id);
  return role.toPublicJSON();
}

function validateKeys(permissionKeys = []) {
  const unknown = permissionKeys.filter((k) => !isValidPermission(k));
  if (unknown.length) {
    throw ApiError.badRequest(`Unknown permission(s): ${unknown.join(", ")}`);
  }
  return sanitizePermissionKeys(permissionKeys);
}

async function createRole({ actingAccess, name, description, permissions = [] }) {
  const keys = validateKeys(permissions);
  assertCanGrantPermissions(actingAccess, keys);

  const trimmed = name.trim();
  if (await Role.findOne({ where: { name: trimmed } })) {
    throw ApiError.conflict(`A role named "${trimmed}" already exists`);
  }

  const role = await Role.create({ name: trimmed, description: description || null });
  await role.setPermissions(await findPermissionsByKeys(keys));

  const created = await getRole(role.id);
  await audit.record({
    action: AUDIT_ACTIONS.ROLE_CREATE,
    entity: { type: "role", id: role.id, label: created.name },
    after: created,
  });

  return created;
}

async function updateRole({ actingAccess, id, name, description, permissions }) {
  const role = await findRoleOr404(id);

  if (role.isSystem) {
    throw ApiError.forbidden("System roles cannot be modified");
  }
  // Checked against what the role holds *now*, before any change.
  assertCanManageRole(actingAccess, role);
  const before = role.toPublicJSON();

  if (name !== undefined) {
    const trimmed = name.trim();
    const clash = await Role.findOne({ where: { name: trimmed } });
    if (clash && clash.id !== role.id) {
      throw ApiError.conflict(`A role named "${trimmed}" already exists`);
    }
    role.name = trimmed;
  }
  if (description !== undefined) role.description = description || null;
  await role.save();

  if (permissions !== undefined) {
    const keys = validateKeys(permissions);
    assertCanGrantPermissions(actingAccess, keys);
    await role.setPermissions(await findPermissionsByKeys(keys));
  }

  // A role's permissions can affect any number of users at once.
  invalidateAll();

  const after = await getRole(role.id);
  await audit.record({
    action: AUDIT_ACTIONS.ROLE_UPDATE,
    entity: { type: "role", id: role.id, label: after.name },
    before,
    after,
  });

  return after;
}

async function deleteRole({ actingAccess, id }) {
  const role = await findRoleOr404(id);

  if (role.isSystem) {
    throw ApiError.forbidden("System roles cannot be deleted");
  }
  if (role.isDefault) {
    throw ApiError.badRequest(
      "This role is granted to every new registration. Make another role the default first."
    );
  }
  assertCanManageRole(actingAccess, role);
  const before = role.toPublicJSON();

  // user_roles and role_permissions cascade.
  await role.destroy();
  invalidateAll();

  await audit.record({
    action: AUDIT_ACTIONS.ROLE_DELETE,
    entity: { type: "role", id: before.id, label: before.name },
    before,
  });
}

module.exports = {
  listRoles,
  getRole,
  findRoleOr404,
  createRole,
  updateRole,
  deleteRole,
  assertCanGrantPermissions,
  assertCanAssignRole,
};
