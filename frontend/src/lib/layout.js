// Pure helpers for manipulating a seat-plan layout. The layout shape mirrors
// the backend (backend/src/utils/normalizeLayout.js):
//   { columns, fromStation, toStation, stationsSwapped,
//     direction: { splitRow, flipped }, rows: [ { id, cells: [...] } ] }

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

/** Auto-numbers seats in reading order; manual seats keep their number but
 *  still consume a position so the sequence stays stable across edits. */
export function autoRenumber(layout) {
  let pos = 0;
  const rows = layout.rows.map((row) => ({
    ...row,
    cells: row.cells.map((c) => {
      if (c.kind !== "seat") return c;
      pos += 1;
      return c.numberManual ? c : { ...c, number: String(pos) };
    }),
  }));
  return { ...layout, rows };
}

/** Resets every seat to a clean sequential number, clearing manual overrides. */
export function renumberAll(layout) {
  let pos = 0;
  const rows = layout.rows.map((row) => ({
    ...row,
    cells: row.cells.map((c) => {
      if (c.kind !== "seat") return c;
      pos += 1;
      return { ...c, number: String(pos), numberManual: false };
    }),
  }));
  return { ...layout, rows };
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
