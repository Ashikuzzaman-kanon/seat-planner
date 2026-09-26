/**
 * How much of a fare comes back.
 *
 * Three policies behind one registry (§16.1), so a fourth costs a function
 * rather than a branch in the refund service.
 *
 *   convenient  — money now, minus a deduction that grows as departure nears
 *   demand      — the fare back less a flat processing charge, but only for the
 *                 segments that actually resell; nothing for those that do not
 *   disruption  — the whole fare, issued when the railway cancels
 *
 * The first two are what a passenger chooses between, and they trade certainty
 * against amount: take a smaller sum now, or a larger one only if someone else
 * buys the seat. The third is not a choice at all.
 *
 * Pure and clock-injectable: the whole point of a deduction slab is that it
 * depends on *when* you ask, so "now" is an argument, never a global.
 *
 * All arithmetic is in integer minor units. A percentage of a fare is rounded
 * in the railway's favour on the deduction and the passenger's on the refund,
 * which is the same decision made once: the refund is what remains after an
 * exactly-computed deduction, so the two can never sum to more than the fare.
 */

const REFUND_TYPE = Object.freeze({
  CONVENIENT: "convenient",
  DEMAND: "demand",
  /** Issued by the railway when it cancels, never requested by a passenger. */
  DISRUPTION: "disruption",
});

/** Why a refund request was turned down before any money moved. */
const REFUSAL = Object.freeze({
  DEPARTED: "departed",
  NOT_REFUNDABLE: "not_refundable",
  ALREADY_REFUNDED: "already_refunded",
  STANDING_HELD: "standing_held",
  SALE_CLOSED: "sale_closed",
  /** Switched off for this departure by someone with the authority to do so. */
  DISABLED: "disabled",
});

/**
 * The deduction that applies with `hoursRemaining` left before departure.
 *
 * Slabs read as "with at least this long to go, this much is kept". They are
 * sorted here rather than trusted, because they arrive from a settings row an
 * administrator typed.
 */
function deductionPercentFor(slabs, hoursRemaining) {
  const ordered = [...(slabs || [])]
    .filter((s) => s && Number.isFinite(Number(s.hoursBefore)) && Number.isFinite(Number(s.deductionPercent)))
    .map((s) => ({ hoursBefore: Number(s.hoursBefore), deductionPercent: Number(s.deductionPercent) }))
    .sort((a, b) => b.hoursBefore - a.hoursBefore);

  if (!ordered.length) return 100;

  for (const slab of ordered) {
    if (hoursRemaining >= slab.hoursBefore) return slab.deductionPercent;
  }

  // Past the narrowest slab — closer to departure than any rule anticipated, so
  // the strictest one applies rather than accidentally refunding in full.
  return ordered[ordered.length - 1].deductionPercent;
}

/** Hours between now and departure. Negative once the train has gone. */
function hoursUntil(departureInstant, now = new Date()) {
  if (!departureInstant) return 0;
  return (new Date(departureInstant).getTime() - new Date(now).getTime()) / 3_600_000;
}

/**
 * An exact split of `fareMinor` into what is kept and what comes back.
 *
 * The deduction is computed and the refund is the remainder, so the two always
 * add back to the fare exactly — no rounding can create or destroy a poisha.
 *
 * The optional floor and cap are what make a percentage workable across a fare
 * range of two orders of magnitude: 10% of a 50 taka ticket does not cover the
 * cost of handling the return, and 10% of a 9,000 taka one is a penalty nobody
 * intended. Zero means the bound is not set.
 *
 * The charge is clamped to the fare last, so a floor larger than the ticket
 * cannot produce a negative refund.
 */
function applyDeduction(fareMinor, percent, { minMinor = 0, maxMinor = 0 } = {}) {
  const fare = Math.max(0, Math.round(Number(fareMinor) || 0));
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));

  let deductionMinor = Math.round((fare * pct) / 100);

  const floor = Math.max(0, Number(minMinor) || 0);
  const cap = Math.max(0, Number(maxMinor) || 0);

  if (floor > 0) deductionMinor = Math.max(deductionMinor, floor);
  if (cap > 0) deductionMinor = Math.min(deductionMinor, cap);
  deductionMinor = Math.min(deductionMinor, fare);

  return { deductionMinor, refundMinor: fare - deductionMinor, percent: pct };
}

/* ------------------------------------------------------------------ *
 * The policies
 * ------------------------------------------------------------------ */

const convenient = {
  type: REFUND_TYPE.CONVENIENT,
  label: "Convenient return",
  describe: "Money back now, less a deduction that grows as departure approaches.",

  /**
   * @param fareMinor          what was paid for the ticket
   * @param departureInstant   when the train leaves the passenger's origin
   * @param slabs              from settings
   */
  quote({ fareMinor, departureInstant, slabs, bounds, now = new Date() }) {
    const hoursRemaining = hoursUntil(departureInstant, now);

    if (hoursRemaining <= 0) {
      return {
        ok: false,
        reason: REFUSAL.DEPARTED,
        message: "That train has already left, so the ticket can no longer be returned.",
      };
    }

    const percent = deductionPercentFor(slabs, hoursRemaining);
    const split = applyDeduction(fareMinor, percent, bounds);

    if (split.refundMinor <= 0) {
      return {
        ok: false,
        reason: REFUSAL.NOT_REFUNDABLE,
        hoursRemaining,
        ...split,
        message:
          `With ${formatHours(hoursRemaining)} to go, this ticket carries a ` +
          `${percent}% deduction, which leaves nothing to refund. ` +
          "A demand-based return may still pay out if the seat resells.",
      };
    }

    return {
      ok: true,
      type: REFUND_TYPE.CONVENIENT,
      immediate: true,
      hoursRemaining,
      ...split,
      message:
        `${percent}% is deducted with ${formatHours(hoursRemaining)} to go. ` +
        "The rest is credited to your wallet straight away.",
    };
  },
};

