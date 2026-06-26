/**
 * Seat plan lifecycle.
 *
 *   draft     -> planner is still editing; not visible to regular users
 *   pending   -> submitted by a planner, awaiting admin approval
 *   approved  -> visible to everyone with plan:view
 *   rejected  -> sent back by an admin with a reason; planner can fix & resubmit
 */
const PLAN_STATUS = Object.freeze({
  DRAFT: "draft",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
});

const ALL_PLAN_STATUSES = Object.freeze(Object.values(PLAN_STATUS));

module.exports = { PLAN_STATUS, ALL_PLAN_STATUSES };
