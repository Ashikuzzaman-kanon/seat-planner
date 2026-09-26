/**
 * Seeds the network: stations, the seat attribute catalogue, two worked routes
 * and a fare rule chain.
 *
 * Station names and route station *orders* are real. **Times and distances are
 * illustrative** — enough to exercise day offsets, distance-based pricing and
 * segment maths, but they are not a published timetable and should be replaced
 * with operator data before anything is sold against them.
 *
 * Idempotent.
 *
 *   npm run seed:network
 */
const { sequelize, Station, TrainName, CoachClass, FareRule } = require("../models");
const trainService = require("../services/trainService");
const fareService = require("../services/fareService");
const seatAttributeService = require("../services/seatAttributeService");

const STATIONS = [
  ["DHK", "Dhaka (Kamalapur)", "Dhaka"],
  ["BBS", "Biman Bandar", "Dhaka"],
  ["JYD", "Joydebpur", "Gazipur"],
  ["TAN", "Tangail", "Tangail"],
  ["BBSE", "Bangabandhu Setu East", "Tangail"],
  ["SMA", "Shahid M Mansur Ali", "Sirajganj"],
  ["ULP", "Ullapara", "Sirajganj"],
  ["CHM", "Chatmohar", "Pabna"],
  ["ISD", "Ishwardi", "Pabna"],
  ["NTR", "Natore", "Natore"],
  ["AHG", "Ahsanganj", "Naogaon"],
  ["STH", "Santahar", "Bogura"],
  ["JPR", "Joypurhat", "Joypurhat"],
  ["PBT", "Parbatipur", "Dinajpur"],
  ["DNJ", "Dinajpur", "Dinajpur"],
  ["PCG", "Panchagarh", "Panchagarh"],
  ["CHH", "Chilahati", "Nilphamari"],
  ["RJS", "Rajshahi", "Rajshahi"],
  ["BRM", "Bheramara", "Kushtia"],
  ["PDH", "Poradaha", "Kushtia"],
  ["KTC", "Kushtia Court", "Kushtia"],
  ["RJB", "Rajbari", "Rajbari"],
  ["FDP", "Faridpur", "Faridpur"],
  ["BNG", "Bhanga", "Faridpur"],
  ["KHL", "Khulna", "Khulna"],
  ["JSR", "Jashore", "Jashore"],
  ["BNP", "Benapole", "Jashore"],
  ["CTG", "Chattogram", "Chattogram"],
  ["FNI", "Feni", "Feni"],
  ["CUM", "Cumilla", "Cumilla"],
  ["SYL", "Sylhet", "Sylhet"],
  ["SRM", "Srimangal", "Moulvibazar"],
  ["MYM", "Mymensingh", "Mymensingh"],
  ["RGP", "Rangpur", "Rangpur"],
  ["LMH", "Lalmonirhat", "Lalmonirhat"],
  ["KRG", "Kurigram", "Kurigram"],
];

const SEAT_ATTRIBUTES = [
  {
    key: "window",
    label: "Window",
    description: "Seat is beside a window.",
    valueType: "enum",
    options: [
      { value: "full", label: "Full window" },
      { value: "half", label: "Half window" },
    ],
    icon: "pi pi-stop",
    sortOrder: 10,
  },
  {
    key: "charging_port",
    label: "Charging port",
    description: "A power socket is reachable from this seat.",
    valueType: "boolean",
    icon: "pi pi-bolt",
    sortOrder: 20,
  },
  {
    key: "fan",
    label: "Fan",
    description: "A fan serves this seat.",
    valueType: "boolean",
    icon: "pi pi-sync",
    sortOrder: 30,
  },
  {
    key: "table",
    label: "Table",
    description: "Seat has a fixed table — usually a facing bay.",
    valueType: "boolean",
    icon: "pi pi-table",
    sortOrder: 40,
  },
  {
    key: "extra_legroom",
    label: "Extra legroom",
    description: "More space in front than a standard seat.",
    valueType: "boolean",
    icon: "pi pi-arrows-v",
    sortOrder: 50,
  },
];

