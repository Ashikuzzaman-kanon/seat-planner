const test = require("node:test");
const assert = require("node:assert/strict");

const {
  REFUND_TYPE,
  REFUSAL,
  policyFor,
  deductionPercentFor,
  applyDeduction,
  splitAcross,
  hoursUntil,
} = require("../../src/utils/refundPolicy");

const SLABS = [
  { hoursBefore: 96, deductionPercent: 10 },
  { hoursBefore: 48, deductionPercent: 25 },
  { hoursBefore: 24, deductionPercent: 50 },
  { hoursBefore: 12, deductionPercent: 75 },
  { hoursBefore: 0, deductionPercent: 100 },
];

const NOW = new Date("2026-10-01T06:00:00+06:00");
const inHours = (h) => new Date(NOW.getTime() + h * 3_600_000);

/* ------------------------------------------------------------------ *
 * Slabs
 * ------------------------------------------------------------------ */

test("a week out attracts the smallest deduction", () => {
  assert.equal(deductionPercentFor(SLABS, 168), 10);
});

test("the boundary belongs to the more generous slab", () => {
  assert.equal(deductionPercentFor(SLABS, 96), 10);
  assert.equal(deductionPercentFor(SLABS, 95.99), 25);
  assert.equal(deductionPercentFor(SLABS, 48), 25);
  assert.equal(deductionPercentFor(SLABS, 24), 50);
  assert.equal(deductionPercentFor(SLABS, 12), 75);
});

test("inside the narrowest slab, nothing comes back", () => {
  assert.equal(deductionPercentFor(SLABS, 1), 100);
  assert.equal(deductionPercentFor(SLABS, 0), 100);
});

test("slabs are sorted rather than trusted in the order given", () => {
  const jumbled = [
    { hoursBefore: 24, deductionPercent: 50 },
    { hoursBefore: 96, deductionPercent: 10 },
    { hoursBefore: 48, deductionPercent: 25 },
  ];
  assert.equal(deductionPercentFor(jumbled, 100), 10);
  assert.equal(deductionPercentFor(jumbled, 50), 25);
});

test("closer to departure than any slab anticipated keeps the strictest rule", () => {
  // No zero-hour catch-all: the tightest slab must still apply rather than
  // falling through to a full refund.
  const partial = [
    { hoursBefore: 96, deductionPercent: 10 },
    { hoursBefore: 48, deductionPercent: 25 },
  ];
  assert.equal(deductionPercentFor(partial, 1), 25);
});

test("no slabs at all refunds nothing rather than everything", () => {
  assert.equal(deductionPercentFor([], 500), 100);
  assert.equal(deductionPercentFor(null, 500), 100);
});

test("malformed slab rows are ignored, not allowed to poison the answer", () => {
  const messy = [
    { hoursBefore: "not a number", deductionPercent: 0 },
    null,
    { hoursBefore: 48, deductionPercent: 25 },
  ];
  assert.equal(deductionPercentFor(messy, 100), 25);
});

/* ------------------------------------------------------------------ *
 * The split
 * ------------------------------------------------------------------ */

test("deduction and refund always add back to the fare", () => {
  for (const fare of [1, 7, 99, 100, 12345, 999999]) {
    for (const percent of [0, 1, 10, 25, 33, 50, 75, 99, 100]) {
      const { deductionMinor, refundMinor } = applyDeduction(fare, percent);
      assert.equal(deductionMinor + refundMinor, fare, `${fare} at ${percent}%`);
    }
  }
});

test("a zero percent deduction returns the whole fare", () => {
  assert.deepEqual(applyDeduction(13000, 0), { deductionMinor: 0, refundMinor: 13000, percent: 0 });
});

test("a full deduction leaves nothing", () => {
  assert.deepEqual(applyDeduction(13000, 100), { deductionMinor: 13000, refundMinor: 0, percent: 100 });
});

test("percentages outside 0-100 are clamped rather than producing negative money", () => {
  assert.equal(applyDeduction(1000, -50).refundMinor, 1000);
  assert.equal(applyDeduction(1000, 500).refundMinor, 0);
  assert.equal(applyDeduction(1000, 500).deductionMinor, 1000);
});

test("splitting a fare across segments loses no poisha", () => {
  for (const total of [100, 101, 999, 13000, 12347]) {
    for (const parts of [1, 2, 3, 4, 7]) {
      const shares = splitAcross(total, parts);
      assert.equal(shares.length, parts);
      assert.equal(shares.reduce((a, b) => a + b, 0), total, `${total} over ${parts}`);
    }
  }
});

test("the remainder goes to the earliest segments", () => {
  assert.deepEqual(splitAcross(100, 3), [34, 33, 33]);
  assert.deepEqual(splitAcross(10, 4), [3, 3, 2, 2]);
});

/* ------------------------------------------------------------------ *
 * Convenient return
 * ------------------------------------------------------------------ */

const convenient = policyFor(REFUND_TYPE.CONVENIENT);

