/**
 * Refresh the timetable snapshot the railway loader builds stations, trains
 * and routes from (src/data/railway/timetable.json).
 *
 * The snapshot is committed rather than fetched at load time so that every
 * environment — a laptop, CI, production — loads exactly the same timetable,
 * and loading never depends on a third-party API being up. Run this when the
 * railway publishes a new timetable, review the diff, then load it.
 *
 * Responses are stored as the API sent them; every conversion (12-hour
 * times, day offsets, distances) happens in the loader, where it is tested.
 *
 *   node tools/railway/fetch-timetable.js [--date YYYY-MM-DD]
 */
const fs = require("fs");
const path = require("path");

const SOURCE = "https://railspaapi.shohoz.com/v1.0/web/train-routes";
const OUT = path.join(__dirname, "../../src/data/railway/timetable.json");

// The intercity, mail and commuter services the system carries.
const TRAIN_NUMBERS = [
  ...range(701, 806),
  809, 810, 813, 814, 815, 816, 821, 822, 823, 824, 825, 826, 827, 828,
  41, 42, 57, 58, 61, 62, 65, 66, 77, 78, 110, 135, 136,
  ...range(1001, 1016),
];

function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchTrain(number, date) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(SOURCE, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ model: String(number), departure_date_time: date }),
      });
      if (res.status === 404 || res.status === 422) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = await res.json();
      if (!data?.train_name || !Array.isArray(data.routes) || !data.routes.length) return null;
      return {
        number,
        name: data.train_name,
        days: data.days || [],
        totalDuration: data.total_duration || null,
        routes: data.routes.map((r) => ({
          city: r.city,
          arrival_time: r.arrival_time ?? null,
          departure_time: r.departure_time ?? null,
          halt: r.halt ?? null,
          duration: r.duration ?? null,
        })),
      };
    } catch (err) {
      if (attempt === 3) throw new Error(`train ${number}: ${err.message}`);
      await sleep(1000 * attempt);
    }
  }
  return null;
}

async function main() {
  const date = argValue("--date") || new Date().toISOString().slice(0, 10);
  const trains = [];
  const missing = [];

  for (const number of TRAIN_NUMBERS) {
    const train = await fetchTrain(number, date);
    if (train) trains.push(train);
    else missing.push(number);
    process.stdout.write(train ? "." : "x");
    await sleep(150);
  }

  trains.sort((a, b) => a.number - b.number);
  const snapshot = { source: SOURCE, requestedFor: date, fetchedAt: new Date().toISOString(), trains };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(snapshot, null, 1)}\n`);

  console.log(`\n${trains.length} trains written to ${path.relative(process.cwd(), OUT)}`);
  if (missing.length) console.log(`No timetable published for: ${missing.join(", ")}`);
}

main().catch((err) => {
  console.error(`Fetch failed: ${err.message}`);
  process.exit(1);
});
