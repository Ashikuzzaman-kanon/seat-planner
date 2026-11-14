const { parseCsv, headerKey } = require("./csv");

/**
 * Reading the three files the seat-allocation data comes from. Pure: each
 * takes the file's text and says what it found, and what it left out and why,
 * line by line. Nothing is stored here (services/allocationService does that).
 *
 *   census   BR Ticket Helper's census export: per station pair, the trains on
 *            the route and the ones with seats, with their classes.
 *   stops    train-stoppages.json: each train's stations in order.
 *   counts   the counts sheet: train, from, to, class, seats.
 */

const CLASS_CODE = /^[A-Z][A-Z0-9_]{0,19}$/;
const MAX_SEATS = 10000;

/** "TURNA (742)" or "TURNA (742): S_CHAIR, AC_B" → { number, name, classes } */
function readTrain(text) {
  const m = /^\s*(.*?)\s*\((\d{1,5})\)\s*(?::(.*))?$/.exec(String(text || ""));
  if (!m) return null;
  const classes = (m[3] || "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  return { number: Number(m[2]), name: m[1].trim() || `Train ${m[2]}`, classes };
}

const list = (text) =>
  String(text || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

const station = (text) => String(text || "").trim().replace(/\s+/g, " ");

/** "—", "-", "" all mean nothing was given. */
const blank = (text) => /^[\s—–-]*$/.test(String(text || ""));

function columns(header, required) {
  const keys = header.map(headerKey);
  const at = Object.fromEntries(Object.entries(required).map(([name, key]) => [name, keys.indexOf(key)]));
  const missing = Object.entries(at)
    .filter(([, i]) => i === -1)
    .map(([name]) => name);
  return { at, missing };
}

/**
 * The census file. Each row is one from → to pair; it becomes one entry per
 * train on the route: allocated, with the classes listed, for the trains with
 * seats; not allocated for the rest. Rows that cannot say that are left out:
 * a failed scan ("Error"), and "Allocated" with no trains named.
 */
function readCensus(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { error: "The file is empty" };
  const { at, missing } = columns(rows[0], {
    From: "from",
    To: "to",
    Result: "result",
    "Trains with seats (classes)": "trainswithseatsclasses",
    "Trains on the route": "trainsontheroute",
  });
  if (missing.length) return { error: `This is not a census file: no ${missing.join(", ")} column` };
  const scannedAt = rows[0].map(headerKey).indexOf("scannedat");

  const entries = [];
  const skipped = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    const from = station(r[at.From]);
    const to = station(r[at.To]);
    const result = String(r[at.Result] || "").trim().toLowerCase();
    const skip = (reason) => skipped.push({ line, from, to, reason });

    if (!from || !to) {
      skip("No from or to station");
      continue;
    }
    if (from === to) {
      skip("From and to are the same station");
      continue;
    }
    if (result === "error") {
      skip("The scan failed for this pair");
      continue;
    }
    if (result !== "allocated" && result !== "not allocated") {
      skip(`Result "${r[at.Result]}" is not Allocated or Not allocated`);
      continue;
    }

    const route = list(r[at["Trains on the route"]]).map(readTrain);
    if (!route.length || route.some((t) => !t)) {
      skip("Could not read the trains on the route");
      continue;
    }

    let withSeats = [];
    if (result === "allocated") {
      const given = r[at["Trains with seats (classes)"]];
      if (blank(given)) {
        skip("Allocated, but which trains have seats is not given");
        continue;
      }
      withSeats = list(given).map(readTrain);
      if (!withSeats.length || withSeats.some((t) => !t)) {
        skip("Could not read the trains with seats");
        continue;
      }
      const odd = withSeats.flatMap((t) => t.classes).filter((c) => !CLASS_CODE.test(c));
      if (odd.length) {
        skip(`Not a class code: ${odd.join(", ")}`);
        continue;
      }
    }

    let checkedAt = null;
    if (scannedAt !== -1 && String(r[scannedAt] || "").trim()) {
      const d = new Date(String(r[scannedAt]).trim());
      if (!Number.isNaN(d.getTime())) checkedAt = d;
    }

    const seats = new Map(withSeats.map((t) => [t.number, t]));
    const trains = new Map(route.map((t) => [t.number, t]));
    for (const t of withSeats) if (!trains.has(t.number)) trains.set(t.number, t);
    for (const t of trains.values()) {
      const s = seats.get(t.number);
      entries.push({
        line,
        train: { number: t.number, name: t.name },
        from,
        to,
        status: s ? "allocated" : "not_allocated",
        classes: s ? [...new Set(s.classes)] : [],
        checkedAt,
      });
    }
  }
  return { rows: rows.length - 1, entries, skipped };
}

/**
 * The route file, train-stoppages.json: `{ trains: [{ number, name, stops }] }`
 * with each stop `{ station }` (in order, or with an `order`) or a plain name.
 */
function readStops(text) {
  let doc;
  try {
    doc = JSON.parse(String(text || "").replace(/^﻿/, ""));
  } catch {
    return { error: "This is not a JSON file" };
  }
  const trains = Array.isArray(doc) ? doc : doc?.trains;
  if (!Array.isArray(trains)) return { error: "No list of trains in this file" };

  const out = [];
  const skipped = [];
  trains.forEach((t, i) => {
    const number = Number(t?.number);
    const label = t?.number ?? `#${i + 1}`;
    if (!Number.isInteger(number) || number < 1 || number > 99999) {
      skipped.push({ train: label, reason: "No train number" });
      return;
    }
    const raw = Array.isArray(t.stops) ? [...t.stops] : [];
    if (raw.every((s) => s && typeof s === "object" && Number.isFinite(s.order))) raw.sort((a, b) => a.order - b.order);
    const stops = raw.map((s) => station(typeof s === "string" ? s : s?.station)).filter(Boolean);
    if (stops.length < 2) {
      skipped.push({ train: label, reason: "Fewer than two stops" });
      return;
    }
    const name = String(t.name || "").trim() || `Train ${number}`;
    out.push({ number, name: name.replace(/\s*\(\d+\)\s*$/, ""), stops });
  });
  return { trains: out, skipped };
}

/**
 * The counts sheet: train, from, to, class, seats. The train may be a number or
 * "NAME (742)"; other columns (train_name) are ignored. A blank seats cell means
 * the count is not known; 0 means none.
 */
function readCounts(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { error: "The file is empty" };
  const { at, missing } = columns(rows[0], { train: "train", from: "from", to: "to", class: "class", seats: "seats" });
  if (missing.length) return { error: `This is not a counts sheet: no ${missing.join(", ")} column` };

  const entries = [];
  const skipped = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    const from = station(r[at.from]);
    const to = station(r[at.to]);
    const code = String(r[at.class] || "").trim().toUpperCase();
    const skip = (reason) => skipped.push({ line, from, to, reason });
    const trainText = String(r[at.train] || "").trim();
    const number = /^\d{1,5}$/.test(trainText) ? Number(trainText) : readTrain(trainText)?.number;
    if (!number) {
      skip("No train number");
      continue;
    }
    if (!from || !to) {
      skip("No from or to station");
      continue;
    }
    if (!CLASS_CODE.test(code)) {
      skip(code ? `Not a class code: ${code}` : "No class");
      continue;
    }
    const seatsText = String(r[at.seats] ?? "").trim();
    let seats = null;
    if (seatsText !== "") {
      if (!/^\d+$/.test(seatsText) || Number(seatsText) > MAX_SEATS) {
        skip(`Seats must be a whole number from 0 to ${MAX_SEATS}, or blank: "${seatsText}"`);
        continue;
      }
      seats = Number(seatsText);
    }
    entries.push({ line, train: number, from, to, code, seats });
  }
  return { rows: rows.length - 1, entries, skipped };
}

module.exports = { readCensus, readStops, readCounts, readTrain, CLASS_CODE, MAX_SEATS };
