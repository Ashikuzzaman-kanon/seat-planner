// Checking the server against what the railway publishes now, and applying
// it — against a stand-in railway, so no test ever calls the real one.
//
// The stand-in serves the committed timetable with changes of every kind:
// times moved and a running day dropped on a train with departures (705), a
// station dropped from a train with departures still to run (753), a station
// added to a train with none (61), a train renamed (701), one no longer
// published (702), one that fails to answer (703), and one the server has
// lost (62).
const http = require("http");
const BACKEND = require("path").resolve(__dirname, "../../..");
const { sequelize, TrainName, RouteStop, TrainSchedule, Station } = require(`${BACKEND}/src/models`);
const COMMITTED = require(`${BACKEND}/src/data/railway/timetable.json`);

const BASE = process.env.API_BASE;
const PASSWORD = "UnitTest123!";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}
const say = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: PASSWORD } })).body.accessToken;

async function finished(jobId, token) {
  for (let i = 0; i < 400; i++) {
    const job = (await call("GET", `/jobs/${jobId}`, { token })).body?.job;
    if (job && ["succeeded", "failed"].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/* ---------------- The stand-in railway ---------------- */

const clock = (text) => {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(text || "");
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return h * 60 + Number(m[2]);
};
const text = (minutes) => {
  const h24 = Math.floor(minutes / 60) % 24;
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} ${h24 < 12 ? "am" : "pm"} BST`;
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const tomorrow = new Date(Date.now() + 6 * 3600_000 + 86_400_000).toISOString().slice(0, 10);
const tomorrowDay = DAYS[new Date(`${tomorrow}T00:00:00Z`).getUTCDay()];

const published = new Map(COMMITTED.trains.map((t) => [t.number, JSON.parse(JSON.stringify(t))]));
const original = (number) => COMMITTED.trains.find((t) => t.number === number);

// 705: Joydebpur five minutes later; no longer runs on tomorrow's weekday.
const a = published.get(705);
a.routes[2].arrival_time = text(clock(a.routes[2].arrival_time) + 5);
a.routes[2].departure_time = text(clock(a.routes[2].departure_time) + 5);
a.days = a.days.filter((d) => d !== tomorrowDay);
// 753: a middle stop dropped.
const b = published.get(753);
const droppedFromB = b.routes[2].city;
b.routes.splice(2, 1);
// 61: a new halt between its second and third stops.
const c = published.get(61);
const after = clock(c.routes[1].departure_time);
c.routes.splice(2, 0, { city: "Test_Halt", arrival_time: text(after + 1), departure_time: text(after + 2), halt: "01", duration: "00:01" });
// 701: renamed.
published.get(701).name = "SUBARNA EXPRESS (701)";

let mode = "changed"; // "changed" | "down"
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const number = Number(JSON.parse(body || "{}").model);
    const reply = (status, json) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    };
    if (mode === "down" || number === 703) return reply(500, { message: "Server error" });
    if (number === 702) return reply(404, { message: "Not found" });
    const t = published.get(number);
    if (!t) return reply(404, { message: "Not found" });
    reply(200, { data: { train_name: t.name, days: t.days, total_duration: t.totalDuration, routes: t.routes } });
  });
});

(async () => {
  const port = Number(new URL(process.env.RAILWAY_SOURCE_URL).port);
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  const st = await login("unittest-super1@example.com");
  const ut = await login("unittest-user@example.com");

  console.log("== the railway loaded, departures for two trains ==");
  const loaded = await finished((await call("POST", "/railway-data/load", { token: st })).body.job.id, st);
  check("the railway loads", loaded?.status === "succeeded", loaded?.lastError);
  const trainOf = (number) => TrainName.findOne({ where: { code: String(number) } });
  const [t705, t753, t61] = await Promise.all([trainOf(705), trainOf(753), trainOf(61)]);
  for (const train of [t705, t753]) await call("POST", "/trips/generate", { token: st, body: { days: 2, trainId: train.id } });
  const stopsOf = async (train) =>
    RouteStop.findAll({ where: { trainId: train.id }, include: [{ association: "station", attributes: ["name"] }], order: [["sequence", "ASC"]] });
  const before705 = await stopsOf(t705);
  const before753 = await stopsOf(t753);
  // The server loses 62.
  await TrainName.destroy({ where: { code: "62" } });

  console.log("\n== checking with the railway ==");
  check("an ordinary account cannot", (await call("POST", "/railway-data/check", { token: ut })).status === 403);
  const started = await call("POST", "/railway-data/check", { token: st });
  check("a check runs in the background", started.status === 202 && started.body.job?.id, say(started));
  const checked = await finished(started.body.job.id, st);
  check("and finishes", checked?.status === "succeeded", checked?.lastError);

  const pending = (await call("GET", "/railway-data", { token: st })).body.sync.pending;
  const d = pending?.diff || {};
  check("the result waits to be applied", pending?.status === "checked" && pending.requestedFor && !pending.appliedAt, JSON.stringify(pending).slice(0, 200));
  check("nothing has changed yet", JSON.stringify((await stopsOf(t705)).map((s) => s.arrivalTime)) === JSON.stringify(before705.map((s) => s.arrivalTime)));
  check("a moved time is found, stop by stop",
    d.times?.some((x) => x.number === 705 && x.stops.length === 1 && x.stops[0].station === a.routes[2].city), JSON.stringify(d.times));
  check("a dropped station on a train with departures to run, which will be skipped",
    d.stations?.some((x) => x.number === 753 && x.removed.includes(droppedFromB) && x.upcoming > 0 && x.willApply === false), JSON.stringify(d.stations));
  check("an added station on a train with none, which will apply",
    d.stations?.some((x) => x.number === 61 && x.added.includes("Test_Halt") && x.willApply === true));
  check("and the new station itself", d.newStations?.includes("Test_Halt"), JSON.stringify(d.newStations));
  check("changed running days, with the departure that falls on a day no longer run",
    d.days?.some((x) => x.number === 705 && x.from.length === 7 && x.to.length === 6 && x.stranded.includes(tomorrow) && x.willApply), JSON.stringify(d.days));
  check("a renamed train", d.renamed?.some((x) => x.number === 701 && x.to === "SUBARNA EXPRESS (701)"));
  check("a train the server does not have", d.newTrains?.some((x) => x.number === 62 && x.stops === original(62).routes.length), JSON.stringify(d.newTrains));
  check("one no longer published", d.unpublished?.some((x) => x.number === 702), JSON.stringify(d.unpublished));
  check("and one the railway did not answer for, which is not called unpublished", d.failed?.includes(703) && !d.unpublished.some((x) => x.number === 703));
  check("the rest match", d.counts?.unchanged > 100 && d.upToDate === false, JSON.stringify(d.counts));

  console.log("\n== applying it ==");
  const applying = await call("POST", `/railway-data/sync/${pending.id}/apply`, { token: st });
  check("applying runs in the background", applying.status === 202, say(applying));
  const applied = await finished(applying.body.job.id, st);
  check("and finishes", applied?.status === "succeeded", applied?.lastError);
  const report = applied?.result || {};

  const after705 = await stopsOf(t705);
  const moved = after705[2];
  check("the moved time is taken, though the train has departures",
    moved.arrivalTime.slice(0, 5) !== before705[2].arrivalTime.slice(0, 5) && report.routes?.times >= 1, `${before705[2].arrivalTime} -> ${moved.arrivalTime}`);
  check("keeping the distances saved", JSON.stringify(after705.map((s) => String(s.distanceKm))) === JSON.stringify(before705.map((s) => String(s.distanceKm))));
  const schedule = await TrainSchedule.findAll({ where: { trainId: t705.id } });
  check("its running days follow the railway", schedule.length === 1 && schedule[0].runsOn.length === 6, JSON.stringify(schedule.map((s) => s.runsOn)));
  check("and the departure on the day it no longer runs is listed, not cancelled",
    report.stranded?.some((x) => x.trainId === t705.id && x.dates.includes(tomorrow)), JSON.stringify(report.stranded));
  check("the train with departures to run keeps its route",
    (await stopsOf(t753)).length === before753.length && report.routes?.skipped >= 1, `${(await stopsOf(t753)).length}`);
  check("and is named in the report", report.warnings?.some((w) => w.includes("SILKCITY") && w.includes(droppedFromB)), JSON.stringify(report.warnings));
  const route61 = await stopsOf(t61);
  check("the train with none takes its new station", route61.some((s) => s.station?.name === "Test_Halt") && Boolean(await Station.findOne({ where: { name: "Test_Halt" } })));
  check("the renamed train is renamed", (await TrainName.findOne({ where: { code: "701" } })).name === "SUBARNA EXPRESS (701)");
  const t62 = await trainOf(62);
  check("the lost train is back, with its route", t62 && (await RouteStop.count({ where: { trainId: t62.id } })) > 1);
  check("the unpublished one is still here", Boolean(await trainOf(702)));

  const status = (await call("GET", "/railway-data", { token: st })).body;
  check("nothing waits any more, and the applied timetable is the current one",
    status.sync.pending === null && status.sync.lastApplied?.id === pending.id && status.snapshot.fetchedAt === status.sync.lastApplied.fetchedAt,
    JSON.stringify({ pending: status.sync.pending, last: status.sync.lastApplied?.id, snap: status.snapshot.fetchedAt }));
  check("a train the railway did not answer for, or no longer publishes, keeps its timetable",
    status.snapshot.trains === COMMITTED.trains.length, `${status.snapshot.trains}`);
  check("an applied check cannot be applied again", (await call("POST", `/railway-data/sync/${pending.id}/apply`, { token: st })).status === 409);

  console.log("\n== loading again keeps it ==");
  const reloaded = await finished((await call("POST", "/railway-data/load", { token: st })).body.job.id, st);
  check("load works from the applied timetable", reloaded?.status === "succeeded" && reloaded.result.snapshot.fetchedAt === status.sync.lastApplied.fetchedAt, reloaded?.lastError);
  check("so the new times stay", (await stopsOf(t705))[2].arrivalTime === moved.arrivalTime);

  console.log("\n== checking again ==");
  const again = await finished((await call("POST", "/railway-data/check", { token: st })).body.job.id, st);
  const d2 = (await call("GET", "/railway-data", { token: st })).body.sync.pending?.diff || {};
  check("only what was skipped still differs",
    again?.status === "succeeded" && d2.counts.stations === 1 && d2.stations[0].number === 753 &&
      d2.counts.times === 0 && d2.counts.days === 0 && d2.counts.newTrains === 0 && d2.counts.renamed === 0 && d2.counts.newStations === 0,
    JSON.stringify(d2.counts));

  console.log("\n== when the railway does not answer ==");
  mode = "down";
  const down = await finished((await call("POST", "/railway-data/check", { token: st })).body.job.id, st);
  check("the check stops, saying so", down?.status === "failed" && /did not answer/.test(down.lastError || ""), down?.lastError);
  const still = (await call("GET", "/railway-data", { token: st })).body.sync;
  check("and the check before it still waits", still.pending?.diff?.counts?.stations === 1 && still.lastJob?.status === "failed");

  console.log("\n== the audit log, when there is one ==");
  const logged = async (action) => (await call("GET", `/audit?action=${action}&limit=20`, { token: st })).body;
  if ((await logged("railway.sync_check")).available === false) {
    console.log("  (no document store here — skipped)");
  } else {
    await new Promise((r) => setTimeout(r, 300));
    check("checks are recorded", (await logged("railway.sync_check")).events.length >= 2);
    check("and the apply, with what it did", (await logged("railway.sync_apply")).events.some((e) => e.after?.routes?.times >= 1));
  }

  server.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await sequelize.close();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error(err);
  server.close();
  await sequelize.close().catch(() => {});
  process.exit(1);
});
