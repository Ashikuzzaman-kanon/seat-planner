/**
 * Reading and writing CSV as spreadsheets save it: fields in double quotes may
 * hold commas, line breaks and doubled quotes; lines end in CRLF or LF; Excel
 * starts a UTF-8 file with a byte-order mark.
 */

/** Text → rows of fields. Blank lines are dropped. */
function parseCsv(text) {
  const src = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** A field as CSV: quoted when it has to be. */
const cell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Rows → text, with a byte-order mark so Excel reads it as UTF-8. */
function toCsv(rows) {
  return `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** "Trains with seats (classes)" → "trainswithseatsclasses": headers matched loosely. */
const headerKey = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");

module.exports = { parseCsv, toCsv, headerKey };
