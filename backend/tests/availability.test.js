const test = require("node:test");
const assert = require("node:assert/strict");

const {
  UNAVAILABLE,
  segmentsBetween,
  journeysOverlap,
  isFree,
  quotaPermits,
  matchesFilters,
  computeAvailability,
  summarise,
} = require("../src/utils/availability");

/**
 * The route used throughout: A(1) - B(2) - C(3) - D(4), giving segments
 *   0 = A→B,  1 = B→C,  2 = C→D
 * These are the examples from REQUIREMENTS §6, asserted directly.
 */
const A = 1, B = 2, C = 3, D = 4;
const STATION = { A: 101, B: 102, C: 103, D: 104 };

const seat = (id, attributes = {}) => ({ id, seatNumber: String(id), attributes });

/** Station id -> route stop sequence, so a reservation can be read as a stretch. */
const SEQ = new Map([
  [STATION.A, A], [STATION.B, B], [STATION.C, C], [STATION.D, D],
]);
const askQuota = (quota, fromStationId, toStationId, extra = {}) =>
  quotaPermits(quota, {
    fromStationId,
    toStationId,
    fromSequence: SEQ.get(fromStationId),
    toSequence: SEQ.get(toStationId),
    sequenceOf: SEQ,
    ...extra,
  });

/* ------------------------------------------------------------------ *
 * segmentsBetween
 * ------------------------------------------------------------------ */

test("segmentsBetween: adjacent stops occupy exactly one segment", () => {
  assert.deepEqual(segmentsBetween(A, B), [0]);
  assert.deepEqual(segmentsBetween(B, C), [1]);
  assert.deepEqual(segmentsBetween(C, D), [2]);
});

test("segmentsBetween: a longer journey occupies every segment it crosses", () => {
  assert.deepEqual(segmentsBetween(A, C), [0, 1]);
  assert.deepEqual(segmentsBetween(B, D), [1, 2]);
  assert.deepEqual(segmentsBetween(A, D), [0, 1, 2]);
});

test("segmentsBetween: refuses a journey that does not move forward", () => {
  assert.throws(() => segmentsBetween(C, A), /after the origin/);
  assert.throws(() => segmentsBetween(B, B), /after the origin/);
});

test("segmentsBetween: refuses non-integer sequences", () => {
  assert.throws(() => segmentsBetween(1.5, 3), /integers/);
  assert.throws(() => segmentsBetween(null, 3), /integers/);
});

/* ------------------------------------------------------------------ *
 * journeysOverlap — the half-open interval rule
 * ------------------------------------------------------------------ */

test("journeysOverlap: journeys meeting end to end do not overlap", () => {
  // This is precisely why A→B and C→D can both sell the same seat
  // after B→C has been sold.
  assert.equal(journeysOverlap(A, B, B, C), false);
  assert.equal(journeysOverlap(B, C, C, D), false);
});

test("journeysOverlap: a containing journey overlaps a contained one", () => {
  assert.equal(journeysOverlap(A, D, B, C), true);
  assert.equal(journeysOverlap(B, C, A, D), true);
});

test("journeysOverlap: partially crossing journeys overlap", () => {
  assert.equal(journeysOverlap(A, C, B, D), true);
});

test("journeysOverlap: disjoint journeys do not overlap", () => {
  assert.equal(journeysOverlap(A, B, C, D), false);
});

/* ------------------------------------------------------------------ *
 * isFree
 * ------------------------------------------------------------------ */

test("isFree: a seat with nothing sold is free for anything", () => {
  assert.equal(isFree(new Set(), segmentsBetween(A, D)), true);
});

test("isFree: one taken segment blocks any journey crossing it", () => {
  const occupied = new Set([1]); // B→C sold
  assert.equal(isFree(occupied, segmentsBetween(B, C)), false);
  assert.equal(isFree(occupied, segmentsBetween(A, C)), false);
  assert.equal(isFree(occupied, segmentsBetween(A, D)), false);
});

test("isFree: the worked example — B→C sold leaves A→B and C→D on sale", () => {
  const occupied = new Set([1]);
  assert.equal(isFree(occupied, segmentsBetween(A, B)), true);
  assert.equal(isFree(occupied, segmentsBetween(C, D)), true);
});

