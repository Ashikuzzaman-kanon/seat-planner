const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseClock,
  clockText,
  parseDuration,
  runningDays,
  buildStops,
  fastestSegments,
  estimateDistances,
} = require("../../src/utils/timetable");
const { validateRoute } = require("../../src/utils/routeRules");

/** A published stop, as the railway's timetable writes it. */
const row = (city, arrival, departure) => ({
  city,
  arrival_time: arrival ? `${arrival} BST` : null,
  departure_time: departure ? `${departure} BST` : null,
});

const coherent = (stops) =>
  validateRoute(stops.map((s, i) => ({ ...s, stationId: i + 1 })));

test("12-hour clock times become minutes, noon and midnight included", () => {
  assert.equal(parseClock("03:00 pm BST"), 15 * 60);
  assert.equal(parseClock("12:05 am BST"), 5);
  assert.equal(parseClock("12:30 pm"), 12 * 60 + 30);
  assert.equal(parseClock("11:59 PM BST"), 23 * 60 + 59);
  assert.equal(parseClock("---"), null);
  assert.equal(parseClock(null), null);
  assert.equal(clockText(15 * 60 + 5), "15:05");
  assert.equal(clockText(1440 + 30), "00:30");
  assert.equal(parseDuration("07:30"), 450);
  assert.equal(parseDuration("---"), null);
});

test("running days are week-day numbers, Sunday first", () => {
  assert.deepEqual(runningDays(["Fri", "Sun", "Mon", "Tue", "Wed", "Thu"]), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(runningDays(["Sat", "Sat", "Funday"]), [6]);
});

test("a same-day route keeps its published times, with halts", () => {
  const { stops, notes } = buildStops([
    row("Dhaka", null, "10:15 am"),
    row("Biman_Bandar", "10:38 am", "10:43 am"),
    row("Panchagarh", "09:00 pm", null),
  ]);
  assert.deepEqual(
    stops.map((s) => [s.city, s.arrivalTime, s.departureTime, s.dayOffset, s.haltMinutes]),
    [
      ["Dhaka", null, "10:15", 0, null],
      ["Biman_Bandar", "10:38", "10:43", 0, 5],
      ["Panchagarh", "21:00", null, 0, null],
    ]
  );
  assert.deepEqual(notes, []);
  assert.deepEqual(coherent(stops), []);
});

test("crossing midnight between stops moves the rest of the route to the next day", () => {
  const { stops } = buildStops([
    row("Dhaka", null, "09:45 pm"),
    row("Ishwardi", "02:10 am", "02:15 am"),
    row("Lalmonirhat", "07:20 am", null),
  ]);
  assert.deepEqual(stops.map((s) => s.dayOffset), [0, 1, 1]);
  assert.deepEqual(coherent(stops), []);
});

test("a terminus reached after midnight is on the next day — the case the first import got wrong", () => {
  const { stops } = buildStops([row("Khulna", null, "09:15 pm"), row("Dhaka", "12:40 am", null)]);
  assert.equal(stops[1].dayOffset, 1);
  assert.deepEqual(coherent(stops), []);
});

test("a halt that spans midnight keeps its departure and arrives at 00:00", () => {
  const { stops, notes } = buildStops([
    row("Khulna", null, "09:00 pm"),
    row("Chuadanga", "11:57 pm", "12:00 am"),
    row("Chilahati", "06:30 am", null),
  ]);
  assert.equal(stops[1].arrivalTime, "00:00");
  assert.equal(stops[1].departureTime, "00:00");
  assert.equal(stops[1].dayOffset, 1);
  assert.match(notes[0], /Chuadanga: the halt spans midnight/);
  assert.deepEqual(coherent(stops), []);
});

test("departing before arriving keeps the arrival and says so", () => {
  const { stops, notes } = buildStops([
    row("Sylhet", null, "07:00 am"),
    row("Shaistaganj", "08:57 am", "08:20 am"),
    row("Dhaka", "01:40 pm", null),
  ]);
  assert.equal(stops[1].departureTime, "08:57");
  assert.match(notes[0], /departs 08:20 before it arrives 08:57/);
  assert.deepEqual(coherent(stops), []);
});

test("a single published time out of order is the stop left out, not its neighbour's time raised", () => {
  const { stops, notes } = buildStops([
    row("Rajshahi", null, "03:30 pm"),
    row("Kalukhali", "07:10 pm", "07:12 pm"),
    row("Naliagram", "07:40 pm", null),
    row("Baharpur", "07:26 pm", "07:28 pm"),
    row("Gobra", "10:10 pm", null),
  ]);
  assert.deepEqual(stops.map((s) => s.city), ["Rajshahi", "Kalukhali", "Baharpur", "Gobra"]);
  assert.equal(stops[2].departureTime, "19:28", "Baharpur keeps its own departure");
  assert.match(notes[0], /Naliagram: publishes a single time \(19:40\)/);
});

test("otherwise a small step backwards is raised to the time before it", () => {
  const { stops, notes } = buildStops([
    row("Gopalganj", null, "08:00 pm"),
    row("Borashi", "09:49 pm", "09:51 pm"),
    row("Khatra", "09:49 pm", "09:50 pm"),
    row("Gobra", "10:10 pm", null),
  ]);
  assert.equal(stops[2].arrivalTime, "21:51");
  assert.equal(notes.length, 2);
  assert.deepEqual(coherent(stops), []);
});

test("a station listed twice in a row is one stop", () => {
  const { stops, notes } = buildStops([
    row("Bogura", null, "03:05 pm"),
    row("Bonar_Para", null, "04:03 pm"),
    row("Bonar_Para", "03:58 pm", "04:03 pm"),
    row("Gaibandha", "04:28 pm", null),
  ]);
  assert.deepEqual(stops.map((s) => [s.city, s.arrivalTime, s.departureTime]), [
    ["Bogura", null, "15:05"],
    ["Bonar_Para", "15:58", "16:03"],
    ["Gaibandha", "16:28", null],
  ]);
  assert.match(notes[0], /listed twice/);
});

test("distances come from the fastest running time on any train, so trains agree", () => {
  const slow = buildStops([row("A", null, "10:00 am"), row("B", "11:00 am", "11:05 am"), row("C", "11:35 am", null)]).stops;
  const fast = buildStops([row("C", null, "01:00 pm"), row("B", "01:20 pm", "01:22 pm"), row("A", "02:05 pm", null)]).stops;
  const fastest = fastestSegments([slow, fast]);
  assert.deepEqual(estimateDistances(slow, fastest), [0, 43, 63]);
  assert.deepEqual(estimateDistances(fast, fastest), [0, 20, 63], "the reverse journey is just as long");
});
