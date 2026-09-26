const { matchesFilters } = require("./availability");

/**
 * Choosing seats on a passenger's behalf.
 *
 * Two things make this more than "take the first N free seats".
 *
 * The first is **strictness**. A passenger who asks for a charging port and
 * gets a seat without one has been quietly let down, and will only find out on
 * the train. So when criteria cannot be met, this says so and selects nothing,
 * rather than degrading in silence. Relaxing is opt-in, and when it happens the
 * result names exactly what was given up.
 *
 * The second is **togetherness**. Four seats scattered across a coach are four
 * seats; four seats in a row are a family travelling together. Physical
 * adjacency is readable from the layout — `cellIndex` counts every cell in a
 * row, aisles and tables included, so two seats with consecutive cell indices
 * have nothing between them, while seats either side of an aisle do not.
 *
 * Pure: it takes seat records and returns a decision. No database, no clock.
 */

/** How close together the chosen seats ended up, best first. */
const TOGETHERNESS = Object.freeze({
  SIDE_BY_SIDE: "side_by_side",
  SAME_ROW: "same_row",
  NEARBY: "nearby",
  SAME_COACH: "same_coach",
  SCATTERED: "scattered",
});

const TOGETHERNESS_LABEL = Object.freeze({
  [TOGETHERNESS.SIDE_BY_SIDE]: "side by side",
  [TOGETHERNESS.SAME_ROW]: "in the same row",
  [TOGETHERNESS.NEARBY]: "within a row of each other",
  [TOGETHERNESS.SAME_COACH]: "in the same coach",
  [TOGETHERNESS.SCATTERED]: "spread across the train",
});

/** Why a selection could not be made. Each maps to something a passenger can act on. */
const REFUSAL = Object.freeze({
  NOT_ENOUGH_SEATS: "not_enough_seats",
  CRITERIA_UNMET: "criteria_unmet",
  CANNOT_SEAT_TOGETHER: "cannot_seat_together",
});

const bySeatOrder = (a, b) =>
  (a.tripCoachId ?? 0) - (b.tripCoachId ?? 0) ||
  (a.rowIndex ?? 0) - (b.rowIndex ?? 0) ||
  (a.cellIndex ?? 0) - (b.cellIndex ?? 0) ||
  (a.id ?? 0) - (b.id ?? 0);

/** Groups seats by a key, preserving a stable order inside each group. */
function groupBy(seats, keyOf) {
  const groups = new Map();
  for (const seat of seats) {
    const key = keyOf(seat);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(seat);
  }
  for (const group of groups.values()) group.sort(bySeatOrder);
  return groups;
}

/**
 * A run of `count` seats with consecutive cell indices — physically adjacent,
 * with no aisle or table between them.
 */
function findSideBySide(seats, count) {
  const rows = groupBy(seats, (s) => `${s.tripCoachId}:${s.rowIndex}`);

  for (const row of rows.values()) {
    let run = [row[0]];
    for (let i = 1; i < row.length; i++) {
      const adjacent = row[i].cellIndex === row[i - 1].cellIndex + 1;
      run = adjacent ? [...run, row[i]] : [row[i]];
      if (run.length >= count) return run.slice(0, count);
    }
    if (run.length >= count) return run.slice(0, count);
  }
  return null;
}

/** `count` seats in one row of one coach, even if an aisle splits them. */
function findSameRow(seats, count) {
  const rows = groupBy(seats, (s) => `${s.tripCoachId}:${s.rowIndex}`);
  for (const row of rows.values()) {
    if (row.length >= count) return row.slice(0, count);
  }
  return null;
}

/**
 * `count` seats packed into as few adjacent rows as possible within one coach.
 *
 * Scans a sliding window over the coach's seats in layout order and keeps the
 * window spanning the fewest rows — which is what "as close as we could manage"
 * means when no single row has room.
 */
