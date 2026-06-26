const crypto = require("crypto");
const ApiError = require("./ApiError");

const MAX_COLUMNS = 6;
const MAX_SEATS_PER_ROW = 5;
const WINDOW_TYPES = ["half", "full"];

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function asBool(v) {
  return v === true;
}

function asString(v, fallback = "") {
  return typeof v === "string" ? v : fallback;
}

function normalizeSeat(cell, rowIndex) {
  const isWindow = asBool(cell.isWindow);
  let windowType = null;
  if (isWindow) {
    windowType = WINDOW_TYPES.includes(cell.windowType) ? cell.windowType : "full";
  }
  return {
    kind: "seat",
    id: asString(cell.id) || crypto.randomUUID(),
    number: asString(cell.number == null ? "" : String(cell.number)),
    numberManual: asBool(cell.numberManual),
    isWindow,
    windowManual: asBool(cell.windowManual),
    windowType,
    chargingPort: asBool(cell.chargingPort),
    fan: asBool(cell.fan),
    note: asString(cell.note),
  };
}

function normalizeCell(cell, rowIndex) {
  if (!cell || typeof cell !== "object") {
    return { kind: "blank" };
  }
  if (cell.kind === "blank") return { kind: "blank" };
  if (cell.kind === "seat") return normalizeSeat(cell, rowIndex);
  throw ApiError.badRequest(`Row ${rowIndex + 1} has a cell with an invalid kind`);
}

function normalizeRow(row, rowIndex, columns) {
  const cellsIn = Array.isArray(row && row.cells) ? row.cells : [];
  if (cellsIn.length > columns) {
    throw ApiError.badRequest(
      `Row ${rowIndex + 1} has ${cellsIn.length} cells (max ${columns})`
    );
  }
  const cells = cellsIn.map((c) => normalizeCell(c, rowIndex));
  const seatCount = cells.filter((c) => c.kind === "seat").length;
  if (seatCount > MAX_SEATS_PER_ROW) {
    throw ApiError.badRequest(
      `Row ${rowIndex + 1} has ${seatCount} seats (max ${MAX_SEATS_PER_ROW})`
    );
  }
  return {
    id: asString(row && row.id) || crypto.randomUUID(),
    cells,
  };
}

/**
 * Validates and normalizes a raw seat-plan layout into a known shape, filling
 * defaults and enforcing the structural caps (<= 6 cells and <= 5 seats per
 * row). Throws ApiError.badRequest on structural violations.
 */
function normalizeLayout(raw) {
  const layout = raw && typeof raw === "object" ? raw : {};
  const columns = clampInt(layout.columns, 1, MAX_COLUMNS, MAX_COLUMNS);

  const rowsIn = Array.isArray(layout.rows) ? layout.rows : [];
  const rows = rowsIn.map((row, i) => normalizeRow(row, i, columns));

  const dir = layout.direction && typeof layout.direction === "object" ? layout.direction : {};
  const splitRow = clampInt(dir.splitRow, 0, rows.length, Math.floor(rows.length / 2));

  return {
    columns,
    fromStation: asString(layout.fromStation),
    toStation: asString(layout.toStation),
    stationsSwapped: asBool(layout.stationsSwapped),
    direction: { splitRow, flipped: asBool(dir.flipped) },
    rows,
  };
}

module.exports = { normalizeLayout, MAX_COLUMNS, MAX_SEATS_PER_ROW };
