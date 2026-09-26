/**
 * Dedicated accounts for the automated suites.
 *
 * The suites used to run as the demo accounts, which meant every assertion they
 * made — every station created, role granted, seat held — landed in the audit
 * log attributed to a real person. Actual activity and test noise became
 * impossible to tell apart.
 *
 * These accounts all begin with `unittest-`, so the audit log can be filtered
 * by actor to separate the two. They reuse the existing roles rather than
 * inventing new ones, so the suites exercise exactly the same permissions a
 * real user of that role would have.
 *
 * Two super admins exist because the suites check the "last super admin cannot
 * be demoted" guard, which needs one to demote and one to demote it with —
 * without ever touching the real super admins.
 *
 *   npm run seed:unittestusers
 */
const bcrypt = require("bcryptjs");
const { sequelize, User, Role, UserRole } = require("../models");
const { RESERVED_ROLES } = require("../constants/roles");

const PASSWORD = "UnitTest123!";

const ACCOUNTS = [
  ["unittest-super1@example.com", "Unit Test Super Admin 1", RESERVED_ROLES.SUPER_ADMIN],
  ["unittest-super2@example.com", "Unit Test Super Admin 2", RESERVED_ROLES.SUPER_ADMIN],
  ["unittest-admin@example.com", "Unit Test Admin", "admin"],
  ["unittest-planner@example.com", "Unit Test Planner", "planner"],
  ["unittest-user@example.com", "Unit Test User", RESERVED_ROLES.DEFAULT],
  // A separate body for role grant/revoke experiments, so the suites never
  // strip the roles off an account they also assert the defaults of.
  ["unittest-target@example.com", "Unit Test Target", RESERVED_ROLES.DEFAULT],
];

async function run() {
  await sequelize.authenticate();

  const roles = await Role.findAll();
  const roleByName = new Map(roles.map((r) => [r.name, r]));

  const missing = [...new Set(ACCOUNTS.map(([, , role]) => role))].filter(
    (name) => !roleByName.has(name)
  );
  if (missing.length) {
    console.error(
      `❌ Missing role(s): ${missing.join(", ")}. Run \`npm run seed:testusers\` first.`
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  for (const [email, fullName, roleName] of ACCOUNTS) {
    const role = roleByName.get(roleName);

    const [user] = await User.findOrCreate({
      where: { email },
      defaults: { email, fullName, passwordHash, isVerified: true },
    });

    // Reset on every run so a suite that demoted or locked an account cannot
    // leave the next run broken.
    await user.update({
      fullName,
      passwordHash,
      isVerified: true,
      verificationCode: null,
      verificationCodeExpires: null,
    });

    await UserRole.destroy({ where: { userId: user.id } });
    await UserRole.create({ userId: user.id, roleId: role.id, grantedById: null });

    console.log(`✅ ${email.padEnd(32)} ${roleName}`);
  }

  console.log(
    `\n${ACCOUNTS.length} test accounts ready, all with password ${PASSWORD}.\n` +
      "Filter the audit log by actor to separate test noise from real activity."
  );

  await sequelize.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Seeding failed:", err.message);
  process.exit(1);
});
