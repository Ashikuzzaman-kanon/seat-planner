const test = require("node:test");
const assert = require("node:assert/strict");

const {
  autoSelect,
  describe: describeTogetherness,
  findSideBySide,
  findSameRow,
  findNearby,
  findSameCoach,
  TOGETHERNESS,
  REFUSAL,
} = require("../../src/utils/autoSelect");

/**
 * A coach laid out like a real one: two seats, aisle, two seats. The aisle is a
 * cell of its own, so cell indices run 0,1,_,3,4 and the gap is what tells
 * adjacency apart from "merely in the same row".
 */
function coach(tripCoachId, rows, attributesFor = () => ({})) {
  const seats = [];
  for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
    [0, 1, 3, 4].forEach((cellIndex, i) => {
      const seatNumber = `${tripCoachId}-${rowIndex * 4 + i + 1}`;
      seats.push({
        id: tripCoachId * 1000 + rowIndex * 10 + i,
        tripCoachId,
        rowIndex,
        cellIndex,
        seatNumber,
        attributes: attributesFor(seatNumber, cellIndex, rowIndex),
      });
    });
  }
  return seats;
}

const numbers = (result) => result.seats.map((s) => s.seatNumber);

/* ------------------------------------------------------------------ *
 * The block finders
 * ------------------------------------------------------------------ */

test("side by side: finds seats with nothing between them", () => {
  const found = findSideBySide(coach(1, 3), 2);
  assert.equal(found.length, 2);
  assert.equal(found[1].cellIndex - found[0].cellIndex, 1);
});

test("side by side: will not pair across an aisle", () => {
  // Only cells 1 and 3 are free — same row, but the aisle sits between them.
  const seats = coach(1, 1).filter((s) => s.cellIndex === 1 || s.cellIndex === 3);
  assert.equal(findSideBySide(seats, 2), null);
  assert.equal(findSameRow(seats, 2).length, 2);
});

test("side by side: a run of three is found when three are asked for", () => {
  const seats = [
    { id: 1, tripCoachId: 1, rowIndex: 0, cellIndex: 0, seatNumber: "A" },
    { id: 2, tripCoachId: 1, rowIndex: 0, cellIndex: 1, seatNumber: "B" },
    { id: 3, tripCoachId: 1, rowIndex: 0, cellIndex: 2, seatNumber: "C" },
  ];
  assert.deepEqual(findSideBySide(seats, 3).map((s) => s.seatNumber), ["A", "B", "C"]);
});

test("side by side: a broken run does not count", () => {
  const seats = [
    { id: 1, tripCoachId: 1, rowIndex: 0, cellIndex: 0, seatNumber: "A" },
    { id: 2, tripCoachId: 1, rowIndex: 0, cellIndex: 1, seatNumber: "B" },
    { id: 3, tripCoachId: 1, rowIndex: 0, cellIndex: 5, seatNumber: "C" },
  ];
  assert.equal(findSideBySide(seats, 3), null);
  assert.equal(findSideBySide(seats, 2).length, 2);
});

test("side by side: seats in different coaches are never adjacent", () => {
  const seats = [
    { id: 1, tripCoachId: 1, rowIndex: 0, cellIndex: 0, seatNumber: "A" },
    { id: 2, tripCoachId: 2, rowIndex: 0, cellIndex: 1, seatNumber: "B" },
  ];
  assert.equal(findSideBySide(seats, 2), null);
});

test("nearby: prefers the window spanning the fewest rows", () => {
  const seats = [
    // Two seats far apart in rows 0 and 9...
    { id: 1, tripCoachId: 1, rowIndex: 0, cellIndex: 0, seatNumber: "far-1" },
    { id: 2, tripCoachId: 1, rowIndex: 9, cellIndex: 0, seatNumber: "far-2" },
    // ...and two in consecutive rows, which is the better answer.
    { id: 3, tripCoachId: 1, rowIndex: 4, cellIndex: 0, seatNumber: "close-1" },
    { id: 4, tripCoachId: 1, rowIndex: 5, cellIndex: 0, seatNumber: "close-2" },
  ];
  const found = findNearby(seats, 2, 1);
  assert.deepEqual(found.map((s) => s.seatNumber), ["close-1", "close-2"]);
});

test("nearby: refuses when the closest pair is further apart than allowed", () => {
  const seats = [
    { id: 1, tripCoachId: 1, rowIndex: 0, cellIndex: 0, seatNumber: "A" },
    { id: 2, tripCoachId: 1, rowIndex: 9, cellIndex: 0, seatNumber: "B" },
  ];
  assert.equal(findNearby(seats, 2, 1), null);
  assert.equal(findSameCoach(seats, 2).length, 2);
});

