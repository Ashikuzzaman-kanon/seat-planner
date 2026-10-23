// Seat allocation: the railway's own data on which station pairs have seats,
// per train and class. Uploaded from three files — routes, census, counts —
// each read and shown before it is applied; searched by any of from, to, train
// and class; corrected by hand. Kept apart from everything the site books on.
const path = require("path");
const BACKEND = path.resolve(__dirname, "../../..");
const { TrainName, Station, CoachClass, TrainQuotaRule, SeatPlan, AllocationUpload, sequelize } = require(`${BACKEND}/src/models`);

const BASE = process.env.API_BASE;
const PASSWORD = "UnitTest123!";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

async function call(method, url, { token, body, text } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": text !== undefined ? "text/plain" : "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(text !== undefined ? { body: text } : body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text();
  let json = null;
  try { json = JSON.parse(raw); } catch {}
  return { status: res.status, body: json, text: raw };
}
const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: PASSWORD } })).body;
const say = (r) => `${r.status} ${(r.text || "").slice(0, 240)}`;
/** Classes as code and seats, leaving out when each count was set. */
const cs = (classes) => JSON.stringify((classes || []).map(({ code, seats }) => ({ code, seats })));

const STOPS = {
  trains: [
    { number: 9101, name: "ALPHA EXPRESS", stops: ["Aport", "Bvale", "Ccross", "Dtown"] },
    { number: 9102, name: "BETA EXPRESS (9102)", stops: ["Aport", "Ccross", "Dtown", "Eend"].map((station, i) => ({ order: i + 1, station })) },
    { number: 9103, name: "GAMMA MAIL", stops: ["Dtown", "Ccross", "Bvale", "Aport"] },
  ],
};
const HEAD = "From,To,Result,Trains with seats (classes),Trains on the route,Scanned at,Window,Attempts";
const AT = "2026-10-20T17:20:39.444Z";
const CENSUS = [
  HEAD,
  `"Aport","Ccross","Allocated","ALPHA EXPRESS (9101): S_CHAIR, SNIGDHA; BETA EXPRESS (9102): S_CHAIR","ALPHA EXPRESS (9101); BETA EXPRESS (9102)","${AT}","Count 2","1"`,
  `"Aport","Dtown","Not allocated","—","ALPHA EXPRESS (9101); BETA EXPRESS (9102)","${AT}","",""`,
  `"Bvale","Dtown","Allocated","ALPHA EXPRESS (9101): AC_B","ALPHA EXPRESS (9101)","${AT}","",""`,
  `"Ccross","Aport","Allocated","GAMMA MAIL (9103): SHOVAN","GAMMA MAIL (9103)","${AT}","",""`,
  `"Ccross","Eend","Error","","BETA EXPRESS (9102)","","",""`,
  `"Ccross","Dtown","Allocated","—","ALPHA EXPRESS (9101); BETA EXPRESS (9102)","","",""`,
].join("\r\n");

