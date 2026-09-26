/**
 * Seeds demonstration roles and two verified accounts for each, so the app can
 * be demoed without hand-building an access model.
 *
 * The role names match the old hardcoded hierarchy, but they are now ordinary
 * database rows composed from the permission catalogue — an administrator can
 * rename them, re-scope them, or delete them. `admin` deliberately holds
 * `role:create` without holding `setting:manage`, which makes the escalation
 * guard visible: an admin can build new roles, but never one more powerful than
 * itself.
 *
 * Emails follow `<role><n>@example.com` and passwords `<Role>123!` —
 * e.g. planner1@example.com / Planner123!.
 *
 * Run `npm run migrate` and `npm run seed:superadmin` first.
 *
 *   npm run seed:testusers
 */
const { sequelize } = require("../models");
const { RESERVED_ROLES } = require("../constants/roles");
const { PERMISSIONS: P } = require("../constants/permissions");
const { syncPermissionCatalogue } = require("../services/permissionService");
const { ensureRole, ensureUser } = require("./helpers");

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
      P.INVENTORY_VIEW,
      P.QUOTA_MANAGE,
      P.SEAT_BLOCK,
      // Oversight of sales, but not WALLET_ADJUST: hand-editing a balance mints
      // money from nothing, so it stays with the super admin.
      P.BOOKING_VIEW_ALL,
      P.WALLET_VIEW_ALL,
      P.REFUND_VIEW_ALL,
      P.REFUND_CONFIGURE,
      // Works the approval queues and decides transfers, but not withdrawals:
      // a withdrawal is money leaving the system, and belongs with the same
      // narrow authority as adjusting a balance by hand.
      P.APPROVAL_VIEW,
      P.APPROVAL_DECIDE_TRANSFER,
      P.USER_VIEW,
      P.USER_MANAGE_ROLES,
      P.ROLE_VIEW,
      P.ROLE_CREATE,
      P.ROLE_UPDATE,
      P.SETTING_VIEW,
      P.AUDIT_VIEW,
    ],
  },
];

/** super_admin -> "Super Admin" */
const capitalise = (role) =>
  role
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

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
    };
  });
}

async function run() {
  await sequelize.authenticate();
  await syncPermissionCatalogue();

  for (const role of DEMO_ROLES) {
    await ensureRole(role.name, role);
    console.log(`✅ Role ready: ${role.name} (${role.permissions.length} permissions)`);
  }

  // The default and super admin roles come from `seed:superadmin`; test
  // accounts are layered onto all four.
  const roleNames = [
    RESERVED_ROLES.DEFAULT,
    ...DEMO_ROLES.map((r) => r.name),
    RESERVED_ROLES.SUPER_ADMIN,
  ];

  for (const roleName of roleNames) {
    for (const u of testUsersFor(roleName)) {
      const { created } = await ensureUser(u);
      console.log(`✅ ${created ? "Created" : "Updated"} ${roleName}: ${u.email}`);
    }
  }

  await sequelize.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