const demand = {
  type: REFUND_TYPE.DEMAND,
  label: "Demand-based return",
  describe: "The seat goes back on sale; each segment refunds if and when it resells.",

  /**
   * A flat processing charge, and no time component at all.
   *
   * This is the point of the policy. The seat was sold again, so the railway is
   * not out of pocket — it has been paid twice for the same space and needs to
   * keep only what handling the return costs. How long before departure the
   * passenger changed their mind is irrelevant to that: what matters is whether
   * someone else bought the seat.
   *
   * So the bargain a passenger is offered is deliberately stark. Either the
   * seat resells and they get their fare back less the charge, or it does not
   * and they get nothing. Making the charge vary by time would blur a choice
   * whose whole value is that it is easy to understand.
   *
   * The charge is taken once against the whole fare and the remainder is split
   * across the segments, rather than charged per segment — otherwise a
   * three-segment journey would pay the floor three times over.
   */
  quote({ fareMinor, segmentCount, departureInstant, chargePercent, bounds, now = new Date() }) {
    const hoursRemaining = hoursUntil(departureInstant, now);

    if (hoursRemaining <= 0) {
      return {
        ok: false,
        reason: REFUSAL.DEPARTED,
        message: "That train has already left, so the ticket can no longer be returned.",
      };
    }

    const charge = applyDeduction(fareMinor, chargePercent, bounds);

    if (charge.refundMinor <= 0) {
      return {
        ok: false,
        reason: REFUSAL.NOT_REFUNDABLE,
        hoursRemaining,
        ...charge,
        message:
          `The processing charge on this fare is ${charge.deductionMinor} poisha, which leaves ` +
          "nothing to pay out even if the seat resells.",
      };
    }

    const segments = Math.max(1, Number(segmentCount) || 1);
    const shares = splitAcross(fareMinor, segments);
    const refunds = splitAcross(charge.refundMinor, segments);

    const lines = shares.map((shareMinor, i) => ({
      shareMinor,
      refundMinor: refunds[i],
      deductionMinor: shareMinor - refunds[i],
    }));

    return {
      ok: true,
      type: REFUND_TYPE.DEMAND,
      immediate: false,
      hoursRemaining,
      segmentCount: segments,
      lines,
      maximumMinor: charge.refundMinor,
      deductionMinor: charge.deductionMinor,
      percent: charge.percent,
      message:
        `The seat goes back on sale now. If it resells you get your fare back less a ` +
        `${charge.percent}% processing charge; if nobody buys it, nothing. ` +
        (segments > 1
          ? `The ${segments} segments refund independently, as each one sells.`
          : ""),
    };
  },
};

/**
 * The railway cancelled, not the passenger.
 *
 * Nothing is deducted and no condition is attached. A deduction exists to
 * price the cost of someone changing their mind; when the operator is the one
 * who changed the plan, there is no such cost to pass on. This is also the only
 * policy that still applies after departure — a train cancelled an hour before
 * it was due has left nobody with a ticket worth anything.
 *
 * Not offered to passengers. It is issued by the system when a departure or a
 * coach is taken out of service, which is why it takes no slabs and no bounds.
 */
const disruption = {
  type: REFUND_TYPE.DISRUPTION,
  label: "Cancelled by the railway",
  describe: "Full fare returned, with nothing deducted.",

  quote({ fareMinor }) {
    const fare = Math.max(0, Math.round(Number(fareMinor) || 0));

    return {
      ok: true,
      type: REFUND_TYPE.DISRUPTION,
      immediate: true,
      percent: 0,
      deductionMinor: 0,
      refundMinor: fare,
      message: "This service was cancelled, so the full fare is returned.",
    };
  },
};

const POLICIES = Object.freeze({
  [REFUND_TYPE.CONVENIENT]: convenient,
  [REFUND_TYPE.DEMAND]: demand,
  [REFUND_TYPE.DISRUPTION]: disruption,
});

/** The policies a passenger may choose between. Disruption is issued, not chosen. */
const PASSENGER_POLICIES = Object.freeze([REFUND_TYPE.CONVENIENT, REFUND_TYPE.DEMAND]);

const policyFor = (type) => POLICIES[type] || null;

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Divide a fare across segments so the parts add back to the whole.
 *
 * The remainder goes to the earliest segments rather than being dropped — over
 * a three-segment 100.00 fare that is the difference between refunding 99.99
 * and refunding what was paid.
 */
function splitAcross(totalMinor, parts) {
  const total = Math.max(0, Math.round(Number(totalMinor) || 0));
  const n = Math.max(1, Math.floor(parts));

  const base = Math.floor(total / n);
  let remainder = total - base * n;

  return Array.from({ length: n }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

function formatHours(hours) {
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  if (hours >= 2) return `${Math.floor(hours)} hours`;
  const minutes = Math.max(1, Math.round(hours * 60));
  return `${minutes} minutes`;
}

module.exports = {
  REFUND_TYPE,
  REFUSAL,
  POLICIES,
  PASSENGER_POLICIES,
  policyFor,
  deductionPercentFor,
  applyDeduction,
  splitAcross,
  hoursUntil,
  formatHours,
};
