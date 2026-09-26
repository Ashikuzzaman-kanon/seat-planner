/**
 * Money, handled as integers.
 *
 * Every amount in the wallet and on a ticket is stored and computed in **minor
 * units** — poisha, one hundredth of a taka. Floating point cannot represent
 * 0.1 exactly, so `0.1 + 0.2 !== 0.3`, and a ledger built on that will drift
 * by fractions of a paisa until the books stop balancing. Integers cannot
 * drift.
 *
 * Fares are stored as DECIMAL because they are configuration a person types;
 * they convert to minor units at the boundary, here, and everything downstream
 * is integer arithmetic.
 */

const MINOR_PER_MAJOR = 100;

/**
 * 123.45 -> 12345. Rounds half away from zero, the way a till does.
 *
 * Deliberately not `Math.round(value * 100)`. That multiplication is itself a
 * floating-point operation: 1.005 is held as 1.00499999999999989, so scaling it
 * gives 100.49999999999999 and rounds *down* to 100 — losing the exact paisa
 * this module exists to protect.
 *
 * Instead the value is expanded to a fixed decimal string and the digits are
 * read directly, so the rounding decision is made on the decimal the user
 * typed rather than on its binary approximation.
 */
function toMinor(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    throw new Error(`Not an amount: ${amount}`);
  }

  // Ten places is far short of where binary error appears (~16 significant
  // digits) and far beyond any real currency precision.
  const expanded = Math.abs(value).toFixed(10);
  const [whole, fraction] = expanded.split(".");

  const minor = Number(whole) * MINOR_PER_MAJOR + Number(fraction.slice(0, 2));
  const roundUp = Number(fraction[2]) >= 5;
  const magnitude = minor + (roundUp ? 1 : 0);

  return value < 0 ? -magnitude : magnitude;
}

/** 12345 -> 123.45, for display and for the API boundary. */
function toMajor(minor) {
  if (!Number.isInteger(minor)) {
    throw new Error(`Minor units must be a whole number: ${minor}`);
  }
  return minor / MINOR_PER_MAJOR;
}

/** "৳123.45" without the symbol — formatting is the UI's business. */
function format(minor) {
  return toMajor(minor).toFixed(2);
}

/** Sum any number of minor amounts, refusing anything that is not an integer. */
function sum(...amounts) {
  return amounts.flat().reduce((total, amount) => {
    if (!Number.isInteger(amount)) {
      throw new Error(`Cannot total a non-integer amount: ${amount}`);
    }
    return total + amount;
  }, 0);
}

/**
 * Split an amount across two payment sources — as much as the first can cover,
 * the remainder to the second. This is what makes "wallet plus card" work
 * without either source knowing about the other.
 */
function split(totalMinor, availableMinor) {
  if (!Number.isInteger(totalMinor) || totalMinor < 0) {
    throw new Error("Total must be a non-negative whole number of minor units");
  }
  const fromFirst = Math.max(0, Math.min(totalMinor, Math.max(0, availableMinor | 0)));
  return { fromFirst, remainder: totalMinor - fromFirst };
}

/**
 * Divide an amount into `parts` shares that add back to exactly the original.
 *
 * The remainder is spread one minor unit at a time over the earliest shares
 * rather than lost to rounding — so three ways of 100 gives 34, 33, 33, and
 * never 33, 33, 33 with a paisa unaccounted for. Phase 6's per-segment refunds
 * depend on this adding up.
 */
function divide(totalMinor, parts) {
  if (!Number.isInteger(totalMinor)) throw new Error("Total must be whole minor units");
  if (!Number.isInteger(parts) || parts < 1) throw new Error("Parts must be a positive integer");

  const base = Math.trunc(totalMinor / parts);
  const remainder = totalMinor - base * parts;

  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** A percentage of an amount, rounded to the nearest minor unit. */
function percentage(minor, percent) {
  if (!Number.isInteger(minor)) throw new Error("Amount must be whole minor units");
  const value = Number(percent);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Not a percentage: ${percent}`);
  return Math.round((minor * value) / 100);
}

module.exports = { MINOR_PER_MAJOR, toMinor, toMajor, format, sum, split, divide, percentage };
