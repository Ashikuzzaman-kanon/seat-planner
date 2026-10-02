const test = require("node:test");
const assert = require("node:assert/strict");

const { REFUSAL, connection, roomFor, fareFor, segmentsFor } = require("../../src/utils/standing");

/* ------------------------------------------------------------------ *
 * Contiguity
 *
 * Seated leg is stops 4 → 7 throughout, so "before" is anything ending at 4
 * and "after" is anything starting at 7.
 * ------------------------------------------------------------------ */

const SEAT = { seatFrom: 4, seatTo: 7 };

test("a leg ending exactly where the seat begins connects", () => {
  const r = connection({ ...SEAT, standFrom: 1, standTo: 4 });
  assert.equal(r.ok, true);
  assert.equal(r.position, "before");
});

test("a leg beginning exactly where the seat ends connects", () => {
  const r = connection({ ...SEAT, standFrom: 7, standTo: 11 });
  assert.equal(r.ok, true);
  assert.equal(r.position, "after");
});

test("a single segment either side is enough", () => {
  assert.equal(connection({ ...SEAT, standFrom: 3, standTo: 4 }).ok, true);
  assert.equal(connection({ ...SEAT, standFrom: 7, standTo: 8 }).ok, true);
});

test("a gap before the seat does not connect", () => {
  // Ends at 3, but the seat starts at 4 — one stop short.
  const r = connection({ ...SEAT, standFrom: 1, standTo: 3 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REFUSAL.NOT_CONTIGUOUS);
  assert.match(r.message, /join onto your seated leg/);
});

test("a gap after the seat does not connect", () => {
  const r = connection({ ...SEAT, standFrom: 8, standTo: 11 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REFUSAL.NOT_CONTIGUOUS);
});

test("a leg overlapping the seat is refused as pointless, not merely wrong", () => {
  // They already have a seat over 4→7; standing 5→9 would duplicate 5→7.
  const r = connection({ ...SEAT, standFrom: 5, standTo: 9 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REFUSAL.OVERLAPS_SEAT);
  assert.match(r.message, /already have a seat/);
});

test("a leg that swallows the seat is refused for the same reason", () => {
  const r = connection({ ...SEAT, standFrom: 1, standTo: 11 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REFUSAL.OVERLAPS_SEAT);
});

test("a leg entirely inside the seated stretch is refused", () => {
  const r = connection({ ...SEAT, standFrom: 5, standTo: 6 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REFUSAL.OVERLAPS_SEAT);
});

test("a leg exactly matching the seat is refused", () => {
  const r = connection({ ...SEAT, standFrom: 4, standTo: 7 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REFUSAL.OVERLAPS_SEAT);
});

test("a backwards leg is refused before anything else is considered", () => {
  const r = connection({ ...SEAT, standFrom: 7, standTo: 4 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REFUSAL.BACKWARDS);
});

test("a zero-length leg is refused", () => {
  assert.equal(connection({ ...SEAT, standFrom: 4, standTo: 4 }).reason, REFUSAL.BACKWARDS);
});

test("both sides of a seat may be taken, one leg at a time", () => {
  assert.equal(connection({ ...SEAT, standFrom: 1, standTo: 4 }).position, "before");
  assert.equal(connection({ ...SEAT, standFrom: 7, standTo: 11 }).position, "after");
});

/* ------------------------------------------------------------------ *
 * Capacity
 * ------------------------------------------------------------------ */

const occupancyOf = (pairs) => new Map(Object.entries(pairs).map(([k, v]) => [Number(k), v]));

test("an empty coach has its whole capacity free", () => {
  const r = roomFor({ capacity: 20, occupancy: new Map(), segments: [0, 1, 2] });
  assert.equal(r.ok, true);
  assert.equal(r.remaining, 20);
});

test("the tightest segment decides, not the average", () => {
  // Plenty of room on two segments, almost none on the third.
  const r = roomFor({
    capacity: 20,
    occupancy: occupancyOf({ 0: 2, 1: 19, 2: 3 }),
    segments: [0, 1, 2],
  });
  assert.equal(r.ok, true);
  assert.equal(r.remaining, 1);
  assert.equal(r.tightestSegment, 1);
});

test("a full segment blocks a leg that crosses it", () => {
  const r = roomFor({
    capacity: 20,
    occupancy: occupancyOf({ 0: 5, 1: 20, 2: 5 }),
    segments: [0, 1, 2],
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REFUSAL.FULL);
  assert.equal(r.remaining, 0);
});

test("but not a leg that avoids it", () => {
  const r = roomFor({
    capacity: 20,
    occupancy: occupancyOf({ 0: 5, 1: 20, 2: 5 }),
    segments: [2, 3],
  });
  assert.equal(r.ok, true);
  assert.equal(r.remaining, 15);
});

test("a class that sells no standing says so, rather than reporting itself full", () => {
  const r = roomFor({ capacity: 0, occupancy: new Map(), segments: [0] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REFUSAL.NOT_OFFERED);
  assert.match(r.message, /not sold/);
});

test("over-capacity data does not produce negative room", () => {
  // Should never happen, but a bad backfill must not sell tickets.
  const r = roomFor({ capacity: 10, occupancy: occupancyOf({ 0: 14 }), segments: [0] });
  assert.equal(r.ok, false);
  assert.equal(r.remaining, 0);
});

test("a plain object works as well as a Map", () => {
  const r = roomFor({ capacity: 10, occupancy: { 0: 3, 1: 4 }, segments: [0, 1] });
  assert.equal(r.ok, true);
  assert.equal(r.remaining, 6);
});

test("a leg covering nothing is refused", () => {
  assert.equal(roomFor({ capacity: 10, occupancy: new Map(), segments: [] }).ok, false);
});

test("exactly at capacity leaves no room", () => {
  const r = roomFor({ capacity: 5, occupancy: occupancyOf({ 0: 5 }), segments: [0] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REFUSAL.FULL);
});

test("one below capacity leaves exactly one", () => {
  const r = roomFor({ capacity: 5, occupancy: occupancyOf({ 0: 4 }), segments: [0] });
  assert.equal(r.ok, true);
  assert.equal(r.remaining, 1);
});

/* ------------------------------------------------------------------ *
 * Fare
 * ------------------------------------------------------------------ */

test("standing costs the configured share of the seated fare", () => {
  assert.equal(fareFor({ seatedFareMinor: 30000, percent: 50 }), 15000);
  assert.equal(fareFor({ seatedFareMinor: 30000, percent: 60 }), 18000);
});

test("it scales with distance because the seated fare already does", () => {
  const short = fareFor({ seatedFareMinor: 5000, percent: 50 });
  const long = fareFor({ seatedFareMinor: 50000, percent: 50 });
  assert.equal(long, short * 10);
});

test("a zero percent fare is free rather than negative", () => {
  assert.equal(fareFor({ seatedFareMinor: 30000, percent: 0 }), 0);
});

test("percentages outside 0-100 are clamped", () => {
  assert.equal(fareFor({ seatedFareMinor: 1000, percent: -20 }), 0);
  assert.equal(fareFor({ seatedFareMinor: 1000, percent: 500 }), 1000);
});

test("rounding never produces a fraction of a poisha", () => {
  for (const fare of [1, 33, 99, 12345, 99999]) {
    for (const percent of [10, 33, 50, 67, 99]) {
      const result = fareFor({ seatedFareMinor: fare, percent });
      assert.ok(Number.isInteger(result), `${fare} at ${percent}% gave ${result}`);
      assert.ok(result <= fare, `${fare} at ${percent}% gave more than the seated fare`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Segments
 * ------------------------------------------------------------------ */

test("segments are counted the same way seats count them", () => {
  // Stops 1→4 covers segments 0,1,2 — the same answer the seat inventory gives.
  assert.deepEqual(segmentsFor(1, 4), [0, 1, 2]);
  assert.deepEqual(segmentsFor(7, 8), [6]);
});