test("a week before departure refunds almost all of it", () => {
  const q = convenient.quote({
    fareMinor: 20000,
    departureInstant: inHours(168),
    slabs: SLABS,
    now: NOW,
  });
  assert.equal(q.ok, true);
  assert.equal(q.percent, 10);
  assert.equal(q.deductionMinor, 2000);
  assert.equal(q.refundMinor, 18000);
  assert.equal(q.immediate, true);
});

test("a day before, half of it", () => {
  const q = convenient.quote({
    fareMinor: 20000,
    departureInstant: inHours(24),
    slabs: SLABS,
    now: NOW,
  });
  assert.equal(q.percent, 50);
  assert.equal(q.refundMinor, 10000);
});

test("an hour before, nothing — and it says why", () => {
  const q = convenient.quote({
    fareMinor: 20000,
    departureInstant: inHours(1),
    slabs: SLABS,
    now: NOW,
  });
  assert.equal(q.ok, false);
  assert.equal(q.reason, REFUSAL.NOT_REFUNDABLE);
  assert.match(q.message, /100% deduction/);
  assert.match(q.message, /demand-based/i);
});

test("after the train has gone, the request is refused outright", () => {
  const q = convenient.quote({
    fareMinor: 20000,
    departureInstant: inHours(-1),
    slabs: SLABS,
    now: NOW,
  });
  assert.equal(q.ok, false);
  assert.equal(q.reason, REFUSAL.DEPARTED);
  assert.match(q.message, /already left/);
});

test("the message names the time remaining in units a person reads", () => {
  assert.match(
    convenient.quote({ fareMinor: 20000, departureInstant: inHours(168), slabs: SLABS, now: NOW }).message,
    /7 days/
  );
  assert.match(
    convenient.quote({ fareMinor: 20000, departureInstant: inHours(30), slabs: SLABS, now: NOW }).message,
    /30 hours/
  );
});

/* ------------------------------------------------------------------ *
 * Demand-based return
 * ------------------------------------------------------------------ */

const demand = policyFor(REFUND_TYPE.DEMAND);

const askDemand = (over = {}) =>
  demand.quote({
    fareMinor: 30000,
    segmentCount: 3,
    departureInstant: inHours(48),
    chargePercent: 10,
    now: NOW,
    ...over,
  });

test("nothing is promised up front", () => {
  const q = askDemand();
  assert.equal(q.ok, true);
  assert.equal(q.immediate, false);
  assert.equal(q.segmentCount, 3);
});

test("the ceiling is the fare less a flat processing charge", () => {
  const q = askDemand();
  assert.equal(q.percent, 10);
  assert.equal(q.deductionMinor, 3000);
  assert.equal(q.maximumMinor, 27000);
});

test("the charge does not move with time — that is the whole point", () => {
  // A week out and two hours out quote the same charge. Time decides what a
  // convenient return pays; whether the seat resells decides this one.
  const far = askDemand({ departureInstant: inHours(168) });
  const near = askDemand({ departureInstant: inHours(2) });

  assert.equal(far.percent, near.percent);
  assert.equal(far.maximumMinor, near.maximumMinor);
});

test("the charge is taken once, not once per segment", () => {
  const one = askDemand({ segmentCount: 1 });
  const five = askDemand({ segmentCount: 5 });
  assert.equal(one.maximumMinor, five.maximumMinor);
});

test("the segments add back to the fare, and the refunds to the ceiling", () => {
  for (const segmentCount of [1, 2, 3, 4, 7]) {
    const q = askDemand({ fareMinor: 10001, segmentCount });
    assert.equal(q.lines.reduce((t, l) => t + l.shareMinor, 0), 10001, `${segmentCount} shares`);
    assert.equal(
      q.lines.reduce((t, l) => t + l.refundMinor, 0),
      q.maximumMinor,
      `${segmentCount} refunds`
    );
  }
});

test("it is still offered close to departure, when convenient pays nothing", () => {
  const near = inHours(2);
  assert.equal(
    convenient.quote({ fareMinor: 20000, departureInstant: near, slabs: SLABS, now: NOW }).ok,
    false
  );
  assert.equal(askDemand({ departureInstant: near }).ok, true);
});

test("but not after the train has left", () => {
  const q = askDemand({ departureInstant: inHours(-1) });
  assert.equal(q.ok, false);
  assert.equal(q.reason, REFUSAL.DEPARTED);
});

test("a single-segment journey is one line, not zero", () => {
  const q = askDemand({ fareMinor: 5000, segmentCount: 1 });
  assert.equal(q.lines.length, 1);
  assert.equal(q.lines[0].shareMinor, 5000);
});

test("the message describes the bargain as all-or-nothing", () => {
  const q = askDemand();
  assert.match(q.message, /if it resells/i);
  assert.match(q.message, /nothing/i);
});

test("a charge that swallows the whole fare is refused rather than offered", () => {
  const q = askDemand({ fareMinor: 1000, chargePercent: 100 });
  assert.equal(q.ok, false);
  assert.equal(q.reason, REFUSAL.NOT_REFUNDABLE);
});

