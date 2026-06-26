// Mirrors backend/src/constants/planStatus.js
export const PLAN_STATUS = {
  DRAFT: "draft",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

export const PLAN_STATUS_LABELS = {
  [PLAN_STATUS.DRAFT]: "Draft",
  [PLAN_STATUS.PENDING]: "Pending",
  [PLAN_STATUS.APPROVED]: "Approved",
  [PLAN_STATUS.REJECTED]: "Rejected",
};

// Severity colors for PrimeReact <Tag>.
export const PLAN_STATUS_SEVERITY = {
  [PLAN_STATUS.DRAFT]: "secondary",
  [PLAN_STATUS.PENDING]: "warning",
  [PLAN_STATUS.APPROVED]: "success",
  [PLAN_STATUS.REJECTED]: "danger",
};
