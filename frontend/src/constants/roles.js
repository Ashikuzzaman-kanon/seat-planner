// Mirrors the backend role/permission model (backend/src/constants/roles.js).
export const ROLES = {
  USER: "user",
  PLANNER: "planner",
  ADMIN: "admin",
  SUPER_ADMIN: "super_admin",
};

export const ALL_ROLES = Object.values(ROLES);

export const ROLE_LABELS = {
  [ROLES.USER]: "User",
  [ROLES.PLANNER]: "Planner",
  [ROLES.ADMIN]: "Admin",
  [ROLES.SUPER_ADMIN]: "Super Admin",
};

// Severity colors for PrimeReact <Tag>.
export const ROLE_SEVERITY = {
  [ROLES.USER]: "secondary",
  [ROLES.PLANNER]: "info",
  [ROLES.ADMIN]: "warning",
  [ROLES.SUPER_ADMIN]: "danger",
};

export const PERMISSIONS = {
  PLAN_VIEW: "plan:view",
  PLAN_CREATE: "plan:create",
  PLAN_UPDATE: "plan:update",
  PLAN_DELETE: "plan:delete",
  PLAN_APPROVE: "plan:approve",
  REFERENCE_MANAGE: "reference:manage",
  USER_VIEW: "user:view",
  USER_MANAGE_ROLES: "user:manage_roles",
};