test("isFree: the worked example — A→C sold leaves only C→D", () => {
  const occupied = new Set([0, 1]);
  assert.equal(isFree(occupied, segmentsBetween(C, D)), true);
  assert.equal(isFree(occupied, segmentsBetween(A, B)), false);
  assert.equal(isFree(occupied, segmentsBetween(B, C)), false);
  assert.equal(isFree(occupied, segmentsBetween(B, D)), false);
});

test("isFree: A→D sold leaves nothing", () => {
  const occupied = new Set([0, 1, 2]);
  for (const [from, to] of [[A, B], [B, C], [C, D], [A, C], [B, D], [A, D]]) {
    assert.equal(isFree(occupied, segmentsBetween(from, to)), false, `${from}->${to}`);
  }
});

/* ------------------------------------------------------------------ *
 * quotaPermits
 * ------------------------------------------------------------------ */

test("quotaPermits: a seat with no quota is open for any pair", () => {
  assert.equal(askQuota(null, STATION.A, STATION.D), true);
});

test("quotaPermits: a reserved seat sells as its exact pair", () => {
  const quota = { fromStationId: STATION.A, toStationId: STATION.C };
  assert.equal(askQuota(quota, STATION.A, STATION.C), true);
});

test("quotaPermits: journeys inside the reserved stretch are refused", () => {
  // "Exact only": a hold for A->C is not sellable as a shorter piece of itself.
  const quota = { fromStationId: STATION.A, toStationId: STATION.C };
  assert.equal(askQuota(quota, STATION.A, STATION.B), false);
  assert.equal(askQuota(quota, STATION.B, STATION.C), false);
});

test("quotaPermits: journeys merely crossing the reserved stretch are refused", () => {
  const quota = { fromStationId: STATION.A, toStationId: STATION.C };
  assert.equal(askQuota(quota, STATION.A, STATION.D), false);
  assert.equal(askQuota(quota, STATION.B, STATION.D), false);
});

test("quotaPermits: a reservation does not reach past its own stretch", () => {
  // A hold for A->C says nothing about C->D: they never share a segment, so the
  // same seat serves both. Refusing here would hold a seat empty over track it
  // was never reserved for.
  const quota = { fromStationId: STATION.A, toStationId: STATION.C };
  assert.equal(askQuota(quota, STATION.C, STATION.D), true);
});

test("quotaPermits: a reservation at the far end leaves the near end alone", () => {
  const quota = { fromStationId: STATION.C, toStationId: STATION.D };
  assert.equal(askQuota(quota, STATION.A, STATION.B), true);
  assert.equal(askQuota(quota, STATION.B, STATION.C), true);
  assert.equal(askQuota(quota, STATION.C, STATION.D), true);
  assert.equal(askQuota(quota, STATION.A, STATION.D), false);
});

test("quotaPermits: a released reservation behaves as open", () => {
  const quota = { fromStationId: STATION.A, toStationId: STATION.C, releasedAt: new Date() };
  assert.equal(askQuota(quota, STATION.B, STATION.D), true);
});

test("quotaPermits: a reservation past its release time behaves as open", () => {
  const quota = {
    fromStationId: STATION.A,
    toStationId: STATION.C,
    releaseAt: new Date("2026-01-01T00:00:00Z"),
  };
  assert.equal(askQuota(quota, STATION.B, STATION.D, { now: new Date("2026-01-02T00:00:00Z") }), true);
});

test("quotaPermits: a reservation before its release time still holds", () => {
  const quota = {
    fromStationId: STATION.A,
    toStationId: STATION.C,
    releaseAt: new Date("2026-01-03T00:00:00Z"),
  };
  assert.equal(askQuota(quota, STATION.B, STATION.D, { now: new Date("2026-01-02T00:00:00Z") }), false);
  assert.equal(askQuota(quota, STATION.A, STATION.C, { now: new Date("2026-01-02T00:00:00Z") }), true);
});

