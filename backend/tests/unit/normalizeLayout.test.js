const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeLayout } = require("../../src/utils/normalizeLayout");

const seat = (number) => ({ kind: "seat", id: `s${number}`, number: String(number) });
const blank = { kind: "blank" };

test("how the editor numbers seats is kept: start, prefix, order", () => {
  const out = normalizeLayout({ numbering: { start: 11, prefix: "K-", order: "snake" }, rows: [] });
  assert.deepEqual(out.numbering, { start: 11, prefix: "K-", order: "snake" });
});

test("a plan saved before there was numbering gets the plain kind", () => {
  assert.deepEqual(normalizeLayout({ rows: [] }).numbering, { start: 1, prefix: "", order: "ltr" });
});

test("numbering out of bounds is brought back within them", () => {
  const out = normalizeLayout({ numbering: { start: -5, prefix: "TOOLONGPREFIX", order: "sideways" }, rows: [] });
  assert.deepEqual(out.numbering, { start: 0, prefix: "TOOLON", order: "ltr" });
});

test("a mirrored row says so; any other does not", () => {
  const out = normalizeLayout({
    rows: [
      { id: "a", reversed: true, cells: [seat(2), seat(1), blank] },
      { id: "b", cells: [seat(3), blank, seat(4)] },
    ],
  });
  assert.equal(out.rows[0].reversed, true);
  assert.equal(out.rows[1].reversed, false);
});
