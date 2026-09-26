/**
 * Imports seat plans transcribed from published Bangladesh Railway coach
 * diagrams (see `seatPlanSource.js`).
 *
 * Everything lands as **pending** — submitted, awaiting admin approval — because
 * these are transcriptions from photographs, not authoritative data. A human
 * with `plan:approve` reviews each one against the source diagram before it
 * becomes visible.
 *
 * Idempotent: re-running updates the plan with the same coach number rather
 * than creating a second copy, and resets it to pending for re-review.
 *
 *   npm run seed:seatplans
 */
const crypto = require("crypto");
const {
  sequelize,
  User,
  TrainName,
  CoachType,
  CoachClass,
  SeatPlan,
} = require("../models");
const { PLAN_STATUS } = require("../constants/planStatus");
const { normalizeLayout, MAX_COLUMNS, MAX_SEATS_PER_ROW } = require("../utils/normalizeLayout");
const { PLANS } = require("./seatPlanSource");

const SEAT_TOKEN = /^(\d+)([whcpf]*)$/;

/**
 * Parse one row of the compact notation into cells.
 * Window position is resolved after parsing, because the default rule depends
 * on where a seat sits in the finished row.
 */
function parseRow(spec, planKey, rowIndex) {
  const tokens = String(spec).trim().split(/\s+/).filter(Boolean);

  const cells = tokens.map((token) => {
    if (token === "|" || token === "_") return { kind: "blank" };

    const match = SEAT_TOKEN.exec(token);
    if (!match) {
      throw new Error(`${planKey} row ${rowIndex + 1}: cannot read "${token}"`);
    }

    const [, number, flags] = match;
    const explicitWindow = flags.includes("w") || flags.includes("h");
    const explicitNotWindow = flags.includes("c");

    if (explicitWindow && explicitNotWindow) {
      throw new Error(`${planKey} row ${rowIndex + 1}: seat ${number} marked both window and corridor`);
    }

    return {
      kind: "seat",
      number,
      windowType: flags.includes("h") ? "half" : "full",
      explicitWindow,
      explicitNotWindow,
      chargingPort: flags.includes("p"),
      fan: flags.includes("f"),
    };
  });

  if (cells.length > MAX_COLUMNS) {
    throw new Error(`${planKey} row ${rowIndex + 1}: ${cells.length} cells (max ${MAX_COLUMNS})`);
  }
  const seatCount = cells.filter((c) => c.kind === "seat").length;
  if (seatCount > MAX_SEATS_PER_ROW) {
    throw new Error(`${planKey} row ${rowIndex + 1}: ${seatCount} seats (max ${MAX_SEATS_PER_ROW})`);
  }

  return cells;
}

/** Build the layout JSON the app stores, and verify it against the printed seat count. */
function buildLayout(plan) {
  const parsedRows = plan.rows.map((spec, i) => parseRow(spec, plan.key, i));

  const seen = new Set();
  const rows = parsedRows.map((cells) => ({
    id: crypto.randomUUID(),
    cells: cells.map((cell, index) => {
      if (cell.kind === "blank") return { kind: "blank" };

      if (seen.has(cell.number)) {
        throw new Error(`${plan.key}: seat ${cell.number} appears twice`);
      }
      seen.add(cell.number);

      // Unless the diagram said otherwise, the outer seat of a row is the
      // window seat — true of every layout in this set.
      const atOuterEdge = index === 0 || index === cells.length - 1;
      const isWindow = cell.explicitNotWindow ? false : cell.explicitWindow || atOuterEdge;

      return {
        kind: "seat",
        id: crypto.randomUUID(),
        number: cell.number,
        numberManual: true,
        isWindow,
        windowManual: cell.explicitWindow || cell.explicitNotWindow,
        windowType: isWindow ? cell.windowType : null,
        chargingPort: cell.chargingPort,
        fan: cell.fan,
        note: plan.seatNotes?.[cell.number] || "",
      };
    }),
  }));

  if (seen.size !== plan.seats) {
    throw new Error(
      `${plan.key}: transcribed ${seen.size} seats but the diagram prints ${plan.seats}`
    );
  }

  const columns = Math.max(...parsedRows.map((cells) => cells.length), 1);

  return normalizeLayout({
    columns,
    fromStation: plan.from || "",
    toStation: plan.to || "",
    stationsSwapped: false,
    direction: {
      splitRow: plan.splitRow ?? Math.floor(rows.length / 2),
      flipped: false,
    },
    rows,
  });
}

/** Look up a reference row by name, creating it if this is the first sighting. */
async function refId(Model, name, cache, created) {
  if (cache.has(name)) return cache.get(name);
  const [row, wasCreated] = await Model.findOrCreate({ where: { name }, defaults: { name } });
  if (wasCreated) created.push(`${Model.name}: ${name}`);
  cache.set(name, row.id);
  return row.id;
}

async function run() {
  await sequelize.authenticate();

  // Plans are submitted by a planner, so the approval queue behaves exactly as
  // it would for hand-drawn work.
  const author =
    (await User.findOne({ where: { email: "planner1@example.com" } })) ||
    (await User.findOne({ order: [["id", "ASC"]] }));

  if (!author) {
    console.error("❌ No users found. Run `npm run seed:testusers` first.");
    process.exit(1);
  }

  // Validate every plan before touching the database, so a bad transcription
  // cannot leave a half-imported set behind.
  const prepared = PLANS.map((plan) => ({ plan, layout: buildLayout(plan) }));
  console.log(`✅ Transcription check passed for all ${prepared.length} plans\n`);

  const trains = new Map();
  const types = new Map();
  const classes = new Map();
  const createdRefs = [];

  let created = 0;
  let updated = 0;

  for (const { plan, layout } of prepared) {
    const [trainNameId, coachTypeId, coachClassId] = await Promise.all([
      refId(TrainName, plan.train, trains, createdRefs),
      refId(CoachType, plan.coachType, types, createdRefs),
      refId(CoachClass, plan.coachClass, classes, createdRefs),
    ]);

    const existing = await SeatPlan.findOne({ where: { coachNo: plan.key } });

    const fields = {
      coachNo: plan.key,
      trainNameId,
      coachTypeId,
      coachClassId,
      layout,
      status: PLAN_STATUS.PENDING,
      rejectionReason: null,
      approvedById: null,
      approvedAt: null,
      createdById: author.id,
    };

    if (existing) {
      await existing.update(fields);
      updated++;
    } else {
      await SeatPlan.create(fields);
      created++;
    }

    const seatTotal = layout.rows.reduce(
      (n, r) => n + r.cells.filter((c) => c.kind === "seat").length,
      0
    );
    const windows = layout.rows.reduce(
      (n, r) => n + r.cells.filter((c) => c.kind === "seat" && c.isWindow).length,
      0
    );

    console.log(
      `${existing ? "↻" : "+"} ${plan.key.padEnd(28)} ${String(seatTotal).padStart(3)} seats · ` +
        `${String(windows).padStart(2)} window · ${plan.train} / ${plan.coachClass}`
    );
  }

  if (createdRefs.length) {
    console.log(`\nReference data created (${createdRefs.length}):`);
    for (const ref of createdRefs) console.log(`  + ${ref}`);
  }

  console.log(
    `\n✅ ${created} created, ${updated} updated — all PENDING, awaiting approval by a user with plan:approve.`
  );

  await sequelize.close();
  process.exit(0);
}

run().catch(async (err) => {
  console.error(`\n❌ Import failed: ${err.message}`);
  process.exit(1);
});
