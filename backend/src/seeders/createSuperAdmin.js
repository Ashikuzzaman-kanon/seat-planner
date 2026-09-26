/**
 * Bootstraps access control so the system has a way in.
 *
 * Creates the two roles the platform itself depends on — `super_admin`, which
 * implicitly holds every permission, and the default role granted to each new
 * registration — then creates or promotes the super admin account.
 *
 * Idempotent. Run `npm run migrate` first on a fresh database.
 *
 *   npm run seed:superadmin
 */
const env = require("../config/env");
const { sequelize } = require("../models");
const { RESERVED_ROLES } = require("../constants/roles");
const { PERMISSIONS } = require("../constants/permissions");
const { syncPermissionCatalogue } = require("../services/permissionService");
const { ensureRole, setDefaultRole, ensureUser } = require("./helpers");

async function run() {
  const { name, email, password } = env.superAdmin;
  if (!email || !password) {
    console.error("❌ SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set in .env");
    process.exit(1);
  }

  await sequelize.authenticate();

  const { synced, removed } = await syncPermissionCatalogue();
  console.log(`✅ Permission catalogue synced (${synced} permissions, ${removed} pruned)`);

  // No permission rows: super admin holds everything implicitly, so future
  // catalogue additions are covered automatically and it can never lock itself out.
  await ensureRole(RESERVED_ROLES.SUPER_ADMIN, {
    description: "Full access to everything. Cannot be edited or deleted.",
    isSystem: true,
    permissions: null,
  });
  console.log(`✅ Role ready: ${RESERVED_ROLES.SUPER_ADMIN}`);

  const defaultRole = await ensureRole(RESERVED_ROLES.DEFAULT, {
    description: "Baseline capability granted to every new registration.",
    // Buying is what a passenger signs up to do, so it is part of the baseline
    // rather than something an administrator has to grant one account at a time.
    // Returning a ticket belongs with it: a passenger who can buy must be able
    // to change their mind, and REFUND_REQUEST grants nothing over anyone
    // else's booking.
    permissions: [
      PERMISSIONS.PLAN_VIEW,
      PERMISSIONS.BOOKING_CREATE,
      PERMISSIONS.REFUND_REQUEST,
      // Queueing for a sold-out stretch is part of trying to buy, not a
      // privilege over it.
      PERMISSIONS.WAITLIST_JOIN,
    ],
  });
  await setDefaultRole(defaultRole);
  console.log(`✅ Role ready: ${RESERVED_ROLES.DEFAULT} (default for new sign-ups)`);

  const { created } = await ensureUser({
    fullName: name,
    email,
    password,
    roles: [RESERVED_ROLES.SUPER_ADMIN],
  });
  console.log(
    `✅ ${created ? "Created" : "Promoted existing"} super admin: ${email.toLowerCase().trim()}`
  );

  await sequelize.close();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
