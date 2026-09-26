const { Op } = require("sequelize");
const { User, Role, Permission, UserRole } = require("../models");
const ApiError = require("../utils/ApiError");
const { RESERVED_ROLES } = require("../constants/roles");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { assertCanAssignRole } = require("./roleService");
const { invalidateUser } = require("./permissionService");
const audit = require("./auditService");

const USER_INCLUDE = [{ model: Role, as: "roles", through: { attributes: [] } }];

/** Paginated, searchable user list. Optionally filtered to holders of one role. */
async function listUsers({ page = 1, limit = 20, search = "", roleId } = {}) {
  const where = {};
  if (search) {
    where[Op.or] = [
      { fullName: { [Op.like]: `%${search}%` } },
      { email: { [Op.like]: `%${search}%` } },
    ];
  }

  const offset = (page - 1) * limit;
  const { rows, count } = await User.findAndCountAll({
    where,
    include: [
      {
        ...USER_INCLUDE[0],
        // Filtering by role must not drop the user's other roles from the
        // response, so the filter is applied as a separate required join.
        ...(roleId ? { where: { id: roleId }, required: true } : {}),
      },
    ],
    limit,
    offset,
    order: [["created_at", "DESC"]],
    distinct: true,
  });

  // Re-read role lists unfiltered when a role filter narrowed the join.
  const users = roleId
    ? await User.findAll({ where: { id: rows.map((r) => r.id) }, include: USER_INCLUDE })
    : rows;

  return {
    users: users.map((u) => u.toPublicJSON()),
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
  };
}

async function findUserOr404(id) {
  const user = await User.findByPk(id, { include: USER_INCLUDE });
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

async function getUser(id) {
  const user = await findUserOr404(id);
  return user.toPublicJSON();
}

/**
 * Replace the set of roles a user holds.
 *
 * Guards, in order:
 *   1. Nobody edits their own roles — removes the easiest self-lockout.
 *   2. The escalation guard applies to every role being added *and* removed, so
 *      an administrator cannot hand out, or strip, access beyond their own.
 *   3. The last super admin cannot be demoted, or the install loses its way in.
 */
async function setUserRoles({ actingUser, actingAccess, targetUserId, roleIds }) {
  const target = await findUserOr404(targetUserId);

  if (target.id === actingUser.id) {
    throw ApiError.badRequest("You cannot change your own roles");
  }

  const requestedIds = [...new Set(roleIds.map(Number))];
  const roles = await Role.findAll({
    where: { id: requestedIds },
    include: [{ model: Permission, as: "permissions", through: { attributes: [] } }],
  });

  if (roles.length !== requestedIds.length) {
    const found = new Set(roles.map((r) => r.id));
    const missing = requestedIds.filter((id) => !found.has(id));
    throw ApiError.badRequest(`Unknown role id(s): ${missing.join(", ")}`);
  }

  const currentIds = target.roles.map((r) => r.id);
  const added = roles.filter((r) => !currentIds.includes(r.id));
  const removedIds = currentIds.filter((id) => !requestedIds.includes(id));
  const removed = await Role.findAll({
    where: { id: removedIds },
    include: [{ model: Permission, as: "permissions", through: { attributes: [] } }],
  });

  for (const role of [...added, ...removed]) {
    assertCanAssignRole(actingAccess, role);
  }

  const superAdminRole = await Role.findOne({
    where: { name: RESERVED_ROLES.SUPER_ADMIN },
  });
  if (superAdminRole && removedIds.includes(superAdminRole.id)) {
    const remaining = await UserRole.count({ where: { roleId: superAdminRole.id } });
    if (remaining <= 1) {
      throw ApiError.badRequest("Cannot remove the last super admin");
    }
  }

  await UserRole.destroy({ where: { userId: target.id } });
  await UserRole.bulkCreate(
    requestedIds.map((roleId) => ({
      userId: target.id,
      roleId,
      grantedById: actingUser.id,
    }))
  );

  // The next request this user makes resolves their access afresh — which is
  // what makes revocation effective within seconds rather than at token expiry.
  invalidateUser(target.id);

  await audit.record({
    action: AUDIT_ACTIONS.USER_ROLES_UPDATE,
    entity: { type: "user", id: target.id, label: target.email },
    before: { roles: target.roles.map((r) => r.name) },
    after: { roles: roles.map((r) => r.name) },
    message:
      [
        added.length ? `granted: ${added.map((r) => r.name).join(", ")}` : null,
        removed.length ? `revoked: ${removed.map((r) => r.name).join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("; ") || "no change",
  });

  return getUser(target.id);
}

module.exports = { listUsers, getUser, setUserRoles };
