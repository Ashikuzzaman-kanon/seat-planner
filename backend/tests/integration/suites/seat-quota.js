// Reserving one NAMED seat for one NAMED station pair, by hand.
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

  const t = (await call("POST", "/auth/login", {
    body: { email: "admin1@example.com", password: "Admin123!" },
  })).body.accessToken;

  const trips = (await call("GET", "/trips?limit=500", { token: t })).body.trips;
  const ekota = trips.filter((x) => x.train.name === "Ekota Express" && x.status === "scheduled" && x.seatCount === 404);
  const trip = ekota[ekota.length - 1]; // far enough out that a release is still ahead

  const train = (await call("GET", `/trains/${trip.trainId}`, { token: t })).body.train;
  const S = (seq) => train.stops.find((s) => s.sequence === seq).stationId;
  const A = S(1), B = S(2), C = S(3);

  const seats = (await call("GET", `/trips/${trip.id}/seats`, { token: t })).body.seats;
  const chosen = seats.find((s) => s.seatNumber === "7") || seats[6];

  // Start clean.
  await call("DELETE", `/trips/${trip.id}/seats/${chosen.id}/quota`, { token: t });

  console.log(`\nDeparture ${trip.departureDate}, holding seat ${chosen.seatNumber} for stops 1 to 3\n`);

  console.log("== before ==");
  const before = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}`, { token: t });
  const baseline = before.body.availableCount;
  check("seat is on offer A to B", before.body.available.some((s) => s.id === chosen.id));

  console.log("\n== hold that exact seat for A to C ==");
  const held = await call("PUT", `/trips/${trip.id}/seats/${chosen.id}/quota`, {
    token: t, body: { fromStationId: A, toStationId: C, releaseHoursBefore: 24 },
  });
  check("hold accepted", held.status === 200, JSON.stringify(held.body));
  check("recorded as hand-placed, not rule-made", held.body.quota.ruleId === null,
    JSON.stringify(held.body.quota));

  const afterAB = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}`, { token: t });
  check("that seat is no longer offered A to B",
    !afterAB.body.available.some((s) => s.id === chosen.id));
  check("availability drops by exactly one", afterAB.body.availableCount === baseline - 1,
    `${baseline} -> ${afterAB.body.availableCount}`);
  check("and the reason is the reservation",
    afterAB.body.withheld.reserved_for_other_pair >= 1, JSON.stringify(afterAB.body.withheld));

  const afterAC = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${C}`, { token: t });
  check("but it IS offered for its own pair, A to C",
    afterAC.body.available.some((s) => s.id === chosen.id));

  console.log("\n== but a hold does not reach past its own stretch ==");
  const E = S(5), F = S(6);
  const later = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${E}&toStationId=${F}`, { token: t });
  check("the seat is still offered on a stretch the hold never touches",
    later.body.available.some((s) => s.id === chosen.id),
    "a hold for stops 1-3 wrongly removed it from stops 5-6");
  check("nothing is withheld there for the reservation",
    !later.body.withheld.reserved_for_other_pair, JSON.stringify(later.body.withheld));

  // And across the whole matrix: only pairs overlapping stops 1-3 may shrink.
  const m = (await call("GET", `/trips/${trip.id}/availability/matrix`, { token: t })).body;
  const reduced = m.pairs.filter((p) => p.available < m.totalSeats);
  const overlapsHold = (p) => p.fromSequence < 3 && p.toSequence > 1;
  check("every reduced pair genuinely overlaps the held stretch",
    reduced.length > 0 && reduced.every(overlapsHold),
    reduced.filter((p) => !overlapsHold(p)).map((p) => `${p.fromSequence}-${p.toSequence}`).join(","));
  check("pairs clear of the hold are untouched",
    m.pairs.filter((p) => !overlapsHold(p)).every((p) => p.available === m.totalSeats));

  console.log("\n== it shows up on the departure's hold list ==");
  const quota = (await call("GET", `/trips/${trip.id}/quota`, { token: t })).body.quota;
  const mine = quota.find((q) => q.tripSeatId === chosen.id);
  check("listed with its seat number and pair", !!mine && mine.seatNumber === chosen.seatNumber,
    JSON.stringify(mine));
  check("release time recorded", !!mine.releaseAt);

  console.log("\n== re-running the standing rules leaves it alone ==");
  const re = await call("POST", `/quota/trains/${trip.trainId}/materialise`, {
    token: t, body: { replace: true },
  });
  check("materialise ran", re.status === 200, JSON.stringify(re.body?.message));
  const stillThere = (await call("GET", `/trips/${trip.id}/quota`, { token: t })).body.quota
    .find((q) => q.tripSeatId === chosen.id);
  check("the hand-placed hold survived a full rebuild", !!stillThere,
    "it was wiped by materialise");

  console.log("\n== a seat already taken cannot be held for that stretch ==");
  const other = seats.find((s) => s.id !== chosen.id);
  await call("POST", `/trips/${trip.id}/seats/${other.id}/block`, {
    token: t, body: { fromStationId: A, toStationId: B, reason: "test" },
  });
  const clash = await call("PUT", `/trips/${trip.id}/seats/${other.id}/quota`, {
    token: t, body: { fromStationId: A, toStationId: C },
  });
  check("refused with a clear reason", clash.status === 409, `got ${clash.status}: ${clash.body?.message}`);
  await call("DELETE", `/trips/${trip.id}/seats/${other.id}/block`, { token: t });

  console.log("\n== validation ==");
  const backwards = await call("PUT", `/trips/${trip.id}/seats/${chosen.id}/quota`, {
    token: t, body: { fromStationId: C, toStationId: A },
  });
  check("a backwards pair is refused", backwards.status === 400, `got ${backwards.status}`);

  const planner = (await call("POST", "/auth/login", {
    body: { email: "planner1@example.com", password: "Planner123!" },
  })).body.accessToken;
  const denied = await call("PUT", `/trips/${trip.id}/seats/${chosen.id}/quota`, {
    token: planner, body: { fromStationId: A, toStationId: C },
  });
  check("a planner cannot hold seats", denied.status === 403, `got ${denied.status}`);

  console.log("\n== releasing it by hand ==");
  const cleared = await call("DELETE", `/trips/${trip.id}/seats/${chosen.id}/quota`, { token: t });
  check("cleared", cleared.status === 200, JSON.stringify(cleared.body?.message));

  const restored = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}`, { token: t });
  check("back on offer A to B", restored.body.available.some((s) => s.id === chosen.id));
  check("availability back to baseline", restored.body.availableCount === baseline,
    `${restored.body.availableCount} vs ${baseline}`);

  const twice = await call("DELETE", `/trips/${trip.id}/seats/${chosen.id}/quota`, { token: t });
  check("clearing an unheld seat says so", twice.status === 400, `got ${twice.status}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
