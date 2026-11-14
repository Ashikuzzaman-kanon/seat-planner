const test = require("node:test");
const assert = require("node:assert/strict");

const { parseCsv, toCsv } = require("../../src/utils/csv");
const { readCensus, readStops, readCounts, readTrain } = require("../../src/utils/allocationFiles");

const HEAD = "From,To,Result,Trains with seats (classes),Trains on the route,Scanned at,Window,Attempts";
const census = (...rows) => `﻿${[HEAD, ...rows].join("\r\n")}\r\n`;

test("CSV: quotes, commas and line breaks inside them, doubled quotes, CRLF and a byte-order mark", () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\nlast,,\n');
  assert.deepEqual(rows, [["a", "b", "c"], ["x, y", 'say "hi"', "two\nlines"], ["last", "", ""]]);
});

test("CSV written back reads the same, and Excel gets its byte-order mark", () => {
  const rows = [["train", "from"], ["742", "Cox's Bazar"], ["1", 'a "b", c']];
  const text = toCsv(rows);
  assert.ok(text.startsWith("﻿"));
  assert.deepEqual(parseCsv(text), rows);
});

test("a train is read with its number, name and classes", () => {
  assert.deepEqual(readTrain("TURNA (742): S_CHAIR, f_berth"), { number: 742, name: "TURNA", classes: ["S_CHAIR", "F_BERTH"] });
  assert.deepEqual(readTrain(" PARABAT EXPRESS (710) "), { number: 710, name: "PARABAT EXPRESS", classes: [] });
  assert.equal(readTrain("no number here"), null);
});

test("census: the trains with seats are allocated in their classes, the rest of the route is not", () => {
  const r = readCensus(
    census(
      '"Brahmanbaria","Laksam","Allocated","MAHANAGAR PROVATI (704): AC_S; CHATTALA EXPRESS (802): S_CHAIR, SNIGDHA","MAHANAGAR PROVATI (704); UPAKUL EXPRESS (712); CHATTALA EXPRESS (802)","2026-10-20T17:20:39.444Z","Count 2","1"'
    )
  );
  assert.equal(r.rows, 1);
  assert.deepEqual(r.skipped, []);
  const by = Object.fromEntries(r.entries.map((e) => [e.train.number, e]));
  assert.deepEqual(Object.keys(by).map(Number).sort(), [704, 712, 802]);
  assert.equal(by[704].status, "allocated");
  assert.deepEqual(by[704].classes, ["AC_S"]);
  assert.deepEqual(by[802].classes, ["S_CHAIR", "SNIGDHA"]);
  assert.equal(by[712].status, "not_allocated");
  assert.deepEqual(by[712].classes, []);
  assert.equal(by[704].checkedAt.toISOString(), "2026-10-20T17:20:39.444Z");
  assert.equal(by[704].from, "Brahmanbaria");
});

test("census: not allocated means not allocated on every train of the route, with or without a dash", () => {
  const r = readCensus(census('"A","B","Not allocated","—","T1 (1); T2 (2)","",""'));
  assert.equal(r.entries.length, 2);
  assert.ok(r.entries.every((e) => e.status === "not_allocated" && e.checkedAt === null));
});

test("census: what is left out, and why", () => {
  const r = readCensus(
    census(
      '"A","B","Error","","T1 (1)","",""',
      '"A","C","Allocated","—","T1 (1)","",""',
      '"A","D","Allocated","T1 (1): S-CHAIR","T1 (1)","",""',
      '"A","E","Maybe","","T1 (1)","",""',
      '"A","A","Not allocated","","T1 (1)","",""',
      '"A","F","Not allocated","","nobody","",""'
    )
  );
  assert.equal(r.entries.length, 0);
  assert.deepEqual(
    r.skipped.map((s) => [s.line, s.reason]),
    [
      [2, "The scan failed for this pair"],
      [3, "Allocated, but which trains have seats is not given"],
      [4, "Not a class code: S-CHAIR"],
      [5, 'Result "Maybe" is not Allocated or Not allocated'],
      [6, "From and to are the same station"],
      [7, "Could not read the trains on the route"],
    ]
  );
});

test("census: a train with seats missing from the route list still counts", () => {
  const r = readCensus(census('"A","B","Allocated","T9 (9): AC_B","T1 (1)","",""'));
  assert.deepEqual(r.entries.map((e) => [e.train.number, e.status]).sort(), [[1, "not_allocated"], [9, "allocated"]]);
});

test("census: a file without its columns is refused, saying which", () => {
  assert.match(readCensus("From,To\nA,B\n").error, /no Result, Trains with seats \(classes\), Trains on the route/);
  assert.equal(readCensus("").error, "The file is empty");
});

test("routes: train-stoppages.json, in order, by their order field when every stop has one", () => {
  const r = readStops(
    JSON.stringify({
      trains: [
        { number: 753, name: "SILKCITY EXPRESS (753)", stops: [{ order: 2, station: "Biman_Bandar" }, { order: 1, station: "Dhaka" }, { order: 3, station: "Rajshahi" }] },
        { number: 9, name: "Plain", stops: ["A", " B "] },
        { number: 10, name: "Short", stops: ["A"] },
        { name: "No number", stops: ["A", "B"] },
      ],
    })
  );
  assert.deepEqual(r.trains, [
    { number: 753, name: "SILKCITY EXPRESS", stops: ["Dhaka", "Biman_Bandar", "Rajshahi"] },
    { number: 9, name: "Plain", stops: ["A", "B"] },
  ]);
  assert.deepEqual(r.skipped.map((s) => s.reason), ["Fewer than two stops", "No train number"]);
  assert.equal(readStops("not json").error, "This is not a JSON file");
  assert.equal(readStops("{}").error, "No list of trains in this file");
});

test("counts: blank is not known, 0 is none, and the train may be written either way", () => {
  const r = readCounts(
    [
      "train,train_name,from,to,class,seats",
      "742,TURNA,Dhaka,Chattogram,S_CHAIR,40",
      '"TURNA (742)",,Dhaka,Chattogram,snigdha,',
      "742,,Dhaka,Chattogram,AC_B,0",
      "742,,Dhaka,Chattogram,AC_S,-3",
      "742,,Dhaka,Chattogram,AC_S,12.5",
      "x,,Dhaka,Chattogram,AC_S,1",
      "742,,Dhaka,Chattogram,,1",
    ].join("\n")
  );
  assert.deepEqual(
    r.entries.map((e) => [e.train, e.code, e.seats]),
    [
      [742, "S_CHAIR", 40],
      [742, "SNIGDHA", null],
      [742, "AC_B", 0],
    ]
  );
  assert.deepEqual(
    r.skipped.map((s) => s.line),
    [5, 6, 7, 8]
  );
  assert.match(r.skipped[0].reason, /whole number/);
  assert.equal(readCounts("a,b\n1,2").error, "This is not a counts sheet: no train, from, to, class, seats column");
});