test("same coach: does not reach across coaches to make up the number", () => {
  const seats = [...coach(1, 1).slice(0, 2), ...coach(2, 1).slice(0, 2)];
  assert.equal(findSameCoach(seats, 3), null);
  assert.equal(findSameCoach(seats, 2).length, 2);
});

/* ------------------------------------------------------------------ *
 * Describing a set of seats after the fact
 * ------------------------------------------------------------------ */

test("describe: one seat is trivially together with itself", () => {
  assert.equal(describeTogetherness([{ tripCoachId: 1, rowIndex: 0, cellIndex: 0 }]), TOGETHERNESS.SIDE_BY_SIDE);
});

test("describe: consecutive cells in one row are side by side", () => {
  assert.equal(
    describeTogetherness([
      { tripCoachId: 1, rowIndex: 0, cellIndex: 0 },
      { tripCoachId: 1, rowIndex: 0, cellIndex: 1 },
    ]),
    TOGETHERNESS.SIDE_BY_SIDE
  );
});

test("describe: across the aisle is the same row, not side by side", () => {
  assert.equal(
    describeTogetherness([
      { tripCoachId: 1, rowIndex: 0, cellIndex: 1 },
      { tripCoachId: 1, rowIndex: 0, cellIndex: 3 },
    ]),
    TOGETHERNESS.SAME_ROW
  );
});

test("describe: one row apart is nearby", () => {
  assert.equal(
    describeTogetherness([
      { tripCoachId: 1, rowIndex: 4, cellIndex: 0 },
      { tripCoachId: 1, rowIndex: 5, cellIndex: 0 },
    ]),
    TOGETHERNESS.NEARBY
  );
});

test("describe: far apart in one coach is same coach", () => {
  assert.equal(
    describeTogetherness([
      { tripCoachId: 1, rowIndex: 0, cellIndex: 0 },
      { tripCoachId: 1, rowIndex: 8, cellIndex: 0 },
    ]),
    TOGETHERNESS.SAME_COACH
  );
});

test("describe: different coaches is scattered", () => {
  assert.equal(
    describeTogetherness([
      { tripCoachId: 1, rowIndex: 0, cellIndex: 0 },
      { tripCoachId: 2, rowIndex: 0, cellIndex: 1 },
    ]),
    TOGETHERNESS.SCATTERED
  );
});

/* ------------------------------------------------------------------ *
 * Selecting
 * ------------------------------------------------------------------ */

