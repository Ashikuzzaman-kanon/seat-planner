// Phase 2 — network, routes, fare rule chain, seat attribute catalogue.
const BASE = process.env.API_BASE;

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} ${ok ? "" : detail}`);
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

const login = async (email, password) =>
  (await call("POST", "/auth/login", { body: { email, password } })).body;

(async () => {
  for (let i = 0; i < 25; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }

  const su = await login("superadmin1@example.com", "SuperAdmin123!");
  const planner = await login("planner1@example.com", "Planner123!");
  const suToken = su.accessToken;
  const plannerToken = planner.accessToken;

  console.log("\n== permission gating ==");
  const blocked = await call("GET", "/stations", { token: plannerToken });
  check("planner blocked from network (no network:view)", blocked.status === 403, `got ${blocked.status}`);
  const allowed = await call("GET", "/stations", { token: suToken });
  check("super admin can read stations", allowed.status === 200);
  check("36 stations seeded", allowed.body?.stations?.length === 36, `got ${allowed.body?.stations?.length}`);

  const stations = allowed.body.stations;
  const byCode = Object.fromEntries(stations.map((s) => [s.code, s]));

  console.log("\n== stations ==");
  const created = await call("POST", "/stations", {
    token: suToken, body: { code: "tst", name: "Test Halt", district: "Nowhere" },
  });
  check("station created", created.status === 201, JSON.stringify(created.body));
  check("code is uppercased", created.body?.station?.code === "TST", created.body?.station?.code);

  const dupe = await call("POST", "/stations", {
    token: suToken, body: { code: "TST", name: "Another", district: "X" },
  });
  check("duplicate code rejected", dupe.status === 409, `got ${dupe.status}`);

  const inUse = await call("DELETE", `/stations/${byCode.DHK.id}`, { token: suToken });
  check("station on a route cannot be deleted", inUse.status === 409, `got ${inUse.status}`);

  const removed = await call("DELETE", `/stations/${created.body.station.id}`, { token: suToken });
  check("unused station can be deleted", removed.status === 200, `got ${removed.status}`);

  console.log("\n== trains & routes ==");
  const trains = await call("GET", "/trains", { token: suToken });
  check("trains listed", trains.status === 200 && trains.body.trains.length >= 10);

  const ekota = trains.body.trains.find((t) => t.name === "Ekota Express");
  check("Ekota has 11 stops / 10 segments",
    ekota?.stopCount === 11 && ekota?.segmentCount === 10,
    `${ekota?.stopCount}/${ekota?.segmentCount}`);
  check("overnight journey time computed across midnight",
    ekota?.journeyMinutes === 495, `got ${ekota?.journeyMinutes}`);

  const madhumati = trains.body.trains.find((t) => t.name === "Madhumati Express");
  check("Madhumati origin/terminus resolved",
    madhumati?.originStation === "Rajshahi" && madhumati?.terminusStation === "Bhanga",
    `${madhumati?.originStation} → ${madhumati?.terminusStation}`);

  // Route coherence — the checks that protect every trip built from a route.
  const badRoutes = [
    ["one stop", [{ stationId: byCode.DHK.id, departureTime: "10:00", dayOffset: 0, distanceKm: 0 }]],
    ["repeated station", [
      { stationId: byCode.DHK.id, departureTime: "10:00", dayOffset: 0, distanceKm: 0 },
      { stationId: byCode.DHK.id, arrivalTime: "11:00", dayOffset: 0, distanceKm: 50 },
    ]],
    ["time going backwards", [
      { stationId: byCode.DHK.id, departureTime: "10:00", dayOffset: 0, distanceKm: 0 },
      { stationId: byCode.JYD.id, arrivalTime: "09:00", dayOffset: 0, distanceKm: 33 },
    ]],
    ["distance going backwards", [
      { stationId: byCode.DHK.id, departureTime: "10:00", dayOffset: 0, distanceKm: 0 },
      { stationId: byCode.JYD.id, arrivalTime: "11:00", dayOffset: 0, distanceKm: 33 },
      { stationId: byCode.TAN.id, arrivalTime: "12:00", dayOffset: 0, distanceKm: 20 },
    ]],
    ["origin not at distance 0", [
      { stationId: byCode.DHK.id, departureTime: "10:00", dayOffset: 0, distanceKm: 15 },
      { stationId: byCode.JYD.id, arrivalTime: "11:00", dayOffset: 0, distanceKm: 33 },
    ]],
  ];

  // Reuse the scratch train if a previous run left one. Deleting it is
  // (correctly) refused once it has a route, so reuse rather than recreate.
  const leftover = trains.body.trains.find((x) => x.name === "Route Test Express");
  let testTrainId;
  if (leftover) {
    testTrainId = leftover.id;
    check("reusing the scratch train from an earlier run", true);
  } else {
    const testTrain = await call("POST", "/trains", {
      token: suToken, body: { name: "Route Test Express", code: "999" },
    });
    check("scratch train created", testTrain.status === 201,
      `got ${testTrain.status}: ${testTrain.body?.message}`);
    testTrainId = testTrain.body.train.id;
  }

  for (const [label, stops] of badRoutes) {
    const res = await call("PUT", `/trains/${testTrainId}/route`, { token: suToken, body: { stops } });
    check(`rejects ${label}`, res.status === 400, `got ${res.status}`);
  }

  // The same times that failed same-day succeed once the day offset is right.
  const overnight = await call("PUT", `/trains/${testTrainId}/route`, {
    token: suToken,
    body: { stops: [
      { stationId: byCode.DHK.id, departureTime: "23:30", dayOffset: 0, distanceKm: 0 },
      { stationId: byCode.JYD.id, arrivalTime: "06:00", dayOffset: 1, distanceKm: 33 },
    ] },
  });
  check("accepts 23:30 → 06:00 when marked as next day", overnight.status === 200,
    JSON.stringify(overnight.body?.message || overnight.body));

  const sameDay = await call("PUT", `/trains/${testTrainId}/route`, {
    token: suToken,
    body: { stops: [
      { stationId: byCode.DHK.id, departureTime: "23:30", dayOffset: 0, distanceKm: 0 },
      { stationId: byCode.JYD.id, arrivalTime: "06:00", dayOffset: 0, distanceKm: 33 },
    ] },
  });
  check("rejects the same times without the day offset", sameDay.status === 400, `got ${sameDay.status}`);

  console.log("\n== fare rule chain ==");
  const classes = (await call("GET", "/reference/coach-classes", { token: suToken })).body;
  const classList = classes?.items || classes?.coachClasses || classes?.data || [];
  const shovonChair = classList.find?.((c) => c.name === "Shovon Chair");

  const quote = async (from, to, coachClassId = shovonChair?.id) =>
    call("GET", `/fares/quote?trainId=${madhumati.id}&coachClassId=${coachClassId}&fromStationId=${byCode[from].id}&toStationId=${byCode[to].id}`,
      { token: suToken });

  if (shovonChair) {
    const listed = await quote("RJS", "BNG");
    check("listed pair uses the published table", listed.body?.fare?.basis === "table",
      JSON.stringify(listed.body?.fare));
    check("listed price is the table amount", listed.body?.fare?.amount === 380, `got ${listed.body?.fare?.amount}`);

    const unlisted = await quote("BRM", "RJB");
    check("unlisted pair falls back to per-kilometre", unlisted.body?.fare?.basis === "distance",
      JSON.stringify(unlisted.body?.fare));
    check("fallback prices by distance", unlisted.body?.fare?.amount === 133.9,
      `got ${unlisted.body?.fare?.amount} for ${unlisted.body?.fare?.distanceKm} km`);

    const short = await quote("PDH", "KTC");
    check("minimum fare floors a short hop", short.body?.fare?.amount === 45,
      `got ${short.body?.fare?.amount}`);
    check("fare explains itself", typeof short.body?.fare?.explanation === "string");

    const backwards = await quote("BNG", "RJS");
    check("reversed journey rejected", backwards.status === 400, `got ${backwards.status}`);

    const offRoute = await quote("RJS", "CTG");
    check("station off the route rejected", offRoute.status === 400, `got ${offRoute.status}`);

    const matrix = await call("GET", `/fares/matrix?trainId=${madhumati.id}&coachClassId=${shovonChair.id}`, { token: suToken });
    check("matrix covers every forward pair", matrix.body?.pairs?.length === 28,
      `got ${matrix.body?.pairs?.length}`);
    const priced = matrix.body.pairs.filter((p) => p.amount !== null).length;
    check("every pair is priced (table or fallback)", priced === 28, `got ${priced}`);
    const fromTable = matrix.body.pairs.filter((p) => p.basis === "table").length;
    check("exactly the 7 published pairs come from the table", fromTable === 7, `got ${fromTable}`);
  } else {
    check("coach classes readable", false, "could not resolve Shovon Chair");
  }

  console.log("\n== seat attribute catalogue ==");
  const attrs = await call("GET", "/seat-attributes", { token: suToken });
  check("catalogue readable", attrs.status === 200 && attrs.body.attributes.length === 5,
    `got ${attrs.body?.attributes?.length}`);
  const windowAttr = attrs.body.attributes.find((a) => a.key === "window");
  check("window is an enum with full/half", windowAttr?.valueType === "enum" && windowAttr?.options?.length === 2);

  const newAttr = await call("POST", "/seat-attributes", {
    token: suToken, body: { key: "USB Socket!", label: "USB socket", valueType: "boolean" },
  });
  check("new attribute created", newAttr.status === 201, JSON.stringify(newAttr.body));
  check("key normalised to a slug", newAttr.body?.attribute?.key === "usb_socket",
    newAttr.body?.attribute?.key);

  const badEnum = await call("POST", "/seat-attributes", {
    token: suToken, body: { key: "recline", label: "Recline", valueType: "enum", options: [] },
  });
  check("enum without options rejected", badEnum.status === 400, `got ${badEnum.status}`);

  await call("DELETE", `/seat-attributes/${newAttr.body.attribute.id}`, { token: suToken });
  // Left in place deliberately: it now has a route, and the delete guard
  // refuses that — which is the behaviour test-train-guard asserts.

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