/**
 * Madhumati runs Rajshahi to Bhanga in a day. The station order comes from the
 * operator's own seat-allocation board.
 */
const MADHUMATI_ROUTE = [
  ["RJS", null, "15:00", 0, 0],
  ["ISD", "16:05", "16:10", 0, 78],
  ["BRM", "16:50", "16:52", 0, 115],
  ["PDH", "17:15", "17:18", 0, 136],
  ["KTC", "17:35", "17:38", 0, 150],
  ["RJB", "18:45", "18:50", 0, 218],
  ["FDP", "19:25", "19:28", 0, 247],
  ["BNG", "20:00", null, 0, 276],
];

/**
 * Ekota runs overnight — it leaves Dhaka before midnight and arrives the next
 * morning, so every stop from Bangabandhu Setu East onward sits on day 1. This
 * is the case that breaks any model without a day offset.
 */
const EKOTA_ROUTE = [
  ["DHK", null, "22:00", 0, 0],
  ["JYD", "22:40", "22:43", 0, 33],
  ["TAN", "23:35", "23:38", 0, 97],
  ["BBSE", "00:05", "00:08", 1, 118],
  ["SMA", "00:30", "00:33", 1, 140],
  ["ISD", "01:40", "01:45", 1, 219],
  ["NTR", "02:20", "02:23", 1, 262],
  ["STH", "03:05", "03:10", 1, 304],
  ["JPR", "03:50", "03:53", 1, 345],
  ["PBT", "05:20", "05:30", 1, 424],
  ["DNJ", "06:15", null, 1, 470],
];

/** Which train each route belongs to, and the numbers it runs under. */
const ROUTES = [
  ["Madhumati Express", MADHUMATI_ROUTE, { code: "755/756", upCode: "755", downCode: "756" }],
  ["Ekota Express", EKOTA_ROUTE, { code: "705/706", upCode: "705", downCode: "706" }],
];

/** Per-kilometre fallbacks, one per class. These catch every pair no table lists. */
const DISTANCE_RATES = [
  ["Shovon", 1.1, 35],
  ["Shovon Chair", 1.3, 45],
  ["Non-AC Cabin", 2.0, 100],
  ["Snigdha", 2.5, 120],
  ["AC Chair", 2.6, 130],
  ["AC Cabin", 3.9, 200],
];

/**
 * A published price table for one train, to show an override beating the
 * fallback on exactly the pairs it lists and nowhere else.
 */
const PUBLISHED_TABLE = {
  name: "Madhumati — published Shovon Chair fares",
  train: "Madhumati Express",
  coachClass: "Shovon Chair",
  pairs: [
    ["RJS", "ISD", 120],
    ["RJS", "KTC", 210],
    ["RJS", "RJB", 300],
    ["RJS", "FDP", 340],
    ["RJS", "BNG", 380],
    ["ISD", "BNG", 300],
    ["KTC", "BNG", 240],
  ],
};

/** Route rows as `trainService.setRoute` takes them. */
const toStops = (route, stationIds) =>
  route.map(([code, arrivalTime, departureTime, dayOffset, distanceKm]) => ({
    stationId: stationIds.get(code),
    arrivalTime,
    departureTime,
    dayOffset,
    distanceKm,
  }));