test("quotaPermits: station ids compare by value, not by type", () => {
  const quota = { fromStationId: "101", toStationId: "103" };
  assert.equal(askQuota(quota, 101, 103), true);
});

/* ------------------------------------------------------------------ *
 * matchesFilters
 * ------------------------------------------------------------------ */

test("matchesFilters: no filters matches everything", () => {
  assert.equal(matchesFilters(seat(1), null), true);
  assert.equal(matchesFilters(seat(1), {}), true);
});

test("matchesFilters: true means the attribute must be present", () => {
  assert.equal(matchesFilters(seat(1, { charging_port: true }), { charging_port: true }), true);
  assert.equal(matchesFilters(seat(1, {}), { charging_port: true }), false);
});

test("matchesFilters: a specific value must match exactly", () => {
  const full = seat(1, { window: "full" });
  assert.equal(matchesFilters(full, { window: "full" }), true);
  assert.equal(matchesFilters(full, { window: "half" }), false);
  // `true` means any window, so a full window satisfies it.
  assert.equal(matchesFilters(full, { window: true }), true);
});

test("matchesFilters: falsey filter values are ignored, not treated as required", () => {
  const plain = seat(1, {});
  assert.equal(matchesFilters(plain, { charging_port: false }), true);
  assert.equal(matchesFilters(plain, { window: "" }), true);
  assert.equal(matchesFilters(plain, { fan: undefined }), true);
});

test("matchesFilters: every requested attribute must hold", () => {
  const both = seat(1, { window: "full", charging_port: true });
  assert.equal(matchesFilters(both, { window: true, charging_port: true }), true);
  assert.equal(matchesFilters(both, { window: true, fan: true }), false);
});

test("matchesFilters: an attribute not yet in the catalogue simply fails to match", () => {
  assert.equal(matchesFilters(seat(1, {}), { extra_legroom: true }), false);
});

/* ------------------------------------------------------------------ *
 * computeAvailability — the whole rule set together
 * ------------------------------------------------------------------ */

test("computeAvailability: the headline case, seat by seat", () => {
  const seats = [seat(1), seat(2), seat(3)];
  // Seat 2 is sold B→C.
  const occupancy = new Map([[2, new Set([1])]]);

  const bToC = computeAvailability({
    seats, occupancy, fromSequence: B, toSequence: C,
    fromStationId: STATION.B, toStationId: STATION.C, sequenceOf: SEQ,
  });
  assert.deepEqual(bToC.available.map((s) => s.id), [1, 3]);

  // The two ends stay on sale, including seat 2.
  for (const [from, to, fromId, toId] of [
    [A, B, STATION.A, STATION.B],
    [C, D, STATION.C, STATION.D],
  ]) {
    const result = computeAvailability({
      seats, occupancy, fromSequence: from, toSequence: to,
      fromStationId: fromId, toStationId: toId, sequenceOf: SEQ,
    });
    assert.deepEqual(result.available.map((s) => s.id), [1, 2, 3], `${from}->${to}`);
  }

  // But an overlapping journey cannot have seat 2.
  const aToD = computeAvailability({
    seats, occupancy, fromSequence: A, toSequence: D,
    fromStationId: STATION.A, toStationId: STATION.D, sequenceOf: SEQ,
  });
  assert.deepEqual(aToD.available.map((s) => s.id), [1, 3]);
});

test("computeAvailability: reports why each seat was withheld", () => {
  const seats = [seat(1), seat(2), seat(3), seat(4, { window: "full" })];
  const result = computeAvailability({
    seats,
    occupancy: new Map([[1, new Set([0])]]),
    // Held for A->C, which does overlap the A->B being asked about.
    quotas: new Map([[2, { fromStationId: STATION.A, toStationId: STATION.C }]]),
    blocked: new Set([3]),
    fromSequence: A, toSequence: B,
    fromStationId: STATION.A, toStationId: STATION.B,
    sequenceOf: SEQ,
    filters: { window: true },
  });

  assert.deepEqual(result.available.map((s) => s.id), [4]);
  assert.deepEqual(summarise(result.unavailable), {
    [UNAVAILABLE.OCCUPIED]: 1,
    [UNAVAILABLE.QUOTA]: 1,
    [UNAVAILABLE.BLOCKED]: 1,
  });
});