function findNearby(seats, count, maxRowSpread) {
  const coaches = groupBy(seats, (s) => String(s.tripCoachId));

  let best = null;
  let bestSpread = Infinity;

  for (const coach of coaches.values()) {
    if (coach.length < count) continue;

    for (let i = 0; i + count <= coach.length; i++) {
      const window = coach.slice(i, i + count);
      const rowIndices = window.map((s) => s.rowIndex ?? 0);
      const spread = Math.max(...rowIndices) - Math.min(...rowIndices);

      if (spread < bestSpread) {
        best = window;
        bestSpread = spread;
        if (spread === 0) break;
      }
    }
  }

  if (!best) return null;
  if (maxRowSpread != null && bestSpread > maxRowSpread) return null;
  return best;
}

/** Any `count` seats sharing a coach. */
function findSameCoach(seats, count) {
  const coaches = groupBy(seats, (s) => String(s.tripCoachId));
  for (const coach of coaches.values()) {
    if (coach.length >= count) return coach.slice(0, count);
  }
  return null;
}

/**
 * The best block of `count` seats available, and how good it turned out to be.
 *
 * Tried in order of what a passenger would actually prefer, stopping at the
 * first that works — so a pair in one row beats a pair two rows apart, and both
 * beat a pair in different coaches.
 */
function bestBlock(seats, count) {
  const attempts = [
    [TOGETHERNESS.SIDE_BY_SIDE, () => findSideBySide(seats, count)],
    [TOGETHERNESS.SAME_ROW, () => findSameRow(seats, count)],
    [TOGETHERNESS.NEARBY, () => findNearby(seats, count, 1)],
    [TOGETHERNESS.SAME_COACH, () => findSameCoach(seats, count)],
  ];

  for (const [togetherness, attempt] of attempts) {
    const found = attempt();
    if (found) return { seats: found, togetherness };
  }

  const sorted = [...seats].sort(bySeatOrder);
  return sorted.length >= count
    ? { seats: sorted.slice(0, count), togetherness: TOGETHERNESS.SCATTERED }
    : null;
}

/** Names the criteria that no longer hold once the pool is widened. */
function unmetCriteria(available, criteria) {
  if (!criteria) return [];
  return Object.entries(criteria)
    .filter(([, wanted]) => wanted !== undefined && wanted !== null && wanted !== false && wanted !== "")
    .filter(([key, wanted]) => !available.some((seat) => matchesFilters(seat, { [key]: wanted })))
    .map(([key]) => key);
}

/** Counts how many free seats satisfy each criterion on its own. */
function criteriaBreakdown(available, criteria) {
  if (!criteria) return {};
  const breakdown = {};
  for (const [key, wanted] of Object.entries(criteria)) {
    if (wanted === undefined || wanted === null || wanted === false || wanted === "") continue;
    breakdown[key] = available.filter((seat) => matchesFilters(seat, { [key]: wanted })).length;
  }
  return breakdown;
}

/**
 * Pick seats for a passenger.
 *
 * @param available  free seats for the journey, each with tripCoachId, rowIndex,
 *                   cellIndex and an attributes document
 * @param count      how many seats are wanted
 * @param criteria   attribute filters, e.g. { window: true, charging_port: true }
 * @param together   whether the seats must be near one another
 * @param strict     when true, unmet criteria or a failed grouping refuse the
 *                   request instead of returning something lesser
 *
 * @returns {{ok: true, seats, togetherness, togetherLabel, relaxed, message}}
 *        | {{ok: false, reason, message, ...diagnostics}}
 */