async function run() {
  await sequelize.authenticate();

  // ---- Stations ----
  const stationIds = new Map();
  let newStations = 0;
  for (const [code, name, district] of STATIONS) {
    const [row, created] = await Station.findOrCreate({
      where: { code },
      defaults: { code, name, district },
    });
    if (created) newStations++;
    stationIds.set(code, row.id);
  }
  console.log(`✅ Stations: ${STATIONS.length} total (${newStations} new)`);

  // ---- Seat attribute catalogue ----
  const existingAttributes = await seatAttributeService.list({ includeInactive: true });
  const byKey = new Map(existingAttributes.map((a) => [a.key, a]));
  let newAttributes = 0;
  for (const attribute of SEAT_ATTRIBUTES) {
    if (byKey.has(attribute.key)) {
      await seatAttributeService.update(byKey.get(attribute.key).id, attribute);
    } else {
      await seatAttributeService.create(attribute);
      newAttributes++;
    }
  }
  console.log(`✅ Seat attributes: ${SEAT_ATTRIBUTES.length} total (${newAttributes} new)`);

  // ---- Routes ----
  for (const [trainName, route, identity] of ROUTES) {
    const train = await TrainName.findOne({ where: { name: trainName } });
    if (!train) {
      console.warn(`⚠️  ${trainName} not found — run seed:seatplans first. Skipping its route.`);
      continue;
    }
    await trainService.update(train.id, identity);
    const saved = await trainService.setRoute(train.id, toStops(route, stationIds));
    const hours = (saved.journeyMinutes / 60).toFixed(1);
    const overnight = saved.stops.some((s) => s.dayOffset > 0);
    console.log(
      `✅ Route: ${trainName} — ${saved.stops.length} stops, ${saved.segments.length} segments, ` +
        `${hours}h${overnight ? " (overnight)" : ""}`
    );
  }

  // ---- Fare rule chain ----
  const classes = await CoachClass.findAll();
  const classIds = new Map(classes.map((c) => [c.name, c.id]));
  let newRules = 0;

  for (const [className, ratePerKm, minFare] of DISTANCE_RATES) {
    const coachClassId = classIds.get(className);
    if (!coachClassId) continue;

    const name = `${className} — per kilometre`;
    const existing = await FareRule.findOne({ where: { name, trainId: null } });
    if (existing) {
      await fareService.updateRule(existing.id, { ratePerKm, minFare, priority: 200 });
    } else {
      await fareService.createRule({
        name,
        kind: "distance",
        priority: 200, // Runs last: the fallback everything else overrides.
        coachClassId,
        ratePerKm,
        minFare,
      });
      newRules++;
    }
  }
  console.log(`✅ Fare rules: ${DISTANCE_RATES.length} per-kilometre fallbacks (${newRules} new)`);

  // The published price table.
  const madhumati = await TrainName.findOne({ where: { name: PUBLISHED_TABLE.train } });
  const shovonChairId = classIds.get(PUBLISHED_TABLE.coachClass);

  if (madhumati && shovonChairId) {
    const { name } = PUBLISHED_TABLE;
    let rule = await FareRule.findOne({ where: { name } });
    if (!rule) {
      const created = await fareService.createRule({
        name,
        kind: "table",
        priority: 10, // Beats the per-kilometre fallback.
        trainId: madhumati.id,
        coachClassId: shovonChairId,
      });
      rule = await FareRule.findByPk(created.id);
    }

    const pair = (from, to, amount) => ({
      fromStationId: stationIds.get(from),
      toStationId: stationIds.get(to),
      amount,
    });

    await fareService.setTableEntries(rule.id, PUBLISHED_TABLE.pairs.map((p) => pair(...p)));
    console.log(`✅ Fare table: Madhumati Shovon Chair — ${PUBLISHED_TABLE.pairs.length} published pairs`);
  }

  console.log(
    "\nNote: station order is real; times and distances are illustrative and " +
      "should be replaced with operator data before selling against them."
  );

  await sequelize.close();
  process.exit(0);
}

// Run only when invoked as a script. The data and helpers above are also used
// by the super admin's "Populate demo data" button (services/demoService.js).
if (require.main === module) {
  run().catch((err) => {
    console.error("❌ Network seeding failed:", err.message);
    process.exit(1);
  });
}

module.exports = { STATIONS, SEAT_ATTRIBUTES, ROUTES, DISTANCE_RATES, PUBLISHED_TABLE, toStops };