test("computeAvailability: a hold elsewhere on the route withholds nothing here", () => {
  const seats = [seat(1), seat(2)];
  // Seat 2 is held for C->D. Asking about A->B, which never touches it.
  const result = computeAvailability({
    seats,
    quotas: new Map([[2, { fromStationId: STATION.C, toStationId: STATION.D }]]),
    fromSequence: A, toSequence: B,
    fromStationId: STATION.A, toStationId: STATION.B,
    sequenceOf: SEQ,
  });

  assert.deepEqual(result.available.map((s) => s.id), [1, 2]);
  assert.deepEqual(result.unavailable, []);
});

test("computeAvailability: a filtered-out seat is distinguished from an unavailable one", () => {
  const seats = [seat(1, { window: "full" }), seat(2, {})];
  const result = computeAvailability({
    seats, fromSequence: A, toSequence: B,
    fromStationId: STATION.A, toStationId: STATION.B,
    sequenceOf: SEQ,
    filters: { window: true },
  });

  assert.deepEqual(result.available.map((s) => s.id), [1]);
  assert.equal(result.unavailable[0].reason, UNAVAILABLE.FILTER);
});

test("computeAvailability: a quota seat is offered for its own pair", () => {
  const seats = [seat(1)];
  const quotas = new Map([[1, { fromStationId: STATION.A, toStationId: STATION.C }]]);

  const matching = computeAvailability({
    seats, quotas, fromSequence: A, toSequence: C,
    fromStationId: STATION.A, toStationId: STATION.C, sequenceOf: SEQ,
  });
  assert.equal(matching.available.length, 1);

  const other = computeAvailability({
    seats, quotas, fromSequence: A, toSequence: B,
    fromStationId: STATION.A, toStationId: STATION.B, sequenceOf: SEQ,
  });
  assert.equal(other.available.length, 0);
});

test("computeAvailability: returns the segments the journey needs", () => {
  const result = computeAvailability({
    seats: [], fromSequence: A, toSequence: D,
    fromStationId: STATION.A, toStationId: STATION.D, sequenceOf: SEQ,
  });
  assert.deepEqual(result.segments, [0, 1, 2]);
});

test("computeAvailability: an empty departure yields nothing but does not throw", () => {
  const result = computeAvailability({
    seats: [], fromSequence: A, toSequence: B,
    fromStationId: STATION.A, toStationId: STATION.B, sequenceOf: SEQ,
  });
  assert.deepEqual(result.available, []);
  assert.deepEqual(result.unavailable, []);
});

/* ------------------------------------------------------------------ *
 * A longer route, to catch off-by-one errors the 4-stop case hides
 * ------------------------------------------------------------------ */

test("an 11-stop route: segment maths holds across the whole length", () => {
  const stops = 11;
  assert.deepEqual(segmentsBetween(1, stops), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(segmentsBetween(1, stops).length, stops - 1);

  // Every adjacent pair is exactly one segment, in order.
  for (let s = 1; s < stops; s++) {
    assert.deepEqual(segmentsBetween(s, s + 1), [s - 1]);
  }
});

test("an 11-stop route: a middle sale leaves both ends sellable", () => {
  const seats = [seat(1)];
  // Sold from stop 4 to stop 7 -> segments 3,4,5.
  const occupancy = new Map([[1, new Set([3, 4, 5])]]);

  const before = computeAvailability({
    seats, occupancy, fromSequence: 1, toSequence: 4,
    fromStationId: 1, toStationId: 4,
  });
  const after = computeAvailability({
    seats, occupancy, fromSequence: 7, toSequence: 11,
    fromStationId: 7, toStationId: 11,
  });
  const across = computeAvailability({
    seats, occupancy, fromSequence: 3, toSequence: 9,
    fromStationId: 3, toStationId: 9,
  });

  assert.equal(before.available.length, 1, "stop 1->4 should still be sellable");
  assert.equal(after.available.length, 1, "stop 7->11 should still be sellable");
  assert.equal(across.available.length, 0, "a journey crossing the sold stretch must not be");
});
