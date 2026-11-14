/**
 * Refresh the timetable snapshot the railway loader builds stations, trains
 * and routes from (src/data/railway/timetable.json).
 *
 * The snapshot is committed rather than fetched at load time so that every
 * environment — a laptop, CI, production — loads exactly the same timetable,
 * and loading never depends on a third-party API being up. Run this when the
 * railway publishes a new timetable, review the diff, then load it. A running
 * server can also check with the railway and apply what changed itself
 * (Administration → Railway Data → Check with the railway).
 *
 * Responses are stored as the API sent them; every conversion (12-hour
 * times, day offsets, distances) happens in the loader, where it is tested.
 *
 *   node tools/railway/fetch-timetable.js [--date YYYY-MM-DD]
 */
const fs = require("fs");
const path = require("path");
const { sourceUrl, TRAIN_NUMBERS, fetchTrain, sleep } = require("../../src/data/railway/source");

const OUT = path.join(__dirname, "../../src/data/railway/timetable.json");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
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
  const snapshot = { source: sourceUrl(), requestedFor: date, fetchedAt: new Date().toISOString(), trains };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(snapshot, null, 1)}\n`);

  console.log(`\n${trains.length} trains written to ${path.relative(process.cwd(), OUT)}`);
  if (missing.length) console.log(`No timetable published for: ${missing.join(", ")}`);
}

main().catch((err) => {
  console.error(`Fetch failed: ${err.message}`);
  process.exit(1);
});
