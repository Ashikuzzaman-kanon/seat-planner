const { Op } = require("sequelize");
const { User } = require("../models");
const ApiError = require("../utils/ApiError");
const { ALL_ROLES, ROLES } = require("../constants/roles");

/** Paginated, searchable user list for admins / super admins. */
async function listUsers({ page = 1, limit = 20, search = "", role } = {}) {
  const where = {};
  if (search) {
    where[Op.or] = [
      { fullName: { [Op.like]: `%${search}%` } },
      { email: { [Op.like]: `%${search}%` } },
    ];
  }
  if (role) where.role = role;

  const offset = (page - 1) * limit;
  const { rows, count } = await User.findAndCountAll({
    where,
    limit,
    offset,
    order: [["created_at", "DESC"]],
  });

  return {
    users: rows.map((u) => u.toPublicJSON()),
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
  };
}

async function getUser(id) {
  const user = await User.findByPk(id);
  if (!user) throw ApiError.notFound("User not found");
  return user.toPublicJSON();
}

/**
 * Change a user's role. Only callable by a super admin (enforced at the route).
 * Guards against a super admin changing their own role (avoids self-lockout)
 * and against demoting the last remaining super admin.
 */
async function changeRole({ actingUser, targetUserId, newRole }) {
  if (!ALL_ROLES.includes(newRole)) {
    throw ApiError.badRequest(`Invalid role. Must be one of: ${ALL_ROLES.join(", ")}`);
  }

  const target = await User.findByPk(targetUserId);
  if (!target) throw ApiError.notFound("User not found");

  if (target.id === actingUser.id) {
    throw ApiError.badRequest("You cannot change your own role");
  }

  if (target.role === newRole) {
    return target.toPublicJSON(); // No-op.
  }

  // Don't allow removing the last super admin.
  if (target.role === ROLES.SUPER_ADMIN && newRole !== ROLES.SUPER_ADMIN) {
    const superAdmins = await User.count({ where: { role: ROLES.SUPER_ADMIN } });
    if (superAdmins <= 1) {
      throw ApiError.badRequest("Cannot demote the last super admin");
    }
  }

  target.role = newRole;
  await target.save();
  return target.toPublicJSON();
}

module.exports = { listUsers, getUser, changeRole };
