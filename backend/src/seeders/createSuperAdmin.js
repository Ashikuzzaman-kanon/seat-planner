/**
 * Bootstraps the first super admin so role management has a starting point.
 * Reads SUPER_ADMIN_* from the environment. Idempotent: if the user already
 * exists it is promoted to super_admin and marked verified.
 *
 *   npm run seed:superadmin
 */
const bcrypt = require("bcryptjs");
const env = require("../config/env");
const { sequelize, User } = require("../models");
const { ROLES } = require("../constants/roles");

async function run() {
  const { name, email, password } = env.superAdmin;
  if (!email || !password) {
    console.error(
      "❌ SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set in .env"
    );
    process.exit(1);
  }

  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ where: { email: normalizedEmail } });

  if (existing) {
    existing.role = ROLES.SUPER_ADMIN;
    existing.isVerified = true;
    await existing.save();
    console.log(`✅ Promoted existing user to super admin: ${normalizedEmail}`);
  } else {
    await User.create({
      fullName: name,
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 10),
      role: ROLES.SUPER_ADMIN,
      isVerified: true,
    });
    console.log(`✅ Created super admin: ${normalizedEmail}`);
  }

  await sequelize.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
