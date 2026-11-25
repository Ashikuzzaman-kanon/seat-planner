const { test } = require("node:test");
const assert = require("node:assert/strict");
const { compareRoute, keepDistances, sameDays, droppedDays, weekdayOf } = require("../../src/utils/timetableDiff");

const stop = (station, arrivalTime, departureTime, dayOffset = 0, distanceKm = null) => ({ station, arrivalTime, departureTime, dayOffset, distanceKm });

const saved = [stop("Dhaka", null, "10:15:00", 0, 0), stop("Tangail", "12:05:00", "12:08:00", 0, 92), stop("Dinajpur", "19:50:00", null, 0, 413)];

test("the same stations and times are the same route", () => {
  const published = [stop("Dhaka", null, "10:15"), stop("Tangail", "12:05", "12:08"), stop("Dinajpur", "19:50", null)];
  assert.deepEqual(compareRoute(saved, published), { kind: "same" });
});

test("names compare without case", () => {
  const published = [stop("DHAKA", null, "10:15"), stop("tangail", "12:05", "12:08"), stop("Dinajpur", "19:50", null)];
  assert.equal(compareRoute(saved, published).kind, "same");
});

test("moved times on the same stations are a time change, stop by stop", () => {
  const published = [stop("Dhaka", null, "10:15"), stop("Tangail", "12:10", "12:13"), stop("Dinajpur", "19:50", null)];
  const result = compareRoute(saved, published);
  assert.equal(result.kind, "times");
  assert.deepEqual(result.stops, [
    { station: "Tangail", from: { arrival: "12:05", departure: "12:08", dayOffset: 0 }, to: { arrival: "12:10", departure: "12:13", dayOffset: 0 } },
  ]);
});

test("a stop moving to the next day is a time change", () => {
  const published = [stop("Dhaka", null, "10:15"), stop("Tangail", "12:05", "12:08"), stop("Dinajpur", "19:50", null, 1)];
  assert.equal(compareRoute(saved, published).stops[0].station, "Dinajpur");
});

test("an added or removed station is a station change, named", () => {
  const added = compareRoute(saved, [stop("Dhaka", null, "10:15"), stop("Joydebpur", "10:50", "10:53"), stop("Tangail", "12:05", "12:08"), stop("Dinajpur", "19:50", null)]);
  assert.deepEqual(added, { kind: "stations", added: ["Joydebpur"], removed: [], reordered: false });
  const removed = compareRoute(saved, [stop("Dhaka", null, "10:15"), stop("Dinajpur", "19:50", null)]);
  assert.deepEqual(removed, { kind: "stations", added: [], removed: ["Tangail"], reordered: false });
});

test("the same stations in another order are a station change too", () => {
  const result = compareRoute(saved, [stop("Tangail", null, "12:08"), stop("Dhaka", "13:00", "13:05"), stop("Dinajpur", "19:50", null)]);
  assert.deepEqual(result, { kind: "stations", added: [], removed: [], reordered: true });
});

test("a train with no saved route has a new one", () => {
  assert.deepEqual(compareRoute([], [stop("Dhaka", null, "10:15"), stop("Dinajpur", "19:50", null)]), { kind: "new_route", stops: 2 });
});

test("distances saved — corrected or estimated — are kept when the stations are the same", () => {
  const published = [stop("Dhaka", null, "10:20", 0, 0), stop("Tangail", "12:10", "12:13", 0, 95), stop("Dinajpur", "19:55", null, 0, 420)];
  assert.deepEqual(keepDistances(saved, published).map((s) => s.distanceKm), [0, 92, 413]);
  assert.equal(keepDistances(saved, published)[1].arrivalTime, "12:10");
});

test("running days compare as sets", () => {
  assert.equal(sameDays([5, 0, 1], [0, 1, 5]), true);
  assert.equal(sameDays([0, 1, 2], [0, 1]), false);
  assert.deepEqual(droppedDays([0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5]), [6]);
  assert.deepEqual(droppedDays([1, 2], [1, 2, 3]), []);
});

test("a date's weekday, Sunday first", () => {
  assert.equal(weekdayOf("2026-10-18"), 0);
  assert.equal(weekdayOf("2026-10-24"), 6);
});
