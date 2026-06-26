/**
 * Single source of truth for roles and what each role is allowed to do.
 *
 * Role hierarchy (low -> high privilege):
 *   user  <  planner  <  admin  <  super_admin
 */

const ROLES = Object.freeze({
  USER: "user",
  PLANNER: "planner",
  ADMIN: "admin",
  SUPER_ADMIN: "super_admin",
});

const ALL_ROLES = Object.freeze(Object.values(ROLES));

// Higher number = more privilege. Useful for "at least this role" checks.
const ROLE_RANK = Object.freeze({
  [ROLES.USER]: 0,
  [ROLES.PLANNER]: 1,
  [ROLES.ADMIN]: 2,
  [ROLES.SUPER_ADMIN]: 3,
});

const PERMISSIONS = Object.freeze({
  PLAN_VIEW: "plan:view", // view approved seat plans
  PLAN_CREATE: "plan:create",
  PLAN_UPDATE: "plan:update",
  PLAN_DELETE: "plan:delete",
  PLAN_APPROVE: "plan:approve", // approve/reject pending plans
  REFERENCE_MANAGE: "reference:manage", // manage train names / coach types / classes
  USER_VIEW: "user:view", // list/inspect users
  USER_MANAGE_ROLES: "user:manage_roles", // change a user's role
});

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.USER]: [PERMISSIONS.PLAN_VIEW],

  [ROLES.PLANNER]: [
    PERMISSIONS.PLAN_VIEW,
    PERMISSIONS.PLAN_CREATE,
    PERMISSIONS.PLAN_UPDATE,
    PERMISSIONS.PLAN_DELETE,
  ],

  [ROLES.ADMIN]: [
    PERMISSIONS.PLAN_VIEW,
    PERMISSIONS.PLAN_CREATE,
    PERMISSIONS.PLAN_UPDATE,
    PERMISSIONS.PLAN_DELETE,
    PERMISSIONS.PLAN_APPROVE,
    PERMISSIONS.REFERENCE_MANAGE,
    PERMISSIONS.USER_VIEW,
  ],

  [ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS),
});

function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function roleHasPermission(role, permission) {
  return permissionsForRole(role).includes(permission);
}

module.exports = {
  ROLES,
  ALL_ROLES,
  ROLE_RANK,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  permissionsForRole,
  roleHasPermission,
};
