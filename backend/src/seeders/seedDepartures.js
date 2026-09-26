/**
 * Seeds default coach compositions and weekly schedules for the two trains that
 * have routes, then extends the rolling horizon.
 *
 * Coach codes follow Bangladesh Railway practice (KA, KHA, GA…). Which days a
 * train runs is **illustrative** — replace with the operator's timetable.
 *
 * Note: departures only materialise seats from **approved** seat plans. The
 * imported plans are deliberately pending review, so a freshly seeded system
 * generates departures with zero seats until somebody approves the layouts.
 * That is the approval step doing its job, not a failure.
 *
 *   npm run seed:departures
 */
const { sequelize, TrainName, SeatPlan } = require("../models");
const compositionService = require("../services/compositionService");
const scheduleService = require("../services/scheduleService");
const tripService = require("../services/tripService");
const { DAY_NAMES } = require("../utils/dhakaTime");

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const PLAN = {
  MADHUMATI: [
    ["KA", "MADHUMATI-755-CHAIR-41"],
    ["KHA", "MADHUMATI-VACUUM-104"],
    ["GA", "MADHUMATI-VACUUM-104"],
    ["GHA", "MADHUMATI-755-CABIN-24"],
  ],
  EKOTA: [
    ["KA", "EKOTA-ACCHAIR-80"],
    ["KHA", "EKOTA-CABIN-48"],
    ["GA", "EKOTA-SHOVONCHAIR-92"],
    ["GHA", "EKOTA-SHOVONCHAIR-92"],
    ["UMA", "EKOTA-SHOVONCHAIR-92"],
  ],
};

const TRAINS = [
  {
    name: "Madhumati Express",
    coaches: PLAN.MADHUMATI,
    // Illustrative: one rest day a week.
    runsOn: EVERY_DAY.filter((d) => d !== 0),
  },
  {
    name: "Ekota Express",
    coaches: PLAN.EKOTA,
    runsOn: EVERY_DAY,
  },
];

async function run() {
  await sequelize.authenticate();

  const plans = await SeatPlan.findAll();
  const planByCoachNo = new Map(plans.map((p) => [p.coachNo, p]));

  for (const spec of TRAINS) {
    const train = await TrainName.findOne({ where: { name: spec.name } });
    if (!train) {
      console.warn(`⚠️  ${spec.name} not found — run seed:seatplans first. Skipping.`);
      continue;
    }

    const coaches = [];
    for (const [coachCode, coachNo] of spec.coaches) {
      const plan = planByCoachNo.get(coachNo);
      if (!plan) {
        console.warn(`⚠️  ${spec.name}: no seat plan "${coachNo}" — skipping coach ${coachCode}`);
        continue;
      }
      coaches.push({ coachCode, seatPlanId: plan.id });
    }

    const saved = await compositionService.set(train.id, coaches);
    const seats = saved.reduce((n, c) => n + c.seatCount, 0);
    const pending = saved.filter((c) => !c.planApproved).length;
    console.log(
      `✅ ${spec.name}: ${saved.length} coaches, ${seats} seats` +
        (pending ? ` — ${pending} awaiting plan approval` : "")
    );

    await scheduleService.set(train.id, [{ runsOn: spec.runsOn, isActive: true }]);
    console.log(
      `   runs ${spec.runsOn.length === 7 ? "daily" : spec.runsOn.map((d) => DAY_NAMES[d].slice(0, 3)).join(", ")}`
    );
  }

  console.log("\nGenerating the rolling horizon…");
  const report = await tripService.generateHorizon({ actorLabel: "seed:departures" });

  console.log(
    `✅ ${report.from} → ${report.to} (${report.horizonDays} days): ` +
      `${report.created} departures created, ${report.existing} already existed, ` +
      `${report.seatsCreated} seats materialised`
  );

  for (const summary of report.trains) {
    if (!summary.created && !summary.existing && !summary.notes.length) continue;
    console.log(
      `   ${summary.train}: ${summary.created} new, ${summary.existing} existing, ${summary.seats} seats` +
        (summary.notes.length ? `\n      ${summary.notes.join("\n      ")}` : "")
    );
  }

  if (report.seatsCreated === 0 && report.created > 0) {
    console.log(
      "\nNo seats were materialised because every seat plan is still pending review.\n" +
        "Approve the layouts (Dashboard → Approvals), then rebuild a departure or\n" +
        "run this seeder again — the approval gate is working as intended."
    );
  }

  await sequelize.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Departure seeding failed:", err.message);
  process.exit(1);
});