test("selects the number of seats asked for", () => {
  const result = autoSelect({ available: coach(1, 5), count: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.seats.length, 3);
});

test("refuses when the train simply does not have enough free seats", () => {
  const result = autoSelect({ available: coach(1, 1).slice(0, 2), count: 4 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, REFUSAL.NOT_ENOUGH_SEATS);
  assert.match(result.message, /Only 2 seat\(s\) are free/);
});

test("says so plainly when nothing at all is free", () => {
  const result = autoSelect({ available: [], count: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.message, "No seats are free for that journey.");
});

test("honours attribute criteria", () => {
  const seats = coach(1, 4, (number, cellIndex) =>
    cellIndex === 0 || cellIndex === 4 ? { window: "full" } : {}
  );
  const result = autoSelect({ available: seats, count: 2, criteria: { window: true } });
  assert.equal(result.ok, true);
  assert.equal(result.seats.every((s) => s.attributes.window), true);
});

test("strict: refuses rather than handing over a seat that misses the point", () => {
  // Exactly one seat has a charging port, and two are wanted.
  const seats = coach(1, 4, (number) => (number === "1-1" ? { charging_port: true } : {}));
  const result = autoSelect({
    available: seats,
    count: 2,
    criteria: { charging_port: true },
    strict: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, REFUSAL.CRITERIA_UNMET);
  assert.equal(result.matchingCount, 1);
  assert.equal(result.breakdown.charging_port, 1);
  assert.match(result.message, /Only 1 of the 16 free seat\(s\) match/);
});

test("strict: names a criterion no free seat can satisfy", () => {
  const result = autoSelect({
    available: coach(1, 2),
    count: 1,
    criteria: { charging_port: true },
    strict: true,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unsatisfiable, ["charging_port"]);
  assert.match(result.message, /No free seat has: charging_port/);
});

test("lenient: widens the pool but reports what was given up", () => {
  const seats = coach(1, 4, (number) => (number === "1-1" ? { charging_port: true } : {}));
  const result = autoSelect({
    available: seats,
    count: 2,
    criteria: { charging_port: true },
    strict: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.seats.length, 2);
  assert.deepEqual(result.relaxed, ["charging_port"]);
  assert.match(result.message, /charging_port was relaxed/);
});

test("lenient: reports nothing relaxed when everything was met", () => {
  const seats = coach(1, 4, () => ({ charging_port: true }));
  const result = autoSelect({ available: seats, count: 2, criteria: { charging_port: true } });
  assert.deepEqual(result.relaxed, []);
  assert.doesNotMatch(result.message, /relaxed/);
});

test("false and empty criteria are ignored, not treated as requirements", () => {
  const seats = coach(1, 2);
  const result = autoSelect({
    available: seats,
    count: 2,
    criteria: { window: false, charging_port: "", fan: null },
    strict: true,
  });
  assert.equal(result.ok, true, result.message);
});

test("together: seats a family side by side when it can", () => {
  const result = autoSelect({ available: coach(1, 5), count: 2, together: true });
  assert.equal(result.ok, true);
  assert.equal(result.togetherness, TOGETHERNESS.SIDE_BY_SIDE);
  assert.equal(result.togetherLabel, "side by side");
  assert.match(result.message, /side by side/);
});

test("together: falls back through the tiers as the coach fills up", () => {
  // One pair left in a row, split by the aisle; nothing adjacent anywhere.
  const seats = coach(1, 3).filter((s) => s.cellIndex === 1 || s.cellIndex === 3);
  const result = autoSelect({ available: seats, count: 2, together: true });
  assert.equal(result.ok, true);
  assert.equal(result.togetherness, TOGETHERNESS.SAME_ROW);
});

test("together, strict: refuses when the best it can do is scattered", () => {
  const seats = [
    { id: 1, tripCoachId: 1, rowIndex: 0, cellIndex: 0, seatNumber: "A", attributes: {} },
    { id: 2, tripCoachId: 2, rowIndex: 0, cellIndex: 0, seatNumber: "B", attributes: {} },
  ];
  const result = autoSelect({ available: seats, count: 2, together: true, strict: true });

  assert.equal(result.ok, false);
  assert.equal(result.reason, REFUSAL.CANNOT_SEAT_TOGETHER);
  assert.match(result.message, /no run of 2 free seats together/i);
});

test("together, strict: accepts the same row even though it is not side by side", () => {
  const seats = coach(1, 1).filter((s) => s.cellIndex === 1 || s.cellIndex === 3);
  const result = autoSelect({ available: seats, count: 2, together: true, strict: true });
  assert.equal(result.ok, true);
  assert.equal(result.togetherness, TOGETHERNESS.SAME_ROW);
});

test("together, lenient: takes what it can get and says how close it is", () => {
  const seats = [
    { id: 1, tripCoachId: 1, rowIndex: 0, cellIndex: 0, seatNumber: "A", attributes: {} },
    { id: 2, tripCoachId: 2, rowIndex: 0, cellIndex: 0, seatNumber: "B", attributes: {} },
  ];
  const result = autoSelect({ available: seats, count: 2, together: true });
  assert.equal(result.ok, true);
  assert.equal(result.togetherness, TOGETHERNESS.SCATTERED);
  assert.match(result.message, /spread across the train/);
});

test("together and criteria compose: adjacency is sought inside the matching seats", () => {
  // Window seats sit at cells 0 and 4 — never adjacent. Only the middle pair is.
  const seats = coach(1, 4, (number, cellIndex) =>
    cellIndex === 1 || cellIndex === 3 ? { charging_port: true } : {}
  );
  const result = autoSelect({
    available: seats,
    count: 2,
    criteria: { charging_port: true },
    together: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.seats.every((s) => s.attributes.charging_port), true);
  assert.deepEqual(result.relaxed, []);
});

test("a single seat request is satisfied without pretending it is a group", () => {
  const result = autoSelect({ available: coach(1, 2), count: 1, together: true });
  assert.equal(result.ok, true);
  assert.equal(result.seats.length, 1);
});

test("selection is stable: the same input gives the same seats", () => {
  const first = autoSelect({ available: coach(1, 6), count: 3, together: true });
  const second = autoSelect({ available: coach(1, 6), count: 3, together: true });
  assert.deepEqual(numbers(first), numbers(second));
});

test("a count below one is treated as one rather than returning nothing", () => {
  const result = autoSelect({ available: coach(1, 1), count: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.seats.length, 1);
});
