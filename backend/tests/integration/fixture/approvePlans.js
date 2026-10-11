/**
 * Test fixture: approve the seat plans the departures are built from.
 *
 * The importer leaves every plan pending for a person to check against the
 * source diagrams; a developer then approves the ones they need under
 * Approvals (README → Running it locally). The suites were written against a
 * database where exactly these four had been approved — every Ekota layout,
 * and only coach KA's of Madhumati's — and several of them check precisely
 * that: that a coach whose plan is still pending is left out of a departure,
 * and reported rather than silently dropped.
 */
const { sequelize, SeatPlan, User } = require("../../../src/models");
const { PLAN_STATUS } = require("../../../src/constants/planStatus");

const APPROVED = ["EKOTA-ACCHAIR-80", "EKOTA-CABIN-48", "EKOTA-SHOVONCHAIR-92", "MADHUMATI-755-CHAIR-41"];

(async () => {
  const approver = await User.findOne({ where: { email: process.env.SUPER_ADMIN_EMAIL } });
  const [count] = await SeatPlan.update(
    { status: PLAN_STATUS.APPROVED, approvedById: approver?.id ?? null, approvedAt: new Date(), rejectionReason: null },
    { where: { coachNo: APPROVED } }
  );
  if (count !== APPROVED.length) throw new Error(`expected to approve ${APPROVED.length} plans, approved ${count}`);
  console.log(`approved ${count} seat plans: ${APPROVED.join(", ")}`);
  await sequelize.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