(async () => {
  const su = await login("unittest-super1@example.com");
  const user = await login("unittest-user@example.com");
  const S = su.accessToken;
  const site = async () =>
    Promise.all([TrainName.count(), Station.count(), CoachClass.count(), TrainQuotaRule.count(), SeatPlan.count()]);
  const siteBefore = await site();

  console.log("\n== who may look ==");
  check("a passenger may not", (await call("GET", "/allocation/meta", { token: user.accessToken })).status === 403);
  const empty = await call("GET", "/allocation/meta", { token: S });
  check("the super admin may, and there is nothing yet", empty.status === 200 && empty.body.totals.pairs === 0 &&
    empty.body.totals.trains === 0, say(empty));
  check("nor may a passenger upload", (await call("POST", "/allocation/import/census", { token: user.accessToken, text: CENSUS })).status === 403);
  check("a pair cannot be set on a train nobody uploaded",
    (await call("PUT", "/allocation/pairs", { token: S, body: { train: 9101, from: "Aport", to: "Bvale", status: "allocated" } })).status === 404);

  console.log("\n== the train routes ==");
  const stopsText = JSON.stringify(STOPS);
  const sp = await call("POST", "/allocation/import/stops", { token: S, text: stopsText });
  check("read first: three new trains", sp.status === 200 && sp.body.applied === false && sp.body.preview.added === 3, say(sp));
  check("and nothing changed yet", (await call("GET", "/allocation/meta", { token: S })).body.totals.trains === 0);
  const sa = await call("POST", "/allocation/import/stops?apply=1&name=routes.json", { token: S, text: stopsText });
  check("applied", sa.status === 200 && sa.body.applied === true);
  const m1 = (await call("GET", "/allocation/meta", { token: S })).body;
  check("three trains with routes, names without their number", m1.totals.trainsWithStops === 3 &&
    m1.trains.find((t) => t.number === 9102)?.name === "BETA EXPRESS", JSON.stringify(m1.trains));
  check("uploading the same routes again changes nothing",
    (await call("POST", "/allocation/import/stops", { token: S, text: stopsText })).body.preview.unchanged === 3);

  console.log("\n== the census ==");
  const cp = await call("POST", "/allocation/import/census", { token: S, text: CENSUS });
  const p = cp.body?.preview || {};
  check("read: 6 lines give 6 train pairs, 4 allocated", cp.status === 200 && p.rows === 6 && p.pairs === 6 && p.added === 6 &&
    p.allocated === 4 && p.notAllocated === 2 && p.trains === 3, say(cp));
  check("the failed scan and the allocation without trains named are left out, saying why",
    p.skippedCount === 2 && p.skipped[0].reason === "The scan failed for this pair" &&
    p.skipped[1].reason === "Allocated, but which trains have seats is not given" && p.skipped[1].line === 7, JSON.stringify(p.skipped));
  check("and nothing changed yet", (await call("GET", "/allocation/meta", { token: S })).body.totals.pairs === 0);
  check("applied", (await call("POST", "/allocation/import/census?apply=1&name=census-1.csv", { token: S, text: CENSUS })).body.applied === true);
  const m2 = (await call("GET", "/allocation/meta", { token: S })).body;
  check("6 pairs stored, 4 allocated, 5 classes, no counts known", m2.totals.pairs === 6 && m2.totals.allocated === 4 &&
    m2.totals.classes === 5 && m2.totals.counted === 0, JSON.stringify(m2.totals));
  check("its classes are offered as filters", m2.classes.join() === "AC_B,S_CHAIR,SHOVAN,SNIGDHA", m2.classes.join());

  console.log("\n== searching ==");
  const get = async (q) => (await call("GET", `/allocation?${q}`, { token: S })).body;
  const brief = (r) => r.items.map((i) => `${i.train.number}:${i.from}>${i.to}`).join(" ");
  const all = await get("");
  check("no filter: every allocated pair", all.total === 4 && all.summary.trains === 3, brief(all));
  const pair = await get("from=Aport&to=Ccross");
  check("from and to: the trains with seats on that journey", brief(pair) === "9101:Aport>Ccross 9102:Aport>Ccross", brief(pair));
  check("each with its classes, the count not known", cs(pair.items[0].classes) ===
    JSON.stringify([{ code: "S_CHAIR", seats: null }, { code: "SNIGDHA", seats: null }]), JSON.stringify(pair.items[0].classes));
  check("from alone: every train with seats from there", (await get("from=Aport")).total === 2);
  const to = await get("to=Aport");
  check("to alone: every train with seats to there", brief(to) === "9103:Ccross>Aport", brief(to));
  const one = await get("train=9101");
  check("a train alone: its pairs in route order, with its route",
    brief(one) === "9101:Aport>Ccross 9101:Bvale>Dtown" && one.route.join() === "Aport,Bvale,Ccross,Dtown", `${brief(one)} ${one.route}`);
  const every = await get("train=9101&show=all");
  check("and with everything shown, all 6 of its pairs: checked or not",
    every.items.map((i) => `${i.from}>${i.to}:${i.status}`).join(" ") ===
      "Aport>Bvale:not_checked Aport>Ccross:allocated Aport>Dtown:not_allocated Bvale>Ccross:not_checked Bvale>Dtown:allocated Ccross>Dtown:not_checked",
    every.items.map((i) => `${i.from}>${i.to}:${i.status}`).join(" "));
  check("counted in the summary", every.summary.allocated === 2 && every.summary.notAllocated === 1 && every.summary.notChecked === 3,
    JSON.stringify(every.summary));
  check("a class: only the pairs with seats in it", brief(await get("class=AC_B")) === "9101:Bvale>Dtown");
  check("even with everything shown", (await get("class=AC_B&show=all")).total === 1);
  const allShown = await get("show=all&pageSize=1000");
  check("everything shown, all trains: 6 + 6 + 6 route pairs", allShown.total === 18, `${allShown.total}`);
  const paged = await get("show=all&pageSize=5&page=4");
  check("paged, with the summary over every match", paged.items.length === 3 && paged.total === 18 && paged.summary.pairs === 18);
  check("a bad filter is refused", (await call("GET", "/allocation?train=abc", { token: S })).status === 400);

  console.log("\n== counts ==");
  const sheet = await call("GET", "/allocation/counts.csv", { token: S });
  const lines = sheet.text.replace(/^﻿/, "").trim().split("\r\n");
  check("the counts sheet: one line per allocated class, seats blank", sheet.status === 200 && lines.length === 6 &&
    lines[0] === "train,train_name,from,to,class,seats" && lines.slice(1).every((l) => l.endsWith(",")), lines.join(" | "));
  const filled = [
    "train,train_name,from,to,class,seats",
    "9101,ALPHA EXPRESS,Aport,Ccross,S_CHAIR,40",
    "9101,ALPHA EXPRESS,Aport,Ccross,SNIGDHA,0",
    "9102,BETA EXPRESS,Aport,Ccross,S_CHAIR,",
    "9101,ALPHA EXPRESS,Aport,Ccross,AC_B,abc",
    "9101,ALPHA EXPRESS,Aport,Dtown,S_CHAIR,5",
    "9102,BETA EXPRESS,Aport,Ccross,SNIGDHA,3",
  ].join("\n");
  const kp = (await call("POST", "/allocation/import/counts", { token: S, text: filled })).body.preview;
  check("read: 2 counts set, 1 still not known, 3 left out", kp.set === 2 && kp.cleared === 0 && kp.unchanged === 1 &&
    kp.skippedCount === 3, JSON.stringify(kp));
  check("saying why: not a number, not allocated, not in that class",
    /whole number/.test(kp.skipped[0].reason) && /no seats allocated/.test(kp.skipped[1].reason) && /no SNIGDHA seats/.test(kp.skipped[2].reason),
    JSON.stringify(kp.skipped));
  check("nothing changed yet", (await get("from=Aport&to=Ccross&train=9101")).items[0].classes.every((c) => c.seats === null));
  await call("POST", "/allocation/import/counts?apply=1&name=counts.csv", { token: S, text: filled });
  const counted = (await get("from=Aport&to=Ccross&train=9101")).items[0].classes;
  check("applied: 40, and 0 — a real zero, not 'not known'",
    cs(counted) === JSON.stringify([{ code: "S_CHAIR", seats: 40 }, { code: "SNIGDHA", seats: 0 }]), JSON.stringify(counted));
  const snigdhaAt = counted.find((c) => c.code === "SNIGDHA")?.seatsUpdatedAt;
  check("each count says when it was set", Boolean(snigdhaAt) && counted.every((c) => c.seatsUpdatedAt), JSON.stringify(counted));
  check("a class never counted says nothing of the kind",
    (await get("from=Aport&to=Ccross&train=9102")).items[0].classes[0].seatsUpdatedAt === null);
  const sum = (await get("")).summary.classes.find((c) => c.code === "S_CHAIR");
  check("the summary adds up only the counts known", sum.pairs === 2 && sum.counted === 1 && sum.seats === 40, JSON.stringify(sum));
  const countsSpan = (await get("")).summary;
  check("and says once when the counts shown were set", countsSpan.countsFrom === snigdhaAt && countsSpan.countsTo === snigdhaAt,
    `${countsSpan.countsFrom} – ${countsSpan.countsTo} vs ${snigdhaAt}`);
  check("nothing of the kind where no count is known",
    (await get("from=Aport&to=Ccross&train=9102")).summary.countsFrom === null);
  const blank = "train,from,to,class,seats\n9101,Aport,Ccross,S_CHAIR,\n";
  check("a blank count clears it back to not known",
    (await call("POST", "/allocation/import/counts", { token: S, text: blank })).body.preview.cleared === 1);

  console.log("\n== the census again, changed ==");
  const NEXT = [
    HEAD,
    `"Aport","Ccross","Allocated","ALPHA EXPRESS (9101): SNIGDHA; BETA EXPRESS (9102): S_CHAIR","ALPHA EXPRESS (9101); BETA EXPRESS (9102)","${AT}","",""`,
    `"Bvale","Dtown","Allocated","ALPHA EXPRESS (9101): AC_B","ALPHA EXPRESS (9101)","${AT}","",""`,
  ].join("\n");
  const np = (await call("POST", "/allocation/import/census", { token: S, text: NEXT })).body.preview;
  check("read: one pair changed, a class gone with its count, two as they were",
    np.changed === 1 && np.unchanged === 2 && np.classesRemoved === 1 && np.countsLost === 1, JSON.stringify(np));
  await call("POST", "/allocation/import/census?apply=1&name=census-2.csv", { token: S, text: NEXT });
  const after = (await get("from=Aport&to=Ccross&train=9101")).items[0].classes;
  check("applied: S_CHAIR goes, SNIGDHA keeps the 0 typed in for it",
    cs(after) === JSON.stringify([{ code: "SNIGDHA", seats: 0 }]), JSON.stringify(after));
  check("and the time it was typed in: keeping a class is not counting it again", after[0]?.seatsUpdatedAt === snigdhaAt,
    `${after[0]?.seatsUpdatedAt} vs ${snigdhaAt}`);
  check("pairs not in the file are left as they were", brief(await get("to=Aport")) === "9103:Ccross>Aport");

  console.log("\n== by hand ==");
  const countOnly = await call("PUT", "/allocation/pairs", { token: S, body: {
    train: 9101, from: "Bvale", to: "Dtown", status: "allocated", classes: [{ code: "AC_B", seats: 9 }],
  } });
  check("a count typed in keeps the pair the census's, with its scan time",
    countOnly.body.pair?.classes[0]?.seats === 9 && countOnly.body.pair.source === "census" &&
      new Date(countOnly.body.pair.checkedAt).toISOString() === "2026-10-20T17:20:39.000Z", say(countOnly));
  const same = await call("PUT", "/allocation/pairs", { token: S, body: {
    train: 9101, from: "Bvale", to: "Dtown", status: "allocated", classes: [{ code: "AC_B", seats: 9 }],
  } });
  check("and saving it again unchanged changes nothing", same.status === 200 && same.body.pair.source === "census");
  const set = await call("PUT", "/allocation/pairs", { token: S, body: {
    train: 9103, from: "Bvale", to: "Aport", status: "allocated", classes: [{ code: "f_seat", seats: 12 }, { code: "AC_S", seats: null }],
  } });
  check("a pair set by hand, with a count and one not known", set.status === 200 && set.body.pair.source === "manual" &&
    cs(set.body.pair.classes) === JSON.stringify([{ code: "AC_S", seats: null }, { code: "F_SEAT", seats: 12 }]), say(set));
  check("backwards on its route is refused", (await call("PUT", "/allocation/pairs", { token: S,
    body: { train: 9103, from: "Aport", to: "Dtown", status: "allocated", classes: [] } })).status === 400);
  check("a class twice is refused", (await call("PUT", "/allocation/pairs", { token: S,
    body: { train: 9103, from: "Bvale", to: "Aport", status: "allocated", classes: [{ code: "AC_S" }, { code: "ac_s" }] } })).status === 400);
  check("a count that is not one is refused", (await call("PUT", "/allocation/pairs", { token: S,
    body: { train: 9103, from: "Bvale", to: "Aport", status: "allocated", classes: [{ code: "AC_S", seats: -1 }] } })).status === 400);
  const notAl = await call("PUT", "/allocation/pairs", { token: S, body: { train: 9103, from: "Bvale", to: "Aport", status: "not_allocated", classes: [{ code: "AC_S" }] } });
  check("not allocated drops its classes", notAl.body.pair?.status === "not_allocated" && notAl.body.pair.classes.length === 0, say(notAl));
  const cleared = await call("DELETE", "/allocation/pairs?train=9103&from=Bvale&to=Aport", { token: S });
  const back = (await get("train=9103&show=all")).items.find((i) => i.from === "Bvale" && i.to === "Aport");
  check("forgotten, it is back to not checked", cleared.status === 200 && back?.status === "not_checked", say(cleared));
  check("forgetting it again finds nothing", (await call("DELETE", "/allocation/pairs?train=9103&from=Bvale&to=Aport", { token: S })).status === 404);

  console.log("\n== how current it is ==");
  const history = (await call("GET", "/allocation/uploads", { token: S })).body?.uploads || [];
  check("every file applied is in the history, newest first — not the ones only read",
    history.map((u) => `${u.kind}:${u.fileName}`).join() === "census:census-2.csv,counts:counts.csv,census:census-1.csv,stops:routes.json",
    history.map((u) => `${u.kind}:${u.fileName}`).join());
  check("each saying who uploaded it and when", history.every((u) => u.uploadedBy?.fullName === su.user.fullName && u.uploadedAt),
    JSON.stringify(history[0]));
  check("and what it did", history[3].summary.added === 3 && history[2].summary.pairs === 6 && history[1].summary.set === 2 &&
    history[0].summary.changed === 1, JSON.stringify(history.map((u) => u.summary)));
  check("a census, when the railway was scanned", history[0].scannedFrom === "2026-10-20T17:20:39.000Z" &&
    history[0].scannedTo === "2026-10-20T17:20:39.000Z", JSON.stringify(history[0]));
  check("a passenger may not read it", (await call("GET", "/allocation/uploads", { token: user.accessToken })).status === 403);
  const latest = (await call("GET", "/allocation/meta", { token: S })).body.latest;
  check("the page's top line: routes, census and counts, each when and by whom",
    latest.stops?.by?.fullName === su.user.fullName && latest.stops.fileName === "routes.json" &&
      latest.census?.fileName === "census-2.csv" && latest.census.scannedFrom === "2026-10-20T17:20:39.000Z" &&
      latest.counts?.at && latest.counts.by?.fullName === su.user.fullName, JSON.stringify(latest));
  const ranged = (await get("train=9101")).summary;
  check("the results say when the pairs shown were checked", ranged.checkedFrom === "2026-10-20T17:20:39.000Z" &&
    ranged.checkedTo === "2026-10-20T17:20:39.000Z", JSON.stringify(ranged));
  check("a count typed in by hand says when", (await get("from=Bvale&to=Dtown&train=9101")).items[0].classes[0].seatsUpdatedAt !== null);
  await AllocationUpload.destroy({ where: {} });
  const older = (await call("GET", "/allocation/meta", { token: S })).body.latest;
  check("data applied before there was a history still says when, from the data itself",
    older.stops?.at && older.stops.by === null && older.census?.at && older.census.by === null &&
      older.census.scannedFrom === "2026-10-20T17:20:39.000Z", JSON.stringify(older));

  console.log("\n== files sent wrong ==");
  const asJson = await call("POST", "/allocation/import/census", { token: S, body: { csv: CENSUS } });
  check("a file sent as JSON is refused, saying how to send it", asJson.status === 400 && /text\/plain/.test(asJson.text), say(asJson));
  check("a census that is not one is refused", (await call("POST", "/allocation/import/census", { token: S, text: "a,b\n1,2" })).status === 400);
  check("routes that are not JSON are refused", (await call("POST", "/allocation/import/stops", { token: S, text: "nope" })).status === 400);
  check("a kind of file there is not", (await call("POST", "/allocation/import/other", { token: S, text: "x" })).status === 404);

  console.log("\n== a full-size census ==");
  const big = { trains: [] };
  for (let n = 0; n < 40; n++) big.trains.push({ number: 9200 + n, name: `LOAD TEST ${n}`, stops: Array.from({ length: 15 }, (_, i) => `Load ${n} Stop ${i}`) });
  await call("POST", "/allocation/import/stops?apply=1", { token: S, text: JSON.stringify(big) });
  const bigRows = [HEAD];
  for (const t of big.trains) {
    for (let i = 0; i < 15; i++) for (let j = i + 1; j < 15; j++) {
      const name = `${t.name} (${t.number})`;
      const seats = (i + j) % 3 === 0 ? `${name}: S_CHAIR, SNIGDHA` : "";
      bigRows.push(`"${t.stops[i]}","${t.stops[j]}","${seats ? "Allocated" : "Not allocated"}","${seats || "—"}","${name}","${AT}","",""`);
    }
  }
  const t0 = Date.now();
  const bigApply = await call("POST", "/allocation/import/census?apply=1", { token: S, text: bigRows.join("\n") });
  const took = Date.now() - t0;
  check(`4,200 pairs applied in ${(took / 1000).toFixed(1)}s`, bigApply.status === 200 && bigApply.body.preview.pairs === 4200 && took < 30000, say(bigApply));
  const t1 = Date.now();
  const bigList = await get("show=all&pageSize=50");
  check(`and searched, everything shown, in ${Date.now() - t1}ms`, bigList.total > 4200 && Date.now() - t1 < 3000, `${bigList.total}`);

  console.log("\n== kept apart from the site ==");
  check("the site's trains, stations, classes, quota rules and seat plans are untouched",
    JSON.stringify(await site()) === JSON.stringify(siteBefore), `${await site()} vs ${siteBefore}`);
  check("no site train was made from the allocation data", (await TrainName.count({ where: { name: "ALPHA EXPRESS" } })) === 0);

  console.log("\n== the switch ==");
  await call("PUT", "/features/seat-allocation", { token: S, body: { state: "off_all" } });
  const off = await call("GET", "/allocation", { token: S });
  check("Seat Allocation switched off: refused as unavailable", off.status === 403 && off.body?.error?.code === "FEATURE_UNAVAILABLE", say(off));
  await call("PUT", "/features/seat-allocation", { token: S, body: { state: "on" } });
  check("and back on", (await call("GET", "/allocation", { token: S })).status === 200);

  console.log("\n== the audit log, when there is one ==");
  await new Promise((r) => setTimeout(r, 300));
  const logged = (await call("GET", "/audit?action=allocation.import&limit=20", { token: S })).body;
  if (logged?.available === false) {
    console.log("  (no document store here — skipped)");
  } else {
    check("every upload applied is recorded", (logged?.pagination?.total || 0) >= 6, JSON.stringify(logged?.pagination));
    const edits = (await call("GET", "/audit?action=allocation.edit&limit=5", { token: S })).body;
    check("and every pair set by hand, before and after", edits?.events?.[0]?.after?.status === "not_allocated" &&
      edits.events[0].before?.status === "allocated", JSON.stringify(edits?.events?.[0]));
  }

  await sequelize.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
