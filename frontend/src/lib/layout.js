// Pure helpers for manipulating a seat-plan layout. The layout shape mirrors
// the backend (backend/src/utils/normalizeLayout.js):
//   { columns, fromStation, toStation, stationsSwapped,
//     direction: { splitRow, flipped },
//     numbering: { start, prefix, order: "ltr" | "rtl" | "snake" },
//     rows: [ { id, reversed, cells: [...] } ] }
// A row's `reversed` flips the way it is numbered — what mirroring it does,
// so a mirrored row keeps numbering itself.

export const MAX_COLUMNS = 6;
export const MAX_SEATS_PER_ROW = 5;

export function genId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function makeSeat(number = "") {
  return {
    kind: "seat",
    id: genId(),
    number: String(number),
    numberManual: false,
    isWindow: false,
    windowManual: false,
    windowType: "full",
    chargingPort: false,
    fan: false,
    note: "",
  };
}

export function makeBlank() {
  return { kind: "blank" };
}

/** A fresh layout with one starter row (2 seats · aisle · 2 seats). */
export function createEmptyLayout() {
  const layout = {
    columns: MAX_COLUMNS,
    fromStation: "",
    toStation: "",
    stationsSwapped: false,
    direction: { splitRow: 0, flipped: false },
    rows: [
      { id: genId(), cells: [makeSeat(), makeSeat(), makeBlank(), makeSeat(), makeSeat()] },
    ],
  };
  layout.direction.splitRow = Math.floor(layout.rows.length / 2);
  return recompute(layout);
}

const seatCount = (row) => row.cells.filter((c) => c.kind === "seat").length;
const seatIndexes = (row) => row.cells.map((c, i) => (c.kind === "seat" ? i : -1)).filter((i) => i >= 0);

export const NUMBERING_ORDERS = Object.freeze(["ltr", "rtl", "snake"]);
export const DEFAULT_NUMBERING = Object.freeze({ start: 1, prefix: "", order: "ltr" });

/** How the plan numbers its seats: from which number, with what in front, in which order. */
export const numberingOf = (layout) => ({ ...DEFAULT_NUMBERING, ...(layout.numbering || {}) });

/** Whether a row is numbered right to left: by the plan's order, snaking, or the row mirrored. */
function numberedBackwards(layout, row, rowIndex) {
  const { order } = numberingOf(layout);
  const back = order === "rtl" || (order === "snake" && rowIndex % 2 === 1);
  return row.reversed ? !back : back;
}

/**
 * Every seat's place in numbering order, as "row:cell" keys. Rows top to
 * bottom; within a row left to right, or right to left as the row goes.
 */
export function numberingOrder(layout) {
  return layout.rows.flatMap((row, r) => {
    const idxs = seatIndexes(row);
    return (numberedBackwards(layout, row, r) ? idxs.reverse() : idxs).map((c) => `${r}:${c}`);
  });
}

function renumber(layout, keepManual) {
  const { start, prefix } = numberingOf(layout);
  const numberAt = new Map(numberingOrder(layout).map((key, pos) => [key, `${prefix}${start + pos}`]));
  const rows = layout.rows.map((row, r) => ({
    ...row,
    cells: row.cells.map((c, i) => {
      if (c.kind !== "seat") return c;
      if (keepManual && c.numberManual) return c;
      return { ...c, number: numberAt.get(`${r}:${i}`), numberManual: false };
    }),
  }));
  return { ...layout, rows };
}

/** Auto-numbers seats in numbering order; manual seats keep their number but
 *  still consume a position so the sequence stays stable across edits. */
export function autoRenumber(layout) {
  return renumber(layout, true);
}

/** Resets every seat to a clean sequential number, clearing manual overrides. */
export function renumberAll(layout) {
  return renumber(layout, false);
}

