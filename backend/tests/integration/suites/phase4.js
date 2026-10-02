// Phase 4 — segment-level seat inventory, quota and availability.
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

(async () => {
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }

  const admin = (await call("POST", "/auth/login", {
    body: { email: "admin1@example.com", password: "Admin123!" },
  })).body;
  const t = admin.accessToken;
  const planner = (await call("POST", "/auth/login", {
    body: { email: "planner1@example.com", password: "Planner123!" },
  })).body.accessToken;

  console.log("\n== permissions ==");
  check("admin holds inventory:view", admin.permissions.includes("inventory:view"));
  check("admin holds quota:manage", admin.permissions.includes("quota:manage"));

  // Find an Ekota departure with its full 404 seats.
  const trips = (await call("GET", "/trips?limit=500", { token: t })).body.trips;
  const trip = trips.find((x) => x.train.name === "Ekota Express" && x.status === "scheduled" && x.seatCount === 404);
  check("found a fully built Ekota departure", !!trip, `seatCounts: ${trips.slice(0,3).map(x=>x.seatCount)}`);

  const detail = (await call("GET", `/trains/${trip.trainId}`, { token: t })).body.train;
  const stops = detail.stops;
  check("route has 11 stops / 10 segments", stops.length === 11, `got ${stops.length}`);

  const S = (seq) => stops.find((s) => s.sequence === seq).stationId;
  const A = S(1), B = S(2), C = S(3), D = S(4), LAST = S(11);

  const plannerBlocked = await call("GET", `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}`, { token: planner });
  check("planner blocked from inventory", plannerBlocked.status === 403, `got ${plannerBlocked.status}`);

  console.log("\n== a fresh departure is entirely available ==");
  const whole = await call("GET", `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${LAST}`, { token: t });
  check("end to end offers all 404 seats", whole.body.availableCount === 404, `got ${whole.body.availableCount}`);
  check("that journey spans 10 segments", whole.body.segments.length === 10, JSON.stringify(whole.body.segments));

  console.log("\n== the headline behaviour ==");
  // Occupy one seat over B->C only.
  const seats = (await call("GET", `/trips/${trip.id}/seats`, { token: t })).body.seats;
  const victim = seats[0];

  const blocked = await call("POST", `/trips/${trip.id}/seats/${victim.id}/block`, {
    token: t, body: { fromStationId: B, toStationId: C, reason: "Phase 4 demonstration" },
  });
  check("seat occupied over exactly one segment", blocked.body.reserved === 1, JSON.stringify(blocked.body));

  const bc = await call("GET", `/trips/${trip.id}/availability?fromStationId=${B}&toStationId=${C}`, { token: t });
  check("B to C now offers 403", bc.body.availableCount === 403, `got ${bc.body.availableCount}`);

  const ab = await call("GET", `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}`, { token: t });
  check("A to B still offers all 404 — the seat is free there", ab.body.availableCount === 404,
    `got ${ab.body.availableCount}`);

  const cd = await call("GET", `/trips/${trip.id}/availability?fromStationId=${C}&toStationId=${D}`, { token: t });
  check("C to D still offers all 404 — free there too", cd.body.availableCount === 404,
    `got ${cd.body.availableCount}`);

  const across = await call("GET", `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${D}`, { token: t });
  check("a journey crossing B-C cannot have it", across.body.availableCount === 403,
    `got ${across.body.availableCount}`);
  check("and it says why", across.body.withheld.blocked === 1, JSON.stringify(across.body.withheld));

  console.log("\n== the same seat, seen along the whole route ==");
  const timeline = (await call("GET", `/trips/${trip.id}/seats/${victim.id}/timeline`, { token: t })).body;
  check("timeline covers all 10 segments", timeline.segments.length === 10, `got ${timeline.segments.length}`);
  const taken = timeline.segments.filter((s) => s.occupiedBy);
  check("exactly one segment is occupied", taken.length === 1, JSON.stringify(taken));
  check("and it is segment 1 (B to C)", taken[0].index === 1, JSON.stringify(taken[0]));

  console.log("\n== availability matrix ==");
  const m = (await call("GET", `/trips/${trip.id}/availability/matrix`, { token: t })).body;
  check("matrix covers every forward pair", m.pairs.length === 55, `got ${m.pairs.length}`);
  const abPair = m.pairs.find((p) => p.fromStationId === A && p.toStationId === B);
  const bcPair = m.pairs.find((p) => p.fromStationId === B && p.toStationId === C);
  check("matrix agrees with the per-journey answer",
    abPair.available === 404 && bcPair.available === 403,
    `A-B ${abPair.available}, B-C ${bcPair.available}`);
  // Journeys crossing segment 1 are those starting at stop 1 or 2 and ending at
  // stop 3 or later: 2 x 9 = 18 of the 55 pairs.
  const affected = m.pairs.filter((p) => p.available < 404).length;
  check("exactly the 18 pairs crossing B-C are reduced", affected === 18,
    `${affected} pairs reduced`);
  check("every reduced pair really does span segment 1",
    m.pairs.filter((p) => p.available < 404).every((p) => p.segments.includes(1)));

  console.log("\n== unblocking restores it ==");
  await call("DELETE", `/trips/${trip.id}/seats/${victim.id}/block`, { token: t });
  const restored = await call("GET", `/trips/${trip.id}/availability?fromStationId=${B}&toStationId=${C}`, { token: t });
  check("B to C back to 404", restored.body.availableCount === 404, `got ${restored.body.availableCount}`);

  console.log("\n== feature filters ==");
  const windows = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}&filters=${encodeURIComponent('{"window":true}')}`,
    { token: t });
  check("window filter narrows to 158 seats", windows.body.availableCount === 158,
    `got ${windows.body.availableCount}`);
  check("the rest are reported as filtered out",
    windows.body.withheld.does_not_match_filters === 404 - 158,
    JSON.stringify(windows.body.withheld));

  const halfWindows = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}&filters=${encodeURIComponent('{"window":"half"}')}`,
    { token: t });
  check("a specific window type filters further", halfWindows.body.availableCount < 158,
    `got ${halfWindows.body.availableCount}`);

  const badFilter = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}&filters=notjson`, { token: t });
  check("a malformed filter is rejected clearly", badFilter.status === 400, `got ${badFilter.status}`);

  console.log("\n== route validation ==");
  const backwards = await call("GET", `/trips/${trip.id}/availability?fromStationId=${D}&toStationId=${A}`, { token: t });
  check("a backwards journey is refused", backwards.status === 400, `got ${backwards.status}`);

  const classes = (await call("GET", "/reference/coach-classes", { token: t })).body.items;
  const acChair = classes.find((c) => c.name === "AC Chair");
  const byClass = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}&coachClassId=${acChair.id}`, { token: t });
  check("narrowing to AC Chair gives 80", byClass.body.availableCount === 80, `got ${byClass.body.availableCount}`);

  console.log("\n== quota: exact-pair reservation ==");
  const rule = await call("POST", "/quota/rules", {
    token: t,
    body: {
      trainId: trip.trainId, coachClassId: acChair.id,
      fromStationId: A, toStationId: C,
      quantity: 10, releaseHoursBefore: 24, priority: 10,
    },
  });
  check("quota rule created", rule.status === 201, JSON.stringify(rule.body));

  const offRoute = await call("POST", "/quota/rules", {
    token: t,
    body: { trainId: trip.trainId, coachClassId: acChair.id, fromStationId: C, toStationId: A, quantity: 1 },
  });
  check("a backwards pair is rejected", offRoute.status === 400, `got ${offRoute.status}`);

  const applied = await call("POST", `/quota/trains/${trip.trainId}/materialise`, { token: t, body: { replace: true } });
  check("rules applied across upcoming departures", applied.status === 200, JSON.stringify(applied.body?.message));
  check("10 seats reserved per departure",
    applied.body.assigned === applied.body.trips * 10,
    `${applied.body.assigned} across ${applied.body.trips}`);

  // A reservation only holds while its release time is still ahead. Today's
  // departure leaves tonight, so its 24-hour release has already passed — the
  // far end of the horizon is where the hold is still in force.
  const ekotaTrips = trips.filter((x) => x.train.name === "Ekota Express" && x.status === "scheduled");
  const future = ekotaTrips[ekotaTrips.length - 1];
  check("picked a departure whose release time is still ahead", future.departureDate > trip.departureDate,
    `${trip.departureDate} vs ${future.departureDate}`);

  const acAB = await call("GET",
    `/trips/${future.id}/availability?fromStationId=${A}&toStationId=${B}&coachClassId=${acChair.id}`, { token: t });
  check("AC Chair A to B drops to 70 — 10 are held for A to C", acAB.body.availableCount === 70,
    `got ${acAB.body.availableCount}`);
  check("withheld reports the reservation",
    acAB.body.withheld.reserved_for_other_pair === 10, JSON.stringify(acAB.body.withheld));

  const acAC = await call("GET",
    `/trips/${future.id}/availability?fromStationId=${A}&toStationId=${C}&coachClassId=${acChair.id}`, { token: t });
  check("but A to C still offers all 80 — the held seats are for exactly this",
    acAC.body.availableCount === 80, `got ${acAC.body.availableCount}`);

  console.log("\n== a reservation past its release time is already open ==");
  const nearAB = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}&coachClassId=${acChair.id}`, { token: t });
  check("tonight's departure ignores the hold — its release time has passed",
    nearAB.body.availableCount === 80, `got ${nearAB.body.availableCount}`);

  console.log("\n== quota release returns them to open sale ==");
  const released = await call("POST", `/trips/${future.id}/quota/release`, { token: t });
  check("released early by hand", released.body.released === 10, JSON.stringify(released.body));

  const afterRelease = await call("GET",
    `/trips/${future.id}/availability?fromStationId=${A}&toStationId=${B}&coachClassId=${acChair.id}`, { token: t });
  check("AC Chair A to B back to 80", afterRelease.body.availableCount === 80,
    `got ${afterRelease.body.availableCount}`);

  console.log("\n== cleanup ==");
  const del = await call("DELETE", `/quota/rules/${rule.body.rule.id}`, { token: t });
  check("quota rule deleted", del.status === 200);
  await call("POST", `/quota/trains/${trip.trainId}/materialise`, { token: t, body: { replace: true } });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
