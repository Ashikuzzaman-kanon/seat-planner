/**
 * Mirrors the backend permission catalogue (backend/src/constants/permissions.js).
 *
 * Only the keys live here — labels and descriptions come from the API, so the
 * role editor stays in step automatically as new permissions are added.
 */
export const PERMISSIONS = {
  PLAN_VIEW: "plan:view",
  PLAN_CREATE: "plan:create",
  PLAN_UPDATE: "plan:update",
  PLAN_DELETE: "plan:delete",
  PLAN_APPROVE: "plan:approve",

  REFERENCE_MANAGE: "reference:manage",

  NETWORK_VIEW: "network:view",
  STATION_MANAGE: "station:manage",
  TRAIN_MANAGE: "train:manage",
  ROUTE_MANAGE: "route:manage",
  FARE_MANAGE: "fare:manage",
  SEAT_ATTRIBUTE_MANAGE: "seat_attribute:manage",

  COMPOSITION_MANAGE: "composition:manage",
  SCHEDULE_MANAGE: "schedule:manage",
  TRIP_VIEW: "trip:view",
  TRIP_MANAGE: "trip:manage",
  TRIP_CANCEL: "trip:cancel",

  INVENTORY_VIEW: "inventory:view",
  QUOTA_MANAGE: "quota:manage",
  SEAT_BLOCK: "seat:block",

  USER_VIEW: "user:view",
  USER_MANAGE_ROLES: "user:manage_roles",

  ROLE_VIEW: "role:view",
  ROLE_CREATE: "role:create",
  ROLE_UPDATE: "role:update",
  ROLE_DELETE: "role:delete",

  SETTING_VIEW: "setting:view",
  SETTING_MANAGE: "setting:manage",

  AUDIT_VIEW: "audit:view",

  BOOKING_CREATE: "booking:create",
  BOOKING_VIEW_ALL: "booking:view_all",
  WALLET_VIEW_ALL: "wallet:view_all",
  WALLET_ADJUST: "wallet:adjust",

  TICKET_VERIFY: "ticket:verify",
  TICKET_SCAN: "ticket:scan",
  TICKET_REPORT: "ticket:report",
  ABUSE_REVIEW: "abuse:review",
  ACCOUNT_HOLD: "account:hold",

  WAITLIST_JOIN: "waitlist:join",
  WAITLIST_VIEW_ALL: "waitlist:view_all",

  REFUND_REQUEST: "refund:request",
  REFUND_VIEW_ALL: "refund:view_all",
  REFUND_CONFIGURE: "refund:configure",
  APPROVAL_VIEW: "approval:view",
  APPROVAL_DECIDE_TRANSFER: "approval:decide_transfer",
  APPROVAL_DECIDE_WITHDRAWAL: "approval:decide_withdrawal",

  JOB_VIEW: "job:view",
  JOB_MANAGE: "job:manage",

  DEMO_MANAGE: "demo:manage",
};