/** Change how the plan numbers its seats, and renumber the automatic ones. */
export function setNumbering(layout, patch) {
  const next = { ...numberingOf(layout), ...patch };
  const start = Number.isInteger(Number(next.start)) ? Math.min(Math.max(Number(next.start), 0), 9999) : 1;
  const numbering = {
    start,
    prefix: String(next.prefix ?? "").slice(0, 6),
    order: NUMBERING_ORDERS.includes(next.order) ? next.order : "ltr",
  };
  return recompute({ ...layout, numbering });
}

/** Marks the leftmost/rightmost seat of each row as a window (non-manual only). */
export function autoWindows(layout) {
  const rows = layout.rows.map((row) => {
    const seatIdxs = row.cells
      .map((c, i) => (c.kind === "seat" ? i : -1))
      .filter((i) => i >= 0);
    const edge = new Set([seatIdxs[0], seatIdxs[seatIdxs.length - 1]]);
    return {
      ...row,
      cells: row.cells.map((c, i) => {
        if (c.kind !== "seat" || c.windowManual) return c;
        const isWindow = edge.has(i);
        return { ...c, isWindow, windowType: isWindow ? c.windowType || "full" : null };
      }),
    };
  });
  return { ...layout, rows };
}

/** Re-derive auto numbers + auto windows. Call after any structural change. */
export function recompute(layout) {
  return autoWindows(autoRenumber(layout));
}

export function addRowAt(layout, index, position) {
  const at = position === "below" ? index + 1 : index;
  const adjacent = layout.rows[index];
  // New row copies the adjacent row's seat/blank pattern with fresh seats.
  const cells = adjacent
    ? adjacent.cells.map((c) => (c.kind === "seat" ? makeSeat() : makeBlank()))
    : [makeSeat(), makeSeat(), makeBlank(), makeSeat(), makeSeat()];
  const rows = [...layout.rows];
  rows.splice(at, 0, { id: genId(), cells });
  return recompute({ ...layout, rows });
}

export function deleteRow(layout, index) {
  const rows = layout.rows.filter((_, i) => i !== index);
  const splitRow = Math.min(layout.direction.splitRow, rows.length);
  return recompute({ ...layout, rows, direction: { ...layout.direction, splitRow } });
}

export function moveRow(layout, index, dir) {
  const target = index + dir;
  if (target < 0 || target >= layout.rows.length) return layout;
  const rows = [...layout.rows];
  [rows[index], rows[target]] = [rows[target], rows[index]];
  return recompute({ ...layout, rows });
}

function mapRow(layout, rowIdx, fn) {
  const rows = layout.rows.map((row, i) => (i === rowIdx ? fn(row) : row));
  return { ...layout, rows };
}

export function toggleCellKind(layout, rowIdx, cellIdx) {
  const updated = mapRow(layout, rowIdx, (row) => {
    const cell = row.cells[cellIdx];
    const next = cell.kind === "seat" ? makeBlank() : makeSeat();
    if (next.kind === "seat" && seatCount(row) >= MAX_SEATS_PER_ROW) return row;
    const cells = row.cells.map((c, i) => (i === cellIdx ? next : c));
    return { ...row, cells };
  });
  return recompute(updated);
}

export function addCell(layout, rowIdx, kind) {
  const updated = mapRow(layout, rowIdx, (row) => {
    if (row.cells.length >= layout.columns) return row;
    if (kind === "seat" && seatCount(row) >= MAX_SEATS_PER_ROW) return row;
    const cell = kind === "seat" ? makeSeat() : makeBlank();
    return { ...row, cells: [...row.cells, cell] };
  });
  return recompute(updated);
}

export function removeCell(layout, rowIdx, cellIdx) {
  const updated = mapRow(layout, rowIdx, (row) => ({
    ...row,
    cells: row.cells.filter((_, i) => i !== cellIdx),
  }));
  return recompute(updated);
}

/** Patch a seat's attributes. Editing number/window sets the manual flag so
 *  auto-recompute won't clobber the planner's choice. */
