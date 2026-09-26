const { segmentsBetween } = require("./availability");

/**
 * The rules a connecting standing ticket has to satisfy.
 *
 * Pure, because these are the parts worth being certain about: whether a leg
 * genuinely abuts a seated one, and whether a coach has room for another person
 * standing over every segment of it. Both are easy to get subtly wrong at a
 * boundary, and both are cheap to test exhaustively when they take numbers and
 * return numbers.
 *
 * Standing is deliberately not modelled as an exclusive reservation. A seat is
 * one thing one person occupies, so the database enforces it with a unique
 * index. Standing room is a quantity — twenty people may stand in a coach — and
 * a quantity has nothing to be unique about. The cap is counted instead.
 */

/** Why a standing leg was refused. Each maps to something a passenger can fix. */
const REFUSAL = Object.freeze({
  NO_SEATED_TICKET: "no_seated_ticket",
  NOT_CONTIGUOUS: "not_contiguous",
  OVERLAPS_SEAT: "overlaps_seat",
  BACKWARDS: "backwards",
  OFF_ROUTE: "off_route",
  FULL: "full",
  NOT_OFFERED: "not_offered",
});

/**
 * Does this leg abut the seated one?
 *
 * Seated A→B. A standing leg is connecting when it ends exactly where the seat
 * begins, or begins exactly where the seat ends. Anything else is either a
 * separate journey — which should be bought as one — or an overlap, where the
 * passenger already has a seat and does not need to stand.
 *
 * Sequences, not station ids, because a route can call at a station once and
 * the sequence is what orders them.
 */
function connection({ seatFrom, seatTo, standFrom, standTo }) {
  if (standTo <= standFrom) {
    return { ok: false, reason: REFUSAL.BACKWARDS, message: "A journey has to run forwards." };
  }

  // Before the seat: must end exactly where the seated leg starts.
  if (standTo === seatFrom) return { ok: true, position: "before" };

  // After it: must start exactly where the seated leg ends.
  if (standFrom === seatTo) return { ok: true, position: "after" };

  const overlaps = standFrom < seatTo && standTo > seatFrom;
  if (overlaps) {
    return {
      ok: false,
      reason: REFUSAL.OVERLAPS_SEAT,
      message:
        "You already have a seat over part of that stretch, so there is nothing to stand for. " +
        "Standing covers only the parts of the journey your seat does not.",
    };
  }

  return {
    ok: false,
    reason: REFUSAL.NOT_CONTIGUOUS,
    message:
      "A standing ticket has to join onto your seated leg — ending where your seat begins, or " +
      "beginning where it ends. Buy a separate ticket for a journey that does not touch it.",
  };
}

/**
 * How many more people may stand in this coach over every segment of a leg.
 *
 * The answer is the tightest segment, not the average: a coach with room over
 * four segments and none over the fifth cannot carry someone across all five.
 *
 * @param capacity   how many may stand in this coach at once
 * @param occupancy  Map of segmentIndex -> how many already stand there
 * @param segments   the segments the new leg would cover
 */
function roomFor({ capacity, occupancy, segments }) {
  const limit = Math.max(0, Number(capacity) || 0);
  if (limit === 0) {
    return {
      ok: false,
      reason: REFUSAL.NOT_OFFERED,
      remaining: 0,
      message: "Standing is not sold in this coach.",
    };
  }

  if (!segments?.length) {
    return { ok: false, reason: REFUSAL.BACKWARDS, remaining: 0, message: "That leg covers nothing." };
  }

  let tightest = limit;
  let tightestSegment = segments[0];

  for (const segment of segments) {
    const standing = Number(occupancy.get?.(segment) ?? occupancy[segment] ?? 0);
    const free = limit - standing;
    if (free < tightest) {
      tightest = free;
      tightestSegment = segment;
    }
  }

  if (tightest <= 0) {
    return {
      ok: false,
      reason: REFUSAL.FULL,
      remaining: 0,
      tightestSegment,
      message: "This coach is already carrying as many standing passengers as it may.",
    };
  }

  return { ok: true, remaining: tightest, tightestSegment, capacity: limit };
}

/**
 * What a standing leg costs.
 *
 * A percentage of what a seat over the same stretch would cost, rather than a
 * flat rate — a flat fare would badly misprice a 30km leg against a 300km one,
 * and the seated fare already encodes distance, class and every rule in the
 * fare chain. Standing then tracks all of that for free.
 */
function fareFor({ seatedFareMinor, percent }) {
  const fare = Math.max(0, Math.round(Number(seatedFareMinor) || 0));
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  return Math.round((fare * pct) / 100);
}

/**
 * The segments a leg covers, given the route positions of its ends.
 *
 * Thin wrapper over the seat-inventory helper, so standing and seating can
 * never disagree about what "the segments between two stops" means.
 */
function segmentsFor(fromSequence, toSequence) {
  return segmentsBetween(fromSequence, toSequence);
}

module.exports = { REFUSAL, connection, roomFor, fareFor, segmentsFor };
