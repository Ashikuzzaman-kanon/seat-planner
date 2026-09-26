/**
 * Segment-level seat availability, as pure functions.
 *
 * This is the idea the whole product rests on: a seat is not sold "for the
 * trip", it is sold for the **stretch of route** the passenger occupies. Sell
 * seat 5 from B to C and it stays on sale A→B and C→D, independently.
 *
 * None of this touches the database or Express, because all of it is set
 * arithmetic over segment indices. Every rule below is therefore directly
 * testable, which matters more here than anywhere else in the system: a wrong
 * answer is two passengers in one seat.
 *
 * Segment numbering: segment `i` spans route stop `i` to stop `i+1`, zero-based.
 * Stop sequences are one-based, so a journey from sequence `a` to sequence `b`
 * occupies segments `a-1` through `b-2` inclusive.
 */

/** Why a seat could not be offered. Ordered most to least specific. */
const UNAVAILABLE = Object.freeze({
  OCCUPIED: "occupied",
  BLOCKED: "blocked",
  QUOTA: "reserved_for_other_pair",
  FILTER: "does_not_match_filters",
});

/**
 * The segments a journey occupies.
 * `1 -> 4` on an 11-stop route gives [0, 1, 2].
 */
function segmentsBetween(fromSequence, toSequence) {
  if (!Number.isInteger(fromSequence) || !Number.isInteger(toSequence)) {
    throw new Error("Stop sequences must be integers");
  }
  if (toSequence <= fromSequence) {
    throw new Error("The destination must come after the origin on the route");
  }
  const segments = [];
  for (let i = fromSequence - 1; i <= toSequence - 2; i++) segments.push(i);
  return segments;
}

/** Do two journeys share any segment? The overlap test, stated directly. */
function journeysOverlap(aFrom, aTo, bFrom, bTo) {
  // Half-open intervals [from, to): touching end-to-end is not an overlap,
  // which is exactly why B→C and C→D can both sell the same seat.
  return aFrom < bTo && bFrom < aTo;
}

/**
 * Is this seat free for the requested segments?
 * `occupied` is the set of segment indices already taken on this seat.
 */
function isFree(occupied, needed) {
  for (const segment of needed) {
    if (occupied.has(segment)) return false;
  }
  return true;
}

/**
 * Does a seat's quota allow this journey?
 *
 * A seat with no quota row is open. A reserved seat sells as **exactly** its own
 * pair — not as a shorter journey inside it, which is the "exact only" rule.
 *
 * But a reservation only reaches as far as the stretch it reserves. A seat held
 * for A→C says nothing about C→D: those journeys never share a segment, so the
 * same seat serves both, one passenger getting off exactly where the next gets
 * on. Refusing there would hold a seat empty over track it was never reserved
 * for, which is the opposite of what segment-level inventory is for.
 *
 * So: overlap the reserved stretch and only the exact pair is allowed; miss it
 * entirely and the reservation is simply irrelevant.
 *
 * `sequenceOf` maps station id to route stop sequence, and is what lets the
 * reserved pair be compared as a stretch rather than as two opaque ids.
 */
function quotaPermits(quota, { fromStationId, toStationId, fromSequence, toSequence, sequenceOf, now = new Date() }) {
  if (!quota) return true;
  if (quota.releasedAt) return true;
  if (quota.releaseAt && new Date(quota.releaseAt) <= now) return true;

  // The pair it was reserved for is always allowed.
  if (
    Number(quota.fromStationId) === Number(fromStationId) &&
    Number(quota.toStationId) === Number(toStationId)
  ) {
    return true;
  }

  // Without a route to place the reserved pair on, fall back to the strict
  // reading rather than guessing.
  if (!sequenceOf) return false;

  const reservedFrom = sequenceOf.get(Number(quota.fromStationId));
  const reservedTo = sequenceOf.get(Number(quota.toStationId));
  if (!reservedFrom || !reservedTo) return true; // Not on this route at all.

  // Anything sharing track with the reservation is refused; anything clear of
  // it is unaffected.
  return !journeysOverlap(fromSequence, toSequence, reservedFrom, reservedTo);
}

/**
 * Does a seat match the requested features?
 *
 * Filters are read from the seat's attribute document, so an attribute added to
 * the catalogue becomes filterable without touching this function. `window`
 * accepts `true` (any window) or a specific type such as "full".
 */
function matchesFilters(seat, filters) {
  if (!filters) return true;
  const attributes = seat.attributes || {};

  for (const [key, wanted] of Object.entries(filters)) {
    if (wanted === undefined || wanted === null || wanted === false || wanted === "") continue;

    const actual = attributes[key];

    if (wanted === true) {
      if (!actual) return false;
      continue;
    }
    if (String(actual) !== String(wanted)) return false;
  }
  return true;
}

/**
 * Work out which seats can be sold for one journey.
 *
 * Everything is computed in memory from three cheap reads — the trip's seats,
 * its occupied segments, and its quota rows — because the alternative is a
 * query per seat, and a departure has hundreds of seats.
 *
 * @param seats      trip seat rows
 * @param occupancy  Map<tripSeatId, Set<segmentIndex>>
 * @param quotas     Map<tripSeatId, quotaRow>
 * @param blocked    Set<tripSeatId> taken out of sale entirely
 */
function computeAvailability({
  seats,
  occupancy = new Map(),
  quotas = new Map(),
  blocked = new Set(),
  fromSequence,
  toSequence,
  fromStationId,
  toStationId,
  sequenceOf = null,
  filters = null,
  now = new Date(),
}) {
  const needed = segmentsBetween(fromSequence, toSequence);

  const available = [];
  const unavailable = [];

  for (const seat of seats) {
    if (blocked.has(seat.id)) {
      unavailable.push({ seat, reason: UNAVAILABLE.BLOCKED });
      continue;
    }

    const occupied = occupancy.get(seat.id) || new Set();
    if (!isFree(occupied, needed)) {
      unavailable.push({ seat, reason: UNAVAILABLE.OCCUPIED });
      continue;
    }

    const permitted = quotaPermits(quotas.get(seat.id), {
      fromStationId,
      toStationId,
      fromSequence,
      toSequence,
      sequenceOf,
      now,
    });
    if (!permitted) {
      unavailable.push({ seat, reason: UNAVAILABLE.QUOTA });
      continue;
    }

    // Filters go last: a seat rejected only on preference is still worth
    // counting as "would be free", which is what makes a useful message when
    // nothing matches.
    if (!matchesFilters(seat, filters)) {
      unavailable.push({ seat, reason: UNAVAILABLE.FILTER });
      continue;
    }

    available.push(seat);
  }

  return { segments: needed, available, unavailable };
}

/** Group a list of unavailable entries into counts per reason. */
function summarise(unavailable) {
  return unavailable.reduce((acc, entry) => {
    acc[entry.reason] = (acc[entry.reason] || 0) + 1;
    return acc;
  }, {});
}

module.exports = {
  UNAVAILABLE,
  segmentsBetween,
  journeysOverlap,
  isFree,
  quotaPermits,
  matchesFilters,
  computeAvailability,
  summarise,
};