/* ------------------------------------------------------------------ *
 * Money floors and caps
 * ------------------------------------------------------------------ */

test("a floor lifts the charge on a cheap ticket", () => {
  // 10% of 50.00 is 5.00, which does not cover handling; the floor is 20.00.
  const { deductionMinor, refundMinor } = applyDeduction(5000, 10, { minMinor: 2000 });
  assert.equal(deductionMinor, 2000);
  assert.equal(refundMinor, 3000);
});

test("a cap holds the charge down on an expensive one", () => {
  // 10% of 9,000.00 is 900.00; the cap is 500.00.
  const { deductionMinor, refundMinor } = applyDeduction(900000, 10, { maxMinor: 50000 });
  assert.equal(deductionMinor, 50000);
  assert.equal(refundMinor, 850000);
});

test("between the two bounds the percentage is untouched", () => {
  const { deductionMinor } = applyDeduction(30000, 10, { minMinor: 2000, maxMinor: 50000 });
  assert.equal(deductionMinor, 3000);
});

test("a zero bound means no bound", () => {
  assert.equal(applyDeduction(5000, 10, { minMinor: 0, maxMinor: 0 }).deductionMinor, 500);
  assert.equal(applyDeduction(5000, 10).deductionMinor, 500);
});

test("a floor larger than the fare cannot produce a negative refund", () => {
  const { deductionMinor, refundMinor } = applyDeduction(1000, 10, { minMinor: 99999 });
  assert.equal(deductionMinor, 1000);
  assert.equal(refundMinor, 0);
});

test("bounded charges still add back to the fare exactly", () => {
  for (const fare of [1, 99, 5000, 30000, 900000]) {
    for (const bounds of [{}, { minMinor: 2000 }, { maxMinor: 500 }, { minMinor: 100, maxMinor: 900 }]) {
      const { deductionMinor, refundMinor } = applyDeduction(fare, 10, bounds);
      assert.equal(deductionMinor + refundMinor, fare, `${fare} with ${JSON.stringify(bounds)}`);
    }
  }
});

test("the floor applies to a convenient return too", () => {
  const q = convenient.quote({
    fareMinor: 5000,
    departureInstant: inHours(168),
    slabs: SLABS,
    bounds: { minMinor: 2000 },
    now: NOW,
  });
  assert.equal(q.deductionMinor, 2000, "10% of 50.00 should have been lifted to the 20.00 floor");
  assert.equal(q.refundMinor, 3000);
});

/* ------------------------------------------------------------------ *
 * Cancelled by the railway
 * ------------------------------------------------------------------ */

const disruption = policyFor(REFUND_TYPE.DISRUPTION);

test("a cancelled service returns the whole fare", () => {
  const q = disruption.quote({ fareMinor: 30000 });
  assert.equal(q.ok, true);
  assert.equal(q.refundMinor, 30000);
  assert.equal(q.deductionMinor, 0);
  assert.equal(q.percent, 0);
});

test("it pays at once, with no condition attached", () => {
  const q = disruption.quote({ fareMinor: 30000 });
  assert.equal(q.immediate, true);
  assert.match(q.message, /cancelled/i);
});

test("it still pays after the train was due to leave", () => {
  // A service cancelled an hour before departure leaves nobody with a ticket
  // worth anything, so unlike the other two this has no deadline.
  const q = disruption.quote({ fareMinor: 30000, departureInstant: inHours(-5), now: NOW });
  assert.equal(q.ok, true);
  assert.equal(q.refundMinor, 30000);
});

test("no deduction slab or bound applies to it", () => {
  const q = disruption.quote({ fareMinor: 5000, slabs: SLABS, bounds: { minMinor: 99999 } });
  assert.equal(q.refundMinor, 5000);
});

test("it is not something a passenger may ask for", () => {
  const { PASSENGER_POLICIES } = require("../../src/utils/refundPolicy");
  assert.ok(!PASSENGER_POLICIES.includes(REFUND_TYPE.DISRUPTION));
  assert.deepEqual([...PASSENGER_POLICIES].sort(), ["convenient", "demand"]);
});

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

test("policies are looked up by name so a fourth costs no branching", () => {
  assert.equal(policyFor("convenient").type, REFUND_TYPE.CONVENIENT);
  assert.equal(policyFor("demand").type, REFUND_TYPE.DEMAND);
  assert.equal(policyFor("disruption").type, REFUND_TYPE.DISRUPTION);
  assert.equal(policyFor("goodwill"), null);
  assert.equal(policyFor(undefined), null);
});

test("every policy describes itself for the screen that offers it", () => {
  for (const type of Object.values(REFUND_TYPE)) {
    const policy = policyFor(type);
    assert.ok(policy.label, `${type} has no label`);
    assert.ok(policy.describe, `${type} has no description`);
  }
});

test("hoursUntil goes negative once the train has gone", () => {
  assert.ok(hoursUntil(inHours(5), NOW) > 4.9);
  assert.ok(hoursUntil(inHours(-5), NOW) < 0);
  assert.equal(hoursUntil(null, NOW), 0);
});
