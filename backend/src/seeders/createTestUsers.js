/**
 * Seeds demonstration roles and two verified accounts for each, so the app can
 * be demoed without hand-building an access model.
 *
 * The roles and accounts themselves are defined in `demoAccounts.js`, which the
 * super admin's "Populate demo data" button uses too.
 *
 * Emails follow `<role><n>@example.com` and passwords `<Role>123!` —
 * e.g. planner1@example.com / Planner123!.
 *
 * Unlike the button, this is for a developer's own database: it resets the
 * roles' permissions and the accounts' passwords to the definitions, and it
 * creates super admin accounts as well.
 *
 * Run `npm run migrate` and `npm run seed:superadmin` first.
 *
 *   npm run seed:testusers
 */
const { sequelize } = require("../models");
const { syncPermissionCatalogue } = require("../services/permissionService");
const { ensureRole, ensureUser } = require("./helpers");
const { DEMO_ROLES, ACCOUNT_ROLES, testUsersFor } = require("./demoAccounts");

async function run() {
  await sequelize.authenticate();
  await syncPermissionCatalogue();

  for (const role of DEMO_ROLES) {
    await ensureRole(role.name, role);
    console.log(`✅ Role ready: ${role.name} (${role.permissions.length} permissions)`);
  }

  // The default and super admin roles come from `seed:superadmin`; test
  // accounts are layered onto all of them.
  for (const roleName of ACCOUNT_ROLES) {
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
