/**
 * Load the railway timetable and seat plans from the command line — the same
 * work as Dashboard → Railway Data → Load, for a local database or a script.
 *
 *   npm run railway:load                       (as the first super admin)
 *   npm run railway:load -- --as admin@x.com   (file plans under that account)
 *   npm run railway:load -- --remove-unused-stations
 *
 * --remove-unused-stations deletes stations no route uses and nothing refers
 * to: tidies a development database after an earlier import. Do not use it on
 * a live system, where a new station may be waiting for its route.
 */
const { sequelize, User } = require("../../src/models");
const { connectMongo, mongoose } = require("../../src/config/mongo");
const { runWithContext } = require("../../src/utils/requestContext");
const railway = require("../../src/services/railwayService");
const { RESERVED_ROLES } = require("../../src/constants/roles");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}

async function actor() {
  const email = argValue("--as");
  const user = email
    ? await User.findOne({ where: { email } })
    : await User.findOne({
        include: [{ association: "roles", where: { name: RESERVED_ROLES.SUPER_ADMIN }, attributes: [] }],
        order: [["id", "ASC"]],
      });
  if (!user) throw new Error(email ? `No account ${email}.` : "No super admin account exists yet.");
  return user;
}

async function main() {
  await sequelize.authenticate();
  await connectMongo();
  const user = await actor();

  const report = await runWithContext(
    { actor: { id: user.id, email: user.email, roles: [] }, method: "CLI", path: "railway:load" },
    () =>
      railway.load(
        { progress: ({ done, total, step }) => console.log(`[${Math.min(done + 1, total)}/${total}] ${step}`) },
        { removeUnused: process.argv.includes("--remove-unused-stations") }
      )
  );

  const r = report;
  console.log(`
Timetable of ${r.snapshot.fetchedAt.slice(0, 10)}, filed under ${user.email}
  Stations      ${r.stations.created} new, ${r.stations.existing} existing${r.stations.removed ? `, ${r.stations.removed} unused removed` : ""}
  Trains        ${r.trains.created} new, ${r.trains.existing} existing
  Routes        ${r.routes.replaced} saved, ${r.routes.unchanged} unchanged, ${r.routes.skipped} skipped
  Seat plans    ${r.plans.approved} approved, ${r.plans.drafts} drafts, ${r.plans.existing} existing
  Compositions  ${r.compositions.set} set, ${r.compositions.existing} existing
  Schedules     ${r.schedules.set} set, ${r.schedules.existing} existing
  Fare rules    ${r.fareRules.created} new, ${r.fareRules.existing} existing
  Ready for departures: ${r.ready} train(s)`);

  if (r.warnings.length) console.log(`\nWarnings:\n${r.warnings.map((w) => `  ! ${w}`).join("\n")}`);
  if (r.notes.length) console.log(`\nTimetable adjustments:\n${r.notes.map((n) => `  - ${n}`).join("\n")}`);

  await sequelize.close();
  await mongoose.disconnect().catch(() => {});
}

main().catch(async (err) => {
  console.error(`\nLoading failed: ${err.message}`);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