export function updateSeat(layout, rowIdx, cellIdx, patch) {
  const updated = mapRow(layout, rowIdx, (row) => ({
    ...row,
    cells: row.cells.map((c, i) => {
      if (i !== cellIdx || c.kind !== "seat") return c;
      const next = { ...c, ...patch };
      if (patch.number !== undefined) next.numberManual = true;
      if (patch.isWindow !== undefined) {
        next.windowManual = true;
        if (patch.isWindow && !next.windowType) next.windowType = "full";
        if (!patch.isWindow) next.windowType = null;
      }
      return next;
    }),
  }));
  // Window edits can change edges; renumber not needed, but keep numbers stable.
  return { ...updated };
}

export function setSplitRow(layout, splitRow) {
  const clamped = Math.min(Math.max(splitRow, 0), layout.rows.length);
  return { ...layout, direction: { ...layout.direction, splitRow: clamped } };
}

export function flipDirection(layout) {
  return { ...layout, direction: { ...layout.direction, flipped: !layout.direction.flipped } };
}

export function swapStations(layout) {
  return { ...layout, stationsSwapped: !layout.stationsSwapped };
}

/** Visual facing ('up' | 'down') for a row given the divider + flip. */
export function seatDirection(layout, rowIndex) {
  const topGroup = rowIndex < layout.direction.splitRow;
  let facesDown = topGroup; // default: halves face inward toward the divider
  if (layout.direction.flipped) facesDown = !facesDown;
  return facesDown ? "down" : "up";
}

/** The two station labels in display order (top, bottom). */
export function stationEnds(layout) {
  const a = layout.fromStation || "From";
  const b = layout.toStation || "To";
  return layout.stationsSwapped ? { top: b, bottom: a } : { top: a, bottom: b };
}

/* ------------------------------------------------------------------ *
 * Several seats at once. A seat is named by its place: "row:cell".
 * ------------------------------------------------------------------ */

export const keyOf = (rowIdx, cellIdx) => `${rowIdx}:${cellIdx}`;
export const placeOf = (key) => key.split(":").map(Number);

/** Keys in reading order: top to bottom, left to right. */
export const inReadingOrder = (keys) =>
  [...keys].sort((a, b) => {
    const [ra, ca] = placeOf(a);
    const [rb, cb] = placeOf(b);
    return ra - rb || ca - cb;
  });

/** Every seat's key. */
export const allSeatKeys = (layout) => layout.rows.flatMap((row, r) => seatIndexes(row).map((c) => keyOf(r, c)));

/** The seats in a rectangle between two places — what Shift-click selects. */
export function seatKeysBetween(layout, fromKey, toKey) {
  const [r1, c1] = placeOf(fromKey);
  const [r2, c2] = placeOf(toKey);
  const [top, bottom] = [Math.min(r1, r2), Math.max(r1, r2)];
  const [left, right] = [Math.min(c1, c2), Math.max(c1, c2)];
  return allSeatKeys(layout).filter((key) => {
    const [r, c] = placeOf(key);
    return r >= top && r <= bottom && c >= left && c <= right;
  });
}

/** The rows the seats are in, top to bottom. */
export const rowsOf = (keys) => [...new Set([...keys].map((k) => placeOf(k)[0]))].sort((a, b) => a - b);

function mapSeats(layout, keys, fn) {
  const wanted = new Set(keys);
  const rows = layout.rows.map((row, r) => ({
    ...row,
    cells: row.cells.map((c, i) => (wanted.has(keyOf(r, i)) && c.kind === "seat" ? fn(c) : c)),
  }));
  return { ...layout, rows };
}

/** The same change to several seats — window, charging port, fan, note. */
export function patchSeats(layout, keys, patch) {
  return mapSeats(layout, keys, (c) => {
    const seat = { ...c, ...patch };
    if (patch.isWindow !== undefined) {
      seat.windowManual = true;
      seat.windowType = patch.isWindow ? c.windowType || "full" : null;
    }
    return seat;
  });
}

