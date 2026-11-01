// The seat-plan editor's own logic (src/lib/layout.js): numbering, mirroring,
// swapping, rows copied and built, several seats at once, the checks.
//   npm test
import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/lib/layout.js";

/** A layout from a picture: "SS_SS" is two seats, the corridor, two seats. */
function plan(...rows) {
  return L.recompute({
    ...L.createEmptyLayout(),
    rows: rows.map((r) => ({ id: L.genId(), cells: [...r].map((ch) => (ch === "S" ? L.makeSeat() : L.makeBlank())) })),
  });
}
/** Each row as it reads: numbers, "_" for a blank. */
const picture = (layout) => layout.rows.map((row) => row.cells.map((c) => (c.kind === "seat" ? c.number : "_")).join(" "));

test("numbered left to right, top to bottom, by default", () => {
  assert.deepEqual(picture(plan("SS_SS", "SS_SS")), ["1 2 _ 3 4", "5 6 _ 7 8"]);
});

test("numbering: a start, a prefix, right to left, snaking", () => {
  const p = plan("SS_SS", "SS_SS");
  assert.deepEqual(picture(L.setNumbering(p, { start: 11, prefix: "K-" })), ["K-11 K-12 _ K-13 K-14", "K-15 K-16 _ K-17 K-18"]);
  assert.deepEqual(picture(L.setNumbering(p, { order: "rtl" })), ["4 3 _ 2 1", "8 7 _ 6 5"]);
  assert.deepEqual(picture(L.setNumbering(p, { order: "snake" })), ["1 2 _ 3 4", "8 7 _ 6 5"]);
});

test("mirrored left to right: the seats reversed, the corridor where it was", () => {
  const p = L.patchSeats(plan("SS_SS", "SS_SS"), ["0:0"], { chargingPort: true, note: "by the door" });
  const m = L.mirrorRows(p, [0]);
  assert.deepEqual(picture(m), ["4 3 _ 2 1", "5 6 _ 7 8"]);
  const moved = m.rows[0].cells[4];
  assert.equal(moved.number, "1");
  assert.equal(moved.chargingPort, true, "a seat takes its details with it");
  assert.equal(moved.note, "by the door");
  assert.equal(m.rows[0].cells[2].kind, "blank");
  assert.equal(m.rows[0].reversed, true);
  assert.deepEqual(picture(L.mirrorRows(m, [0])), picture(p), "twice is as it was");
});

test("mirroring keeps a row's shape when its sides differ, and numbers on after rows are added", () => {
  const m = L.mirrorRows(plan("SS_S", "SS_SS"));
  assert.deepEqual(picture(m), ["3 2 _ 1", "7 6 _ 5 4"]);
  const more = L.addRowAt(m, 0, "above");
  assert.deepEqual(picture(more).slice(0, 2), ["1 2 _ 3", "6 5 _ 4"], "still numbering itself, the other way");
});

test("two groups of seats swap places, paired in reading order, numbers and all", () => {
  const p = L.patchSeats(plan("SS_SS", "SS_SS"), ["0:0"], { fan: true });
  const s = L.swapSeats(p, ["0:0", "0:1"], ["1:3", "1:4"]);
  assert.deepEqual(picture(s), ["7 8 _ 3 4", "5 6 _ 1 2"]);
  assert.equal(s.rows[1].cells[3].fan, true);
  assert.equal(s.rows[1].cells[3].numberManual, true, "kept as typed in from then on");
  assert.throws(() => L.swapSeats(p, ["0:0"], ["1:0", "1:1"]), /same number/);
  assert.throws(() => L.swapSeats(p, ["0:0"], ["0:0"]), /both sides/);
  assert.throws(() => L.swapSeats(p, ["0:2"], ["1:0"]), /Only seats/);
});

test("renumber all clears the typed-in numbers; renumber some types them in", () => {
  const s = L.swapSeats(plan("SS_SS"), ["0:0"], ["0:4"]);
  assert.deepEqual(picture(L.renumberAll(s)), ["1 2 _ 3 4"]);
  const typed = L.renumberSeats(plan("SS_SS", "SS_SS"), ["1:0", "1:1"], 101, "A");
  assert.deepEqual(picture(typed), ["1 2 _ 3 4", "A101 A102 _ 7 8"]);
});

test("rows duplicated, repeated, copied in: fresh seats, numbered on", () => {
  const p = L.patchSeats(plan("SS_SS"), ["0:1"], { isWindow: true });
  const d = L.duplicateRow(p, 0);
  assert.deepEqual(picture(d), ["1 2 _ 3 4", "5 6 _ 7 8"]);
  assert.notEqual(d.rows[1].id, d.rows[0].id);
  assert.notEqual(d.rows[1].cells[0].id, d.rows[0].cells[0].id);
  assert.equal(d.rows[1].cells[1].isWindow, true);
  assert.equal(L.repeatRows(plan("SS_SS", "S_S"), [0, 1], 3).rows.length, 8);
  assert.deepEqual(picture(L.insertRows(plan("SS_SS"), -1, [plan("S_S").rows[0]])), ["1 _ 2", "3 4 _ 5 6"]);
});

test("rows built from a pattern, within a row's limits", () => {
  const b = L.buildRows(plan("SS_SS"), { count: 3, left: 2, right: 3 });
  assert.equal(b.rows.length, 4);
  assert.deepEqual(picture(b)[3], "15 16 _ 17 18 19");
  const fresh = L.buildRows(plan("SS_SS"), { count: 20, left: 3, right: 2, replace: true });
  assert.equal(fresh.rows.length, 20);
  assert.equal(fresh.direction.splitRow, 10);
  assert.throws(() => L.patternRow(3, 3), /at most 5 seats/);
});

test("several seats at once: a rectangle, a change, blanks, gone", () => {
  const p = plan("SS_SS", "SS_SS", "SS_SS");
  assert.deepEqual(L.seatKeysBetween(p, "0:1", "1:3"), ["0:1", "0:3", "1:1", "1:3"]);
  const fans = L.patchSeats(p, ["0:0", "2:4"], { fan: true });
  assert.equal(fans.rows[0].cells[0].fan && fans.rows[2].cells[4].fan, true);
  assert.deepEqual(picture(L.seatsToBlanks(p, ["0:0", "0:1"])), ["_ _ _ 1 2", "3 4 _ 5 6", "7 8 _ 9 10"]);
  assert.deepEqual(picture(L.removeCells(p, ["0:0", "0:1"]))[0], "_ 1 2");
  assert.deepEqual(L.rowsOf(["2:1", "0:3", "2:0"]), [0, 2]);
});

test("the checks: numbers twice, no number, gaps, and the sums", () => {
  let p = plan("SS_SS", "SS_SS");
  p = L.updateSeat(p, 1, 0, { number: "2" });
  p = L.updateSeat(p, 1, 1, { number: "" });
  const c = L.checkLayout(p);
  assert.deepEqual(c.duplicates, [{ number: "2", keys: ["0:1", "1:0"] }]);
  assert.deepEqual(c.unnumbered, ["1:1"]);
  assert.deepEqual(c.gaps, ["5", "6"]);
  assert.equal(c.seats, 8);
  assert.equal(c.windows, 4);
  assert.deepEqual(c.byRow, { 4: 2 });
});
