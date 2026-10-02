const test = require("node:test");
const assert = require("node:assert/strict");

const { toMinor, toMajor, format, sum, split, divide, percentage } = require("../../src/utils/money");

/* ------------------------------------------------------------------ *
 * Conversion
 * ------------------------------------------------------------------ */

test("toMinor: converts taka to poisha", () => {
  assert.equal(toMinor(0), 0);
  assert.equal(toMinor(1), 100);
  assert.equal(toMinor(123.45), 12345);
  assert.equal(toMinor("380"), 38000);
});

test("toMinor: survives the values floating point is worst at", () => {
  // 0.1 + 0.2 === 0.30000000000000004 in binary floating point. If fares were
  // added as floats, a ledger would drift a paisa at a time.
  assert.equal(toMinor(0.1) + toMinor(0.2), toMinor(0.3));
  assert.equal(toMinor(1.005), 101);
  assert.equal(toMinor(133.9), 13390);
  assert.equal(toMinor(0.07) * 3, 21);
});

test("toMinor: refuses things that are not amounts", () => {
  assert.throws(() => toMinor("abc"), /Not an amount/);
  assert.throws(() => toMinor(undefined), /Not an amount/);
  assert.throws(() => toMinor(NaN), /Not an amount/);
});

test("toMajor: converts back, and refuses fractional minor units", () => {
  assert.equal(toMajor(12345), 123.45);
  assert.equal(toMajor(0), 0);
  assert.throws(() => toMajor(12.5), /whole number/);
});

test("format: always two decimal places", () => {
  assert.equal(format(12345), "123.45");
  assert.equal(format(100), "1.00");
  assert.equal(format(5), "0.05");
  assert.equal(format(0), "0.00");
});

test("a round trip through minor units is lossless", () => {
  for (const amount of [0, 1, 45, 133.9, 380, 1234.56, 99999.99]) {
    assert.equal(toMajor(toMinor(amount)), amount, `${amount}`);
  }
});

/* ------------------------------------------------------------------ *
 * Arithmetic
 * ------------------------------------------------------------------ */

test("sum: totals amounts exactly", () => {
  assert.equal(sum(100, 200, 45), 345);
  assert.equal(sum([100, 200, 45]), 345);
  assert.equal(sum(), 0);
});

test("sum: refuses a fractional amount rather than silently rounding", () => {
  assert.throws(() => sum(100, 0.5), /non-integer/);
});

/* ------------------------------------------------------------------ *
 * Split across payment sources
 * ------------------------------------------------------------------ */

test("split: a wallet that covers everything leaves no remainder", () => {
  assert.deepEqual(split(30000, 50000), { fromFirst: 30000, remainder: 0 });
});

test("split: a partial wallet pays what it can", () => {
  // ৳500 fare, ৳300 in the wallet: ৳300 from wallet, ৳200 to the gateway.
  assert.deepEqual(split(50000, 30000), { fromFirst: 30000, remainder: 20000 });
});

test("split: an empty or negative wallet pays nothing", () => {
  assert.deepEqual(split(50000, 0), { fromFirst: 0, remainder: 50000 });
  assert.deepEqual(split(50000, -100), { fromFirst: 0, remainder: 50000 });
});

test("split: the two parts always add back to the total", () => {
  for (const [total, available] of [[50000, 0], [50000, 12345], [50000, 50000], [1, 1], [0, 999]]) {
    const { fromFirst, remainder } = split(total, available);
    assert.equal(fromFirst + remainder, total, `${total}/${available}`);
  }
});

/* ------------------------------------------------------------------ *
 * Division — what per-segment refunds will rest on
 * ------------------------------------------------------------------ */

test("divide: an even split is even", () => {
  assert.deepEqual(divide(30000, 3), [10000, 10000, 10000]);
});

test("divide: the remainder is distributed, never dropped", () => {
  // 100 poisha three ways is not 33 each — that loses a paisa.
  assert.deepEqual(divide(100, 3), [34, 33, 33]);
  assert.deepEqual(divide(10, 4), [3, 3, 2, 2]);
  assert.deepEqual(divide(1, 3), [1, 0, 0]);
});

test("divide: the shares always add back to the original", () => {
  for (const total of [0, 1, 7, 100, 13390, 99999]) {
    for (const parts of [1, 2, 3, 4, 7, 10]) {
      assert.equal(
        divide(total, parts).reduce((a, b) => a + b, 0),
        total,
        `${total} into ${parts}`
      );
    }
  }
});

test("divide: refuses nonsense", () => {
  assert.throws(() => divide(100, 0), /positive integer/);
  assert.throws(() => divide(100, -1), /positive integer/);
  assert.throws(() => divide(1.5, 2), /whole minor units/);
});

/* ------------------------------------------------------------------ *
 * Percentages — what refund deductions will rest on
 * ------------------------------------------------------------------ */

test("percentage: takes a share of an amount", () => {
  assert.equal(percentage(10000, 25), 2500);
  assert.equal(percentage(10000, 0), 0);
  assert.equal(percentage(10000, 100), 10000);
});

test("percentage: rounds to a whole minor unit", () => {
  assert.equal(percentage(333, 33), 110); // 109.89 -> 110
  assert.equal(percentage(1, 50), 1); // 0.5 -> 1, away from zero
});

test("percentage: a deduction and its remainder add back to the whole", () => {
  for (const amount of [1, 45, 333, 13390, 38000]) {
    for (const pct of [0, 5, 25, 33, 50, 99, 100]) {
      const deducted = percentage(amount, pct);
      assert.equal(deducted + (amount - deducted), amount, `${amount} @ ${pct}%`);
    }
  }
});

test("percentage: refuses a negative rate", () => {
  assert.throws(() => percentage(100, -5), /Not a percentage/);
});

/* ------------------------------------------------------------------ *
 * The specific values that break naive scaling
 * ------------------------------------------------------------------ */

test("toMinor: rounds on the typed decimal, not its binary approximation", () => {
  // Math.round(1.005 * 100) gives 100, because 1.005 is held as
  // 1.00499999999999989. Reading the decimal digits gives the right answer.
  assert.equal(toMinor(1.005), 101);
  assert.equal(toMinor(2.675), 268);
  assert.equal(toMinor(8.165), 817);
  assert.equal(toMinor(1.115), 112);
});

test("toMinor: handles negatives symmetrically", () => {
  assert.equal(toMinor(-123.45), -12345);
  assert.equal(toMinor(-1.005), -101);
  assert.equal(toMinor(-0), 0);
});

test("toMinor: accepts the DECIMAL strings the database returns", () => {
  // Sequelize hands back DECIMAL columns as strings.
  assert.equal(toMinor("133.90"), 13390);
  assert.equal(toMinor("380.00"), 38000);
  assert.equal(toMinor("45"), 4500);
  assert.equal(toMinor("0.05"), 5);
});