/** Seats into blanks: the places stay, the seats go. */
export function seatsToBlanks(layout, keys) {
  return recompute(mapSeats(layout, keys, () => makeBlank()));
}

/** Take the cells out of their rows altogether. */
export function removeCells(layout, keys) {
  const gone = new Set(keys);
  const rows = layout.rows.map((row, r) => ({ ...row, cells: row.cells.filter((_, i) => !gone.has(keyOf(r, i))) }));
  return recompute({ ...layout, rows });
}

/**
 * Number the chosen seats by hand, in numbering order, from `start`, with
 * the prefix given. The rest keep theirs.
 */
export function renumberSeats(layout, keys, start, prefix = "") {
  const wanted = new Set(keys);
  const order = numberingOrder(layout).filter((k) => wanted.has(k));
  const numberAt = new Map(order.map((key, i) => [key, `${prefix}${Number(start) + i}`]));
  const rows = layout.rows.map((row, r) => ({
    ...row,
    cells: row.cells.map((c, i) => {
      const n = numberAt.get(keyOf(r, i));
      return n === undefined || c.kind !== "seat" ? c : { ...c, number: n, numberManual: true };
    }),
  }));
  return { ...layout, rows };
}

/* ------------------------------------------------------------------ *
 * Mirror and swap
 * ------------------------------------------------------------------ */

/**
 * Left to right: each chosen row's seats in reverse order, the blanks (the
 * corridor) where they were. A seat takes everything with it, its number
 * too: the row now numbers itself the other way. All rows when none given.
 */
export function mirrorRows(layout, rowIdxs) {
  const which = new Set(rowIdxs ?? layout.rows.map((_, i) => i));
  const rows = layout.rows.map((row, r) => {
    if (!which.has(r)) return row;
    const idxs = seatIndexes(row);
    const seats = idxs.map((i) => row.cells[i]).reverse();
    const cells = [...row.cells];
    idxs.forEach((i, k) => {
      cells[i] = seats[k];
    });
    return { ...row, reversed: !row.reversed, cells };
  });
  return recompute({ ...layout, rows });
}

/**
 * Two groups of seats, the same number in each, change places, paired in
 * reading order. Each seat takes everything with it, its number too, which
 * stays as a typed-in number from then on.
 */
export function swapSeats(layout, groupA, groupB) {
  const a = inReadingOrder(groupA);
  const b = inReadingOrder(groupB);
  if (!a.length || a.length !== b.length) throw new Error("Choose the same number of seats on each side");
  if (a.some((k) => b.includes(k))) throw new Error("A seat cannot be on both sides");
  const at = (key) => {
    const [r, c] = placeOf(key);
    return layout.rows[r]?.cells[c];
  };
  if ([...a, ...b].some((k) => at(k)?.kind !== "seat")) throw new Error("Only seats can be swapped");
  const moved = new Map();
  a.forEach((k, i) => {
    moved.set(k, at(b[i]));
    moved.set(b[i], at(k));
  });
  const rows = layout.rows.map((row, r) => ({
    ...row,
    cells: row.cells.map((c, i) => {
      const seat = moved.get(keyOf(r, i));
      return seat ? { ...seat, numberManual: true } : c;
    }),
  }));
  return recompute({ ...layout, rows });
}

/* ------------------------------------------------------------------ *
 * Rows: copied, repeated, built
 * ------------------------------------------------------------------ */

/** A copy of a row: fresh ids, the same seats and details, numbered automatically. */
export function copyRow(row) {
  return {
    id: genId(),
    reversed: Boolean(row.reversed),
    cells: row.cells.map((c) => (c.kind === "seat" ? { ...c, id: genId(), numberManual: false } : makeBlank())),
  };
}

/** Put copies of rows in below a row (or at the top, with -1). */
export function insertRows(layout, afterIdx, newRows) {
  const rows = [...layout.rows];
  rows.splice(afterIdx + 1, 0, ...newRows.map(copyRow));
  return recompute({ ...layout, rows });
}

