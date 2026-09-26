/**
 * Flattens a seat-plan layout into one record per physical seat.
 *
 * A layout is one JSON document, which is exactly right for drawing a coach and
 * exactly wrong for selling one. Availability asks relational questions —
 * "which window seats in this class are free between these two stations" — and
 * answering them by scanning documents does not scale. So a departure's seats
 * become rows, once, at generation time.
 *
 * Pure and dependency-free, so the flattening can be tested on its own. Blanks
 * (corridors, tables, toilets) are skipped: they were never sellable.
 */

/**
 * Build the catalogue-keyed attribute document for a seat.
 *
 * The named fields on a seat are the legacy shape; `seat.attributes` is the
 * catalogue-driven one introduced in Phase 2. Both are merged, with the
 * explicit document winning, so plans authored either way materialise the same.
 */
function seatAttributes(seat) {
  const attributes = {};

  if (seat.isWindow) attributes.window = seat.windowType || "full";
  if (seat.chargingPort) attributes.charging_port = true;
  if (seat.fan) attributes.fan = true;

  if (seat.attributes && typeof seat.attributes === "object") {
    Object.assign(attributes, seat.attributes);
  }

  return attributes;
}

/**
 * @returns {Array<{seatNumber, rowIndex, cellIndex, isWindow, windowType,
 *   chargingPort, fan, note, attributes}>}
 * @throws if two seats in the layout share a number — a coach cannot sell the
 *   same seat twice, and catching it here is far cheaper than at booking time.
 */
function materializeSeats(layout) {
  const rows = Array.isArray(layout?.rows) ? layout.rows : [];
  const seats = [];
  const seen = new Set();

  rows.forEach((row, rowIndex) => {
    const cells = Array.isArray(row?.cells) ? row.cells : [];

    cells.forEach((cell, cellIndex) => {
      if (!cell || cell.kind !== "seat") return;

      const seatNumber = String(cell.number ?? "").trim();
      // An unnumbered cell is a drawing artefact, not a seat anyone can book.
      if (!seatNumber) return;

      if (seen.has(seatNumber)) {
        throw new Error(`Seat "${seatNumber}" appears more than once in this layout`);
      }
      seen.add(seatNumber);

      seats.push({
        seatNumber,
        rowIndex,
        cellIndex,
        isWindow: Boolean(cell.isWindow),
        windowType: cell.isWindow ? cell.windowType || "full" : null,
        chargingPort: Boolean(cell.chargingPort),
        fan: Boolean(cell.fan),
        note: cell.note ? String(cell.note).slice(0, 300) : null,
        attributes: seatAttributes(cell),
      });
    });
  });

  return seats;
}

/** How many sellable seats a layout holds, without building the rows. */
function countSeats(layout) {
  return materializeSeats(layout).length;
}

module.exports = { materializeSeats, countSeats, seatAttributes };
