const test = require("node:test");
const assert = require("node:assert/strict");

const { LAYOUTS, RAKES, RAKE_SEATS } = require("../../src/data/railway/seatPlans");
const { buildLayout } = require("../../src/seeders/importSeatPlans");
const { countSeats } = require("../../src/utils/seatMaterializer");
const timetable = require("../../src/data/railway/timetable.json");

const numbers = new Set(timetable.trains.map((t) => t.number));
const seats = new Map(LAYOUTS.map((l) => [l.key, countSeats(buildLayout({ ...l, train: l.key }))]));

test("every transcription produces exactly the seats its source shows", () => {
  for (const l of LAYOUTS) assert.equal(seats.get(l.key), l.seats, l.key);
});

test("layout keys are unique, and a coach number is unique per train", () => {
  assert.equal(new Set(LAYOUTS.map((l) => l.key)).size, LAYOUTS.length);
  const perTrain = new Set();
  for (const l of LAYOUTS) {
    for (const n of l.trains.length ? l.trains : ["draft"]) {
      const key = `${n}:${l.coachNo}`;
      assert.ok(!perTrain.has(key), `two plans would be ${key}`);
      perTrain.add(key);
    }
  }
});

test("every train a plan names is in the timetable", () => {
  for (const l of LAYOUTS) for (const n of l.trains) assert.ok(numbers.has(n), `${l.key}: train ${n}`);
});

test("a plan for an unnamed train is a draft that assumes nothing it was not shown", () => {
  const drafts = LAYOUTS.filter((l) => !l.trains.length);
  assert.equal(drafts.length, 8);
  const plates = drafts.find((l) => l.key === "berth-plates-40");
  assert.equal(plates.coachType, null);
  assert.equal(plates.coachClass, null);
});

test("every ready train carries 300–400 seats, from its own plans", () => {
  const seen = new Set();
  for (const rake of RAKES) {
    const total = rake.coaches.reduce((n, [, key]) => n + seats.get(key), 0);
    assert.ok(total >= RAKE_SEATS.min && total <= RAKE_SEATS.max, `${rake.trains.join("/")}: ${total}`);
    assert.equal(new Set(rake.coaches.map(([code]) => code)).size, rake.coaches.length, "coach codes repeat");
    for (const n of rake.trains) {
      assert.ok(!seen.has(n), `train ${n} is in two rakes`);
      seen.add(n);
      for (const [, key] of rake.coaches) {
        assert.ok(LAYOUTS.find((l) => l.key === key).trains.includes(n), `${key} is not linked to train ${n}`);
      }
    }
  }
  assert.equal(seen.size, 50);
});

test("the Silk City rake keeps the station board's letter for each class", () => {
  const rake = RAKES.find((r) => r.trains.includes(754));
  assert.deepEqual(
    rake.coaches.map(([code, key]) => `${code}:${key}`),
    [
      "KA:lhb-board-ac-cabin-48",
      "KHA:lhb-board-ac-cabin-48",
      "GHA:lhb-board-snigdha-78",
      "CHA:lhb-board-shovon-chair-105",
      "SCHA:lhb-board-shovon-chair-105",
    ]
  );
  assert.equal(rake.coaches.reduce((n, [, key]) => n + seats.get(key), 0), 384);
});
