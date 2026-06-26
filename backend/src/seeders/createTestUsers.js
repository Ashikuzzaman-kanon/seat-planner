/**
 * Seeds verified test accounts for each non-super-admin role so the app can be
 * demoed/shared. Idempotent: existing accounts are updated (role + password
 * reset, marked verified).
 *
 *   npm run seed:testusers
 */
const bcrypt = require("bcryptjs");
const { sequelize, User } = require("../models");
const { ROLES } = require("../constants/roles");

const TEST_USERS = [
  { fullName: "Admin User", email: "admin@example.com", password: "Admin123!", role: ROLES.ADMIN },
  { fullName: "Planner User", email: "planner@example.com", password: "Planner123!", role: ROLES.PLANNER },
  { fullName: "Normal User", email: "user@example.com", password: "User123!", role: ROLES.USER },
];

async function run() {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  for (const u of TEST_USERS) {
    const email = u.email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(u.password, 10);
    const existing = await User.findOne({ where: { email } });

    if (existing) {
      existing.fullName = u.fullName;
      existing.role = u.role;
      existing.passwordHash = passwordHash;
      existing.isVerified = true;
      existing.verificationCode = null;
      existing.verificationCodeExpires = null;
      await existing.save();
      console.log(`✅ Updated ${u.role}: ${email}`);
    } else {
      await User.create({
        fullName: u.fullName,
        email,
        passwordHash,
        role: u.role,
        isVerified: true,
      });
      console.log(`✅ Created ${u.role}: ${email}`);
    }
  }

  await sequelize.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
