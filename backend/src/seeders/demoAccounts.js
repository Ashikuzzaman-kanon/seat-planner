/**
 * The demonstration roles and accounts, in one place.
 *
 * Shared by `npm run seed:testusers` (local development) and the super admin's
 * "Populate demo data" button (any environment), so the two can never drift:
 * planner1@example.com has the same password, and the planner role the same
 * permissions, wherever it was created.
 *
 * Emails follow `<role><n>@example.com` and passwords `<Role>123!` —
 * e.g. planner1@example.com / Planner123!.
 *
 * The role names match the old hardcoded hierarchy, but they are ordinary
 * database rows composed from the permission catalogue — an administrator can
 * rename them, re-scope them, or delete them. `admin` deliberately holds
 * `role:create` without holding `setting:manage`, which makes the escalation
 * guard visible: an admin can build new roles, but never one more powerful than
 * itself.
 */
const { RESERVED_ROLES } = require("../constants/roles");
const { PERMISSIONS: P } = require("../constants/permissions");

const USERS_PER_ROLE = 2;

const DEMO_ROLES = [
  {
    name: "planner",
    description: "Designs coach seat layouts and submits them for approval.",
    permissions: [P.PLAN_VIEW, P.PLAN_CREATE, P.PLAN_UPDATE, P.PLAN_DELETE],
  },
  {
    name: "admin",
    description:
      "Approves layouts, manages reference data, and delegates access — within the limits of its own permissions.",
    permissions: [
      P.PLAN_VIEW,
      P.PLAN_CREATE,
      P.PLAN_UPDATE,
      P.PLAN_DELETE,
      P.PLAN_APPROVE,
      P.REFERENCE_MANAGE,
      // Network, except the seat attribute catalogue — which keeps the
      // escalation guard demonstrable: admin can build roles, but cannot grant
      // a permission it does not itself hold.
      P.NETWORK_VIEW,
      P.STATION_MANAGE,
      P.TRAIN_MANAGE,
      P.ROUTE_MANAGE,
      P.FARE_MANAGE,
      P.COMPOSITION_MANAGE,
      P.SCHEDULE_MANAGE,
      P.TRIP_VIEW,
      P.TRIP_MANAGE,
      P.TRIP_CANCEL,
      P.INVENTORY_VIEW,
      P.QUOTA_MANAGE,
      P.SEAT_BLOCK,
      // Oversight of sales, but not WALLET_ADJUST: hand-editing a balance mints
      // money from nothing, so it stays with the super admin.
      P.BOOKING_VIEW_ALL,
      P.WALLET_VIEW_ALL,
      P.REFUND_VIEW_ALL,
      P.REFUND_CONFIGURE,
      P.WAITLIST_VIEW_ALL,
      // Works the approval queues and decides transfers, but not withdrawals:
      // a withdrawal is money leaving the system, and belongs with the same
      // narrow authority as adjusting a balance by hand.
      P.APPROVAL_VIEW,
      P.APPROVAL_DECIDE_TRANSFER,
      // Reviews what checkers report, and can look a ticket up — but scanning
      // one as used is the checker's job.
      P.TICKET_VERIFY,
      P.ABUSE_REVIEW,
      P.ACCOUNT_HOLD,
      P.USER_VIEW,
      P.USER_MANAGE_ROLES,
      P.ROLE_VIEW,
      P.ROLE_CREATE,
      P.ROLE_UPDATE,
      P.SETTING_VIEW,
      P.AUDIT_VIEW,
      P.JOB_VIEW,
    ],
  },
  {
    name: "checker",
    description: "Checks tickets on the train or at the gate, and reports what looks wrong.",
    permissions: [P.TICKET_VERIFY, P.TICKET_SCAN, P.TICKET_REPORT, P.TRIP_VIEW],
  },
];

/**
 * A passenger account needs a name, National ID and date of birth before its
 * first booking. The demo passengers come with one, so they can book at once.
 * Made-up numbers, in the right shape.
 */
const PASSENGER_PROFILES = [
  { nid: "1990123456701", dateOfBirth: "1990-04-12" },
  { nid: "1988765432102", dateOfBirth: "1988-11-03" },
];

/** super_admin -> "Super Admin" */
const capitalise = (role) =>
  role
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

/** The demo accounts for one role: `<role><n>@example.com` / `<Role>123!`. */
function testUsersFor(roleName) {
  const slug = roleName.replace(/_/g, ""); // super_admin -> superadmin
  const passwordRole = capitalise(roleName).replace(/ /g, ""); // -> SuperAdmin

  return Array.from({ length: USERS_PER_ROLE }, (_, i) => {
    const n = i + 1;
    return {
      fullName: `${capitalise(roleName)} ${n}`,
      email: `${slug}${n}@example.com`,
      password: `${passwordRole}123!`,
      roles: [roleName],
      ...(roleName === RESERVED_ROLES.DEFAULT ? PASSENGER_PROFILES[i] : {}),
    };
  });
}

/**
 * The roles that get demo accounts. Locally that includes the super admin;
 * the in-app button leaves it out — see `demoService`.
 */
const ACCOUNT_ROLES = [RESERVED_ROLES.DEFAULT, ...DEMO_ROLES.map((r) => r.name), RESERVED_ROLES.SUPER_ADMIN];

module.exports = { USERS_PER_ROLE, DEMO_ROLES, ACCOUNT_ROLES, testUsersFor, capitalise };