export const duplicateRow = (layout, rowIdx) => insertRows(layout, rowIdx, [layout.rows[rowIdx]]);

/** The chosen rows, in order, again and again below the last of them. */
export function repeatRows(layout, rowIdxs, times) {
  const n = Math.min(Math.max(Math.floor(Number(times)) || 0, 1), 50);
  const block = [...rowIdxs].sort((x, y) => x - y).map((i) => layout.rows[i]);
  return insertRows(layout, Math.max(...rowIdxs), Array.from({ length: n }, () => block).flat());
}

/** The patterns offered: seats left of the corridor + seats right of it. */
export const ROW_PATTERNS = Object.freeze([
  [2, 2],
  [2, 3],
  [3, 2],
  [1, 2],
  [2, 1],
  [3, 1],
  [1, 3],
]);

/** A row of `left` seats, the corridor, `right` seats, or one side only. */
export function patternRow(left, right) {
  const cells = [
    ...Array.from({ length: left }, () => makeSeat()),
    ...(left && right ? [makeBlank()] : []),
    ...Array.from({ length: right }, () => makeSeat()),
  ];
  if (!cells.length || left + right > MAX_SEATS_PER_ROW || cells.length > MAX_COLUMNS) {
    throw new Error(`A row holds at most ${MAX_SEATS_PER_ROW} seats and ${MAX_COLUMNS} places`);
  }
  return { id: genId(), cells };
}

/** `count` rows of a pattern, added at the end, or replacing every row there is. */
export function buildRows(layout, { count, left, right, replace = false }) {
  const n = Math.min(Math.max(Math.floor(Number(count)) || 0, 1), 60);
  const rows = Array.from({ length: n }, () => patternRow(Number(left), Number(right)));
  const next = replace ? { ...layout, rows } : { ...layout, rows: [...layout.rows, ...rows] };
  const splitRow = replace ? Math.floor(rows.length / 2) : layout.direction.splitRow;
  return recompute({ ...next, direction: { ...layout.direction, splitRow } });
}

/* ------------------------------------------------------------------ *
 * What is worth knowing before saving
 * ------------------------------------------------------------------ */

/**
 * The plan checked as saving checks it, and summed up:
 *   duplicates  numbers on more than one seat, each with the seats' keys
 *   unnumbered  seats with no number (nobody can book them)
 *   gaps        numbers missing from the run (when they are all plain numbers)
 *   seats, windows, rows, byRow  { seatsInRow: rows with that many }
 */
export function checkLayout(layout) {
  const byNumber = new Map();
  const unnumbered = [];
  let windows = 0;
  const byRow = {};
  layout.rows.forEach((row, r) => {
    const n = seatCount(row);
    byRow[n] = (byRow[n] || 0) + 1;
    row.cells.forEach((c, i) => {
      if (c.kind !== "seat") return;
      if (c.isWindow) windows += 1;
      const number = String(c.number ?? "").trim();
      if (!number) unnumbered.push(keyOf(r, i));
      else byNumber.set(number, [...(byNumber.get(number) || []), keyOf(r, i)]);
    });
  });
  const duplicates = [...byNumber].filter(([, keys]) => keys.length > 1).map(([number, keys]) => ({ number, keys }));
  const { prefix } = numberingOf(layout);
  const plain = [...byNumber.keys()].map((n) => (prefix && n.startsWith(prefix) ? n.slice(prefix.length) : n));
  const gaps = [];
  if (plain.length && plain.every((n) => /^\d+$/.test(n))) {
    const have = new Set(plain.map(Number));
    const top = Math.max(...have);
    for (let x = Math.min(...have); x <= top && gaps.length < 50; x += 1) if (!have.has(x)) gaps.push(`${prefix}${x}`);
  }
  const seats = [...byNumber.values()].reduce((s, k) => s + k.length, 0) + unnumbered.length;
  return { duplicates, unnumbered, gaps, seats, windows, rows: layout.rows.length, byRow };
}