function autoSelect({ available = [], count = 1, criteria = null, together = false, strict = false } = {}) {
  const wanted = Math.max(1, Math.floor(Number(count) || 1));

  if (available.length < wanted) {
    return {
      ok: false,
      reason: REFUSAL.NOT_ENOUGH_SEATS,
      availableCount: available.length,
      requested: wanted,
      message:
        available.length === 0
          ? "No seats are free for that journey."
          : `Only ${available.length} seat(s) are free for that journey, and ${wanted} were asked for.`,
    };
  }

  const matching = criteria ? available.filter((seat) => matchesFilters(seat, criteria)) : available;
  const relaxed = [];

  let pool = matching;
  if (matching.length < wanted) {
    if (strict) {
      const missing = unmetCriteria(available, criteria);
      return {
        ok: false,
        reason: REFUSAL.CRITERIA_UNMET,
        requested: wanted,
        matchingCount: matching.length,
        availableCount: available.length,
        breakdown: criteriaBreakdown(available, criteria),
        unsatisfiable: missing,
        message:
          `Only ${matching.length} of the ${available.length} free seat(s) match what was asked for, ` +
          `and ${wanted} were needed. ` +
          (missing.length
            ? `No free seat has: ${missing.join(", ")}.`
            : "Try relaxing one of the preferences."),
      };
    }
    // Widening the pool is a real concession, so it is reported rather than
    // quietly absorbed.
    relaxed.push(...Object.keys(criteriaBreakdown(available, criteria)));
    pool = available;
  }

  if (!together) {
    const chosen = [...pool].sort(bySeatOrder).slice(0, wanted);
    return {
      ok: true,
      seats: chosen,
      togetherness: describe(chosen),
      togetherLabel: TOGETHERNESS_LABEL[describe(chosen)],
      relaxed,
      message: summary(chosen, relaxed, false),
    };
  }

  const block = bestBlock(pool, wanted);

  if (strict && (!block || worseThan(block.togetherness, TOGETHERNESS.SAME_ROW))) {
    return {
      ok: false,
      reason: REFUSAL.CANNOT_SEAT_TOGETHER,
      requested: wanted,
      best: block ? TOGETHERNESS_LABEL[block.togetherness] : null,
      message:
        `There is no run of ${wanted} free seats together` +
        (block ? `; the closest available are ${TOGETHERNESS_LABEL[block.togetherness]}.` : ".") +
        " Book fewer seats together, or turn off the together requirement.",
    };
  }

  return {
    ok: true,
    seats: block.seats,
    togetherness: block.togetherness,
    togetherLabel: TOGETHERNESS_LABEL[block.togetherness],
    relaxed,
    message: summary(block.seats, relaxed, true, block.togetherness),
  };
}

const RANK = [
  TOGETHERNESS.SIDE_BY_SIDE,
  TOGETHERNESS.SAME_ROW,
  TOGETHERNESS.NEARBY,
  TOGETHERNESS.SAME_COACH,
  TOGETHERNESS.SCATTERED,
];

const worseThan = (a, b) => RANK.indexOf(a) > RANK.indexOf(b);

/** How close together a set of seats happens to be, after the fact. */
function describe(seats) {
  if (seats.length <= 1) return TOGETHERNESS.SIDE_BY_SIDE;

  const coaches = new Set(seats.map((s) => s.tripCoachId));
  if (coaches.size > 1) return TOGETHERNESS.SCATTERED;

  const rows = new Set(seats.map((s) => s.rowIndex));
  if (rows.size === 1) {
    const cells = seats.map((s) => s.cellIndex).sort((a, b) => a - b);
    const consecutive = cells.every((c, i) => i === 0 || c === cells[i - 1] + 1);
    return consecutive ? TOGETHERNESS.SIDE_BY_SIDE : TOGETHERNESS.SAME_ROW;
  }

  const rowNumbers = [...rows];
  const spread = Math.max(...rowNumbers) - Math.min(...rowNumbers);
  return spread <= 1 ? TOGETHERNESS.NEARBY : TOGETHERNESS.SAME_COACH;
}

function summary(seats, relaxed, together, togetherness) {
  const numbers = seats.map((s) => s.seatNumber).join(", ");
  const where = together ? ` ${TOGETHERNESS_LABEL[togetherness]}` : "";
  const concession = relaxed.length
    ? ` Not every preference could be met — ${relaxed.join(", ")} was relaxed.`
    : "";
  return `Selected ${seats.length} seat(s)${where}: ${numbers}.${concession}`;
}

module.exports = {
  autoSelect,
  describe,
  bestBlock,
  findSideBySide,
  findSameRow,
  findNearby,
  findSameCoach,
  TOGETHERNESS,
  TOGETHERNESS_LABEL,
  REFUSAL,
};
