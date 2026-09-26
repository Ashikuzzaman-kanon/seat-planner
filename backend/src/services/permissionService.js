const { Op } = require("sequelize");
const { Permission, Role, User } = require("../models");
const { PERMISSION_CATALOGUE, ALL_PERMISSION_KEYS } = require("../constants/permissions");

/**
 * Mirrors the code-defined catalogue into the `permissions` table.
 *
 * The catalogue in code is authoritative; this only makes it referenceable by
 * foreign key. Keys that have disappeared from the catalogue are pruned, and
 * the cascade drops any role assignment that pointed at them — a role can never
 * hold a permission no endpoint honours.
 *
 * Safe to run repeatedly; it is called by the seeders and on demand.
 */
async function syncPermissionCatalogue({ transaction } = {}) {
  for (const entry of PERMISSION_CATALOGUE) {
    await Permission.upsert(
      {
        key: entry.key,
        groupName: entry.group,
        label: entry.label,
        description: entry.description,
      },
      { transaction }
    );
  }

  const removed = await Permission.destroy({
    where: { key: { [Op.notIn]: ALL_PERMISSION_KEYS } },
    transaction,
  });

  invalidateAll();
  return { synced: PERMISSION_CATALOGUE.length, removed };
}

/** Look up permission rows for a list of keys. Unknown keys are ignored. */
async function findPermissionsByKeys(keys, { transaction } = {}) {
  if (!keys?.length) return [];
  return Permission.findAll({ where: { key: { [Op.in]: keys } }, transaction });
}

/* ------------------------------------------------------------------ *
 * Per-request access resolution
 * ------------------------------------------------------------------ */

/**
 * Resolving access on every request would mean a three-table join per call, so
 * results are cached in process and invalidated whenever roles or permissions
 * change. The short TTL is a safety net, not the primary mechanism.
 *
 * Note: this cache is per process. Running multiple API instances means an
 * invalidation on one is not seen by the others, and the TTL becomes the real
 * bound on staleness. A shared cache would be the fix if we ever scale out.
 */
const ACCESS_TTL_MS = 60_000;
const accessCache = new Map();

/** One query: the user's roles with their permissions eager-loaded. */
async function loadAccess(userId) {
  const roles = await Role.findAll({
    include: [
      {
        model: User,
        as: "users",
        attributes: [],
        through: { attributes: [] },
        where: { id: userId },
        required: true,
      },
      {
        model: Permission,
        as: "permissions",
        attributes: ["key"],
        through: { attributes: [] },
      },
    ],
  });

  // Super admin holds everything implicitly, so permissions added by future
  // features are covered automatically and it can never lock itself out.
  const isSuperAdmin = roles.some((r) => r.isSuperAdmin);
  const permissions = isSuperAdmin
    ? [...ALL_PERMISSION_KEYS]
    : [...new Set(roles.flatMap((r) => r.permissions.map((p) => p.key)))];

  return {
    isSuperAdmin,
    roles: roles.map((r) => ({ id: r.id, name: r.name })),
    permissions,
  };
}

/** Effective access for a user: role names plus the union of their permissions. */
async function getAccess(userId) {
  const cached = accessCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await loadAccess(userId);
  accessCache.set(userId, { value, expiresAt: Date.now() + ACCESS_TTL_MS });
  return value;
}

/** Drop one user's cached access — call after changing their roles. */
function invalidateUser(userId) {
  accessCache.delete(Number(userId));
  accessCache.delete(String(userId));
}

/**
 * Drop every cached entry — call after changing a role's permissions, which
 * can affect any number of users at once.
 */
function invalidateAll() {
  accessCache.clear();
}

module.exports = {
  syncPermissionCatalogue,
  findPermissionsByKeys,
  getAccess,
  invalidateUser,
  invalidateAll,
};
