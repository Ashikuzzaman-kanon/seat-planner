/**
 * Demo 1: conditional breakpoints and breakpoint actions.
 *
 * Two thousand cancellations go through the refund rules below. A handful come
 * out NEGATIVE: the passenger would owe money for cancelling. Stepping through
 * 2,000 loop turns to find them is hopeless; a conditional breakpoint stops on
 * exactly the bad one, and a logging breakpoint lists them all without stopping.
 *
 * Where to put the breakpoints: the line marked BREAKPOINT in `refundFor`.
 * The bug is real but small; see debugging-demo.md for where it is and the fix.
 *
 * The numbers are made up but the same on every run (a fixed seed), so a
 * rehearsal finds the same bookings as the demo.
 */

const CANCELLATIONS = 2000;
const SERVICE_CHARGE_PER_SEAT = 60; // taka, kept by the operator on every cancellation

/** A repeatable stream of numbers in [0, 1). */
function seeded(seed) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function makeCancellations(count) {
  const next = seeded(42);
  return Array.from({ length: count }, (_, i) => ({
    id: 1001 + i,
    farePerSeat: 300 + Math.floor(next() * 30) * 50, // 300 to 1,750 taka
    seats: 1 + Math.floor(next() * 4), // 1 to 4
    hoursBeforeDeparture: Math.floor(next() * 97) - 1, // -1 (the train has left) to 95
  }));
}

/** The share of the fare kept, by how close to departure the cancellation is. */
function cancellationRate(hoursBefore) {
  if (hoursBefore >= 48) return 0.1;
  if (hoursBefore >= 24) return 0.25;
  if (hoursBefore >= 0) return 0.5;
  return 1; // after departure: nothing back
}

function refundFor(c) {
  const paid = c.farePerSeat * c.seats;
  const fee = paid * cancellationRate(c.hoursBeforeDeparture);
  const serviceCharge = SERVICE_CHARGE_PER_SEAT * c.seats;
  const refund = paid - fee - serviceCharge;
  return Math.round(refund); // BREAKPOINT here, condition `refund < 0` (a breakpoint pauses BEFORE its line runs)
}

function main() {
  const cancellations = makeCancellations(CANCELLATIONS);
  let total = 0;
  let refunded = 0;
  for (const c of cancellations) {
    const refund = refundFor(c);
    total += refund;
    if (refund > 0) refunded += 1;
  }
  console.log(`${cancellations.length} cancellations, ${refunded} with money back, ${total.toLocaleString("en-US")} taka refunded in all`);

  // The finance check that "fails in production": no refund may be negative.
  const negative = cancellations.filter((c) => refundFor(c) < 0);
  if (negative.length) {
    throw new Error(`${negative.length} refunds are negative, e.g. booking ${negative[0].id}`);
  }
}

main();
