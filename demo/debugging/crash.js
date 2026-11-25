/**
 * Demo 6: what a crashed or dying Node process leaves behind, and how to read it.
 *
 *   report    an uncaught error deep in async code. Run with
 *             --report-uncaught-exception and Node writes a diagnostic report
 *             (JSON): the JavaScript and native stacks, heap sizes, open
 *             handles, versions and environment at the moment of the crash.
 *
 *   leak      a cache that only ever grows, the way an unbounded Map does in a
 *             long-running server. Run with a small heap and
 *             --heapsnapshot-near-heap-limit=1 and Node saves a heap snapshot
 *             just before it runs out of memory; --report-on-fatalerror adds a
 *             report of the fatal error itself.
 *
 *   snapshots no crash: two heap snapshots a few seconds apart, written with
 *             v8.writeHeapSnapshot(), to compare and see what grew.
 *
 *   abort     process.abort(): a native-style crash. On Linux with core dumps
 *             enabled this leaves a core file (see debugging-demo.md).
 *
 * The run configurations in .run/ pass the right flags and write everything to
 * demo/debugging/out/, which Git ignores.
 */
const fs = require("fs");
const v8 = require("v8");
const path = require("path");

const mode = process.argv[2] || "report";
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true }); // Git ignores out/ folders, so a fresh checkout has none

/* ---------- report: an uncaught error several awaits deep ---------- */

async function loadTimetable(trainId) {
  await new Promise((r) => setTimeout(r, 10));
  return trainId === 703 ? null : { trainId, stops: ["Dhaka", "Chattogram"] }; // 703: missing from the data
}

async function firstStopOf(trainId) {
  const timetable = await loadTimetable(trainId);
  return timetable.stops[0]; // TypeError when the timetable is missing
}

async function nightlyJob() {
  for (const trainId of [701, 702, 703]) {
    console.log(`train ${trainId} starts at ${await firstStopOf(trainId)}`);
  }
}

/* ---------- leak: a cache with no eviction ---------- */

const seenVisitors = new Map(); // never cleared: the leak

function recordVisit(i) {
  // Each "visitor" keeps a 1 kB description alive forever.
  seenVisitors.set(`visitor-${i}`, { at: Date.now(), userAgent: "Mozilla/5.0 ".repeat(85) + i });
}

function leakUntilDead() {
  let i = 0;
  const timer = setInterval(() => {
    for (let n = 0; n < 5000; n++) recordVisit(i++);
    if (i % 50000 === 0) console.log(`${i.toLocaleString("en-US")} visitors cached, heap used ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MB`);
  }, 5);
  timer.ref();
}

/* ---------- snapshots: two, a few seconds apart ---------- */

function twoSnapshots() {
  for (let i = 0; i < 20000; i++) recordVisit(i);
  const first = v8.writeHeapSnapshot(path.join(OUT, "1-before.heapsnapshot"));
  console.log(`wrote ${first}`);
  for (let i = 20000; i < 60000; i++) recordVisit(i);
  const second = v8.writeHeapSnapshot(path.join(OUT, "2-after.heapsnapshot"));
  console.log(`wrote ${second}`);
  console.log("Open both, then compare the second with the first: the Map entries and their strings are what grew.");
}

/* ---------- choose ---------- */

console.log(`crash.js ${mode}, pid ${process.pid}, Node ${process.version}`);
if (mode === "report") nightlyJob();
else if (mode === "leak") leakUntilDead();
else if (mode === "snapshots") twoSnapshots();
else if (mode === "abort") process.abort();
else console.log("modes: report | leak | snapshots | abort");
