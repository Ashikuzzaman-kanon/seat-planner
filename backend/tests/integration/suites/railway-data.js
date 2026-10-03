// The real railway: loading Bangladesh Railway's timetable and the transcribed
// seat plans, the trains that come out of it ready for departures, a ticket
// bought on one of them — and draft seat plans that need nothing filled in.
const BASE = process.env.API_BASE;

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

const login = async (email) =>
  (await call("POST", "/auth/login", { body: { email, password: "UnitTest123!" } })).body;

async function finished(jobId, token) {
  for (let i = 0; i < 240; i++) {
    const job = (await call("GET", `/jobs/${jobId}`, { token })).body?.job;
    if (job && ["succeeded", "failed"].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

const tomorrowInDhaka = () => new Date(Date.now() + 6 * 3600_000 + 86_400_000).toISOString().slice(0, 10);

(async () => {
  const su = await login("unittest-super1@example.com");
  const user = await login("unittest-user@example.com");
  const st = su.accessToken, ut = user.accessToken;

  console.log("== who may load it ==");
  check("the super admin holds railway:manage", su.permissions.includes("railway:manage"));
  check("a passenger is refused", (await call("GET", "/railway-data", { token: ut })).status === 403);

  const before = (await call("GET", "/railway-data", { token: st })).body;
  check("the snapshot carries 149 trains", before.snapshot.trains === 149, JSON.stringify(before.snapshot));
  check("and 50 trains with seat plans", before.snapshot.readyTrains === 50, `${before.snapshot.readyTrains}`);

  console.log("\n== draft seat plans need nothing filled in ==");
  const blank = await call("POST", "/plans", { token: st, body: {} });
  check("an empty draft saves", blank.status === 201, JSON.stringify(blank.body?.error));
  const draft = blank.body.plan;
  check("with no train, type, class or coach number",
    draft.trainNameId === null && draft.coachTypeId === null && draft.coachClassId === null && draft.coachNo === null,
    JSON.stringify(draft));
  const refused = await call("POST", `/plans/${draft.id}/submit`, { token: st });
  check("but submitting it is refused", refused.status === 400, `${refused.status}`);
  check("naming everything it lacks",
    /a train, a coach type, a coach class, a coach number and at least one numbered seat/.test(refused.body?.error?.message),
    refused.body?.error?.message);
  const cleared = await call("PUT", `/plans/${draft.id}`, { token: st, body: { coachNo: "  ", trainNameId: null } });
  check("a draft's fields can be cleared again", cleared.status === 200 && cleared.body.plan.coachNo === null,
    JSON.stringify(cleared.body?.error));
  const bogus = await call("PUT", `/plans/${draft.id}`, { token: st, body: { coachTypeId: 999999 } });
  check("but not pointed at a coach type that does not exist", bogus.status === 400, `${bogus.status}`);

  console.log("\n== loading ==");
  const started = await call("POST", "/railway-data/load", { token: st });
  check("queued as a background job", started.status === 202, JSON.stringify(started.body?.error));
  const job = await finished(started.body.job.id, st);
  check("which succeeds", job?.status === "succeeded", job?.lastError || "did not finish");
  const r = job?.result || {};
  check("every train has its route", r.routes?.replaced + r.routes?.unchanged === 149, JSON.stringify(r.routes));
  check("82 approved plans, one per train a source names", r.plans?.approved === 82, JSON.stringify(r.plans));
  check("8 drafts for sources that name no train", r.plans?.drafts === 8, JSON.stringify(r.plans));
  check("50 line-ups and running days", r.compositions?.set === 50 && r.schedules?.set === 50,
    JSON.stringify({ c: r.compositions, s: r.schedules }));
  check("timetable adjustments are reported", r.notes?.some((n) => /Chuadanga: the halt spans midnight/.test(n)));

  const after = (await call("GET", "/railway-data", { token: st })).body;
  check("all 149 trains are there with routes", after.loaded.trains === 149 && after.loaded.withRoutes === 149,
    JSON.stringify(after.loaded));
  const ready = new Map(after.ready.map((t) => [t.name, t]));
  const realReady = after.ready.filter((t) => /\(\d+\)$/.test(t.name));
  check("50 real trains are ready", realReady.length === 50, `${realReady.length}`);
  check("every one with at least 500 seats", realReady.every((t) => t.seats >= 500),
    realReady.filter((t) => t.seats < 500).map((t) => `${t.name} ${t.seats}`).join(", "));
  check("Silk City carries the station board's rake: 1,140 seats in 13 coaches",
    ready.get("SILKCITY EXPRESS (753)")?.seats === 1140 && ready.get("SILKCITY EXPRESS (753)")?.coaches.length === 13,
    JSON.stringify(ready.get("SILKCITY EXPRESS (753)")));
  check("in AC cabin, Snigdha and Shovon Chair",
    JSON.stringify(ready.get("SILKCITY EXPRESS (753)")?.seatsByClass) ===
      JSON.stringify({ "AC Cabin": 144, Snigdha: 156, "Shovon Chair": 840 }),
    JSON.stringify(ready.get("SILKCITY EXPRESS (753)")?.seatsByClass));
  check("Madhumati's cabin-fitted coach is two sections", ready.get("MADHUMATI EXPRESS (755)")?.coaches.includes("KA-CABIN"));
  check("running days come from the timetable (Madhumati rests on Saturday)",
    JSON.stringify(ready.get("MADHUMATI EXPRESS (755)")?.runsOn) === "[0,1,2,3,4,5]",
    JSON.stringify(ready.get("MADHUMATI EXPRESS (755)")?.runsOn));
  check("a train without a plan is not made ready", !ready.has("KURIGRAM EXPRESS (797)"));

  const drafts = (await call("GET", "/plans?status=draft", { token: st })).body.plans;
  const plates = drafts.find((p) => p.coachNo === "BERTH-PLATES-40");
  check("the berth-plate coach is a draft with nothing assumed",
    plates && !plates.trainName && !plates.coachType && !plates.coachClass, JSON.stringify(plates));
  check("route-only diagrams keep what they state",
    drafts.some((p) => p.coachNo === "PTINKA-MG-SNIGDHA-55" && p.coachType?.name === "Indonesian PT Inka MG" && !p.trainName));

  console.log("\n== loading again changes nothing ==");
  const again = await call("POST", "/railway-data/load", { token: st });
  const second = await finished(again.body.job.id, st);
  check("succeeds", second?.status === "succeeded", second?.lastError);
  check("every route unchanged", second?.result.routes.unchanged === 149, JSON.stringify(second?.result.routes));
  check("every plan kept", second?.result.plans.existing === 90 && second?.result.plans.approved === 0,
    JSON.stringify(second?.result.plans));

  console.log("\n== an overnight train ==");
  const simanta = (await call("GET", "/trains?search=SIMANTA EXPRESS (747)", { token: st })).body.trains?.[0];
  const route = (await call("GET", `/trains/${simanta?.id}`, { token: st })).body.train;
  const chuadanga = route?.stops.find((s) => s.station.name === "Chuadanga");
  check("Chuadanga is on the next day, departing 00:00",
    chuadanga?.dayOffset === 1 && chuadanga?.departureTime?.startsWith("00:00"), JSON.stringify(chuadanga));
  check("distances only grow along the route",
    route.stops.every((s, i, a) => i === 0 || s.distanceKm >= a[i - 1].distanceKm));

  console.log("\n== a ticket on a real train ==");
  const ekota = ready.get("EKOTA EXPRESS (705)");
  const gen = await call("POST", "/trips/generate", { token: st, body: { trainId: ekota.id, days: 3 } });
  check("departures generate", gen.status === 200 && gen.body.report.trains[0]?.seats > 0, JSON.stringify(gen.body));
  check("with no coach skipped", gen.body.report.trains[0]?.notes.length === 0, JSON.stringify(gen.body.report.trains[0]?.notes));

  const stations = (await call("GET", "/search/stations", { token: ut })).body.stations;
  const dhaka = stations.find((s) => s.name === "Dhaka");
  const dinajpur = stations.find((s) => s.name === "Dinajpur");
  const date = tomorrowInDhaka();
  const search = await call("GET",
    `/search/departures?fromStationId=${dhaka.id}&toStationId=${dinajpur.id}&date=${date}`, { token: ut });
  const card = search.body?.departures?.find((d) => d.train.name === "EKOTA EXPRESS (705)");
  check("Ekota is found Dhaka → Dinajpur", !!card, JSON.stringify(search.body?.error || search.body?.departures?.map((d) => d.train.name)));
  check("leaving at the published 10:15", card?.from.time?.startsWith("10:15"), JSON.stringify(card?.from));
  check("arriving at the published 19:00", card?.to.time?.startsWith("19:00"), JSON.stringify(card?.to));
  check("priced in all three classes",
    ["AC Chair", "Non-AC Cabin", "Shovon Chair"].every((c) => card?.fares.some((f) => f.coachClass === c && f.fareMinor > 0)),
    JSON.stringify(card?.fares));
  const chair = card?.fares.find((f) => f.coachClass === "Shovon Chair");
  check("Shovon Chair at the per-kilometre rate (405 km × 1.30)", chair?.fareMinor === 52650, `${chair?.fareMinor}`);

  const journey = { tripId: card.tripId, fromStationId: dhaka.id, toStationId: dinajpur.id, count: 1 };
  const held = await call("POST", "/holds/auto", { token: ut, body: { ...journey, together: true } });
  check("a seat is held", held.status === 201, JSON.stringify(held.body?.error));
  const quote = await call("POST", "/bookings/quote", { token: ut, body: { holdReference: held.body.hold.reference } });
  await call("POST", "/wallet/topup", { token: ut, body: { amount: Math.ceil(quote.body.totalMinor / 100) + 10 } });
  const booked = await call("POST", "/bookings", {
    token: ut,
    body: {
      holdReference: held.body.hold.reference,
      passengers: [{ name: "Railway Passenger", nid: "1990555566661", dob: "1990-01-01" }],
      method: "wallet",
    },
  });
  check("and bought", booked.status === 201, JSON.stringify(booked.body?.error || booked.body?.message));
  const ticket = booked.body?.booking?.tickets?.[0];
  check("in a real coach and seat", !!ticket?.coachCode && !!ticket?.seatNumber, JSON.stringify(ticket));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
