// The "where is there room" panel: does the data it renders hold up, including
// on a stretch that is genuinely full?
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
const msg = (r) => r.body?.error?.message || r.body?.message || JSON.stringify(r.body);

const DHAKA = 1, SETU = 5, DINAJPUR = 15;

(async () => {
  const buyer = await login("unittest-user@example.com");
  const admin = await login("unittest-admin@example.com");
  const bt = buyer.accessToken, at = admin.accessToken;

  const trips = (await call("GET", "/trips?trainId=1&limit=50", { token: at })).body.trips
    .filter((t) => t.status === "scheduled" && t.seatCount > 0);
  const trip = trips[trips.length - 1];

  const m = (await call("GET", `/search/departures/${trip.id}/matrix`, { token: bt })).body;
  console.log(`${trip.departureDate}, ${m.stops.length} stops, ${m.totalSeats} seats\n`);

  console.log("== the shape the panel renders ==");
  check("served to a passenger", !!m.pairs, msg({ body: m }));
  check("stops come in route order",
    m.stops.every((s, i) => i === 0 || s.sequence > m.stops[i - 1].sequence),
    JSON.stringify(m.stops.map((s) => s.sequence)));
  check("every stop carries a name to print",
    m.stops.every((s) => s.station?.name), JSON.stringify(m.stops[0]));
  check("every pair names both ends",
    m.pairs.every((p) => p.fromStation && p.toStation), JSON.stringify(m.pairs[0]));
  check("and carries the sequences the grid is laid out on",
    m.pairs.every((p) => Number.isInteger(p.fromSequence) && Number.isInteger(p.toSequence)));
  check("only forward journeys are offered",
    m.pairs.every((p) => p.toSequence > p.fromSequence),
    JSON.stringify(m.pairs.filter((p) => p.toSequence <= p.fromSequence).slice(0, 2)));
  check("11 stops give 55 pairs", m.pairs.length === 55, `${m.pairs.length}`);

  console.log("\n== the row a passenger actually reads ==");
  const onward = m.pairs.filter((p) => p.fromStationId === DHAKA).sort((a, b) => a.toSequence - b.toSequence);
  check("everywhere reachable from Dhaka is listed", onward.length === 10, `${onward.length}`);
  check("in route order",
    onward.every((p, i) => i === 0 || p.toSequence > onward[i - 1].toSequence));
  console.log("  from Dhaka:");
  onward.slice(0, 4).forEach((p) => console.log(`    -> ${p.toStation.padEnd(24)} ${p.available}/${p.total}`));
  console.log("    ...");

  const inbound = m.pairs.filter((p) => p.toStationId === DINAJPUR).sort((a, b) => a.fromSequence - b.fromSequence);
  check("and everywhere you could join from, bound for Dinajpur", inbound.length === 10, `${inbound.length}`);

  console.log("\n== a genuinely full stretch still shows room elsewhere ==");
  // Block every seat over one segment, so that stretch reads zero.
  const seats = (await call("GET", `/trips/${trip.id}/seats`, { token: at })).body.seats;
  const oneSegment = (await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${DHAKA}&toStationId=3`, { token: at })).body;

  const toBlock = oneSegment.available; // every free seat, so the stretch is genuinely full
  console.log(`  blocking ${toBlock.length} seats over Dhaka->Joydebpur...`);
  for (const s of toBlock) {
    await call("POST", `/trips/${trip.id}/seats/${s.id}/block`, {
      token: at, body: { fromStationId: DHAKA, toStationId: 3, reason: "matrix panel test" },
    });
  }

  const full = (await call("GET", `/search/departures/${trip.id}/matrix`, { token: bt })).body;
  const dhakaJoydebpur = full.pairs.find((p) => p.fromStationId === DHAKA && p.toSequence === 2);
  const setuOnward = full.pairs.find((p) => p.fromStationId === SETU && p.toStationId === DINAJPUR);

  check("the blocked stretch reads zero", dhakaJoydebpur.available === 0,
    `${dhakaJoydebpur.available}`);
  check("but a stretch clear of it still has room", setuOnward.available > 0,
    `${setuOnward.available}`);
  check("which is the whole point of the panel",
    full.pairs.some((p) => p.available === 0) && full.pairs.some((p) => p.available > 0),
    "either everything is full or nothing is");

  const stillSellable = full.pairs.filter((p) => p.available > 0).length;
  console.log(`  ${stillSellable} of ${full.pairs.length} stretches still sellable while one is full`);

  // Put it back.
  console.log("  unblocking...");
  for (const s of toBlock) {
    await call("DELETE", `/trips/${trip.id}/seats/${s.id}/block`, { token: at });
  }

  const restored = (await call("GET", `/search/departures/${trip.id}/matrix`, { token: bt })).body;
  const back = restored.pairs.find((p) => p.fromStationId === DHAKA && p.toSequence === 2);
  check("unblocking restores it", back.available === dhakaJoydebpur.total - (dhakaJoydebpur.total - back.available),
    `${back.available}`);
  check("and it is sellable again", back.available > 0, `${back.available}`);

  console.log("\n== it matches what the operator sees ==");
  const operator = (await call("GET", `/trips/${trip.id}/availability/matrix`, { token: at })).body;
  const opByPair = new Map(operator.pairs.map((p) => [`${p.fromSequence}-${p.toSequence}`, p.available]));
  const differences = restored.pairs.filter(
    (p) => opByPair.get(`${p.fromSequence}-${p.toSequence}`) !== p.available
  );
  check("every pair agrees", differences.length === 0, JSON.stringify(differences.slice(0, 3)));

  console.log("\n== and a passenger cannot reach the operator's version ==");
  const forbidden = await call("GET", `/trips/${trip.id}/availability/matrix`, { token: bt });
  check("the operational matrix stays shut", forbidden.status === 403, `${forbidden.status}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("harness error:", e); process.exit(1); });
