// Segment inventory, hammered on one seat.
//
// Written because the booking transaction changed to record travel dates, and
// that transaction is where held segments become ticketed ones. If anything
// there were subtly wrong, partial availability is exactly what would break —
// and it would break quietly, as a seat that is sellable twice or not at all.
//
// Every assertion below is about ONE seat across the WHOLE route, so nothing
// else on the departure can mask a fault.
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

(async () => {
  const buyer = await login("unittest-user@example.com");
  const admin = await login("unittest-admin@example.com");
  const su = await login("unittest-super1@example.com");
  const bt = buyer.accessToken, at = admin.accessToken, st = su.accessToken;

  const me = (await call("GET", "/auth/profile", { token: bt })).body.profile;
  const passenger = { name: me.fullName, nid: me.nid, dob: me.dateOfBirth };

  const fund = async (amountMinor) => {
    const bal = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
    if (bal > 0) {
      await call("POST", `/wallet/user/${me.id}/adjust`, {
        token: st, body: { amount: bal / 100, direction: "debit", description: "segment probe reset" },
      });
    }
    await call("POST", `/wallet/user/${me.id}/adjust`, {
      token: st, body: { amount: amountMinor / 100, direction: "credit", description: "segment probe" },
    });
  };

  // Ekota: 11 stops, 10 segments. Far enough out that nothing else is fighting.
  const trips = (await call("GET", "/trips?trainId=1&limit=50", { token: at })).body.trips
    .filter((t) => t.status === "scheduled" && t.seatCount > 0);
  const trip = trips[trips.length - 1];
  const train = (await call("GET", `/trains/${trip.trainId}`, { token: at })).body.train;
  const S = (n) => train.stops[n - 1].stationId; // 1-based, as the route reads
  const LAST = S(11);

  console.log(`Ekota Express ${trip.departureDate} (trip ${trip.id}), ${train.stops.length} stops\n`);

  const avail = async (from, to) =>
    (await call("GET",
      `/trips/${trip.id}/availability?fromStationId=${from}&toStationId=${to}`, { token: at })).body;

  const timeline = async (seatId) =>
    (await call("GET", `/trips/${trip.id}/seats/${seatId}/timeline`, { token: at })).body;

  const sell = async (seatId, from, to) => {
    const hold = await call("POST", "/holds", {
      token: bt, body: { tripId: trip.id, seatIds: [seatId], fromStationId: from, toStationId: to },
    });
    if (hold.status !== 201) return { ok: false, why: msg(hold), status: hold.status };

    const q = await call("POST", "/bookings/quote", { token: bt, body: { holdReference: hold.body.hold.reference } });
    await fund(q.body.totalMinor);
    const bk = await call("POST", "/bookings", {
      token: bt,
      body: { holdReference: hold.body.hold.reference, passengers: [passenger], method: "wallet" },
    });
    if (bk.status !== 201) {
      await call("DELETE", `/holds/${hold.body.hold.reference}`, { token: bt });
      return { ok: false, why: msg(bk), status: bk.status };
    }
    return { ok: true, booking: bk.body.booking };
  };

  /* ================================================================ */
  console.log("== one seat, free right along the route ==");
  const wholeRoute = await avail(S(1), LAST);
  const seat = wholeRoute.available[0];
  check("found a seat free end to end", !!seat, "none");
  if (!seat) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }
  console.log(`  seat ${seat.seatNumber} (id ${seat.id})\n`);

  const before = await timeline(seat.id);
  check("its ten segments are all free",
    before.segments.every((s) => s.occupiedBy === null),
    JSON.stringify(before.segments.map((s) => s.occupiedBy)));

  /* ================================================================ */
  console.log("\n== sell the MIDDLE of the route (stops 4 to 7) ==");
  const sold = await sell(seat.id, S(4), S(7));
  check("sold", sold.ok, sold.why);
  if (!sold.ok) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }

  const after = await timeline(seat.id);
  const occupied = after.segments.filter((s) => s.occupiedBy === "ticket").map((s) => s.index);
  check("exactly segments 3, 4 and 5 are ticketed",
    JSON.stringify(occupied) === JSON.stringify([3, 4, 5]), JSON.stringify(occupied));
  check("and nothing else on the seat moved",
    after.segments.filter((s) => s.occupiedBy).length === 3,
    JSON.stringify(after.segments.map((s) => s.occupiedBy)));

  /* ================================================================ */
  console.log("\n== both ends are still sellable ==");
  const head = await avail(S(1), S(4));
  const tail = await avail(S(7), LAST);
  check("stops 1-4, ending where the sale starts, still offers it",
    head.available.some((s) => s.id === seat.id), "the head of the route lost the seat");
  check("stops 7-11, starting where the sale ends, still offers it",
    tail.available.some((s) => s.id === seat.id), "the tail of the route lost the seat");

  const shortHead = await avail(S(2), S(3));
  check("a short hop entirely before the sale still offers it",
    shortHead.available.some((s) => s.id === seat.id));
  const shortTail = await avail(S(9), S(10));
  check("a short hop entirely after it still offers it",
    shortTail.available.some((s) => s.id === seat.id));

  /* ================================================================ */
  console.log("\n== anything overlapping it is refused ==");
  const overlaps = [
    ["exactly the sold stretch", 4, 7],
    ["starting inside it", 5, 9],
    ["ending inside it", 2, 6],
    ["containing it", 1, 11],
    ["one segment inside it", 5, 6],
    ["touching its first segment", 3, 5],
    ["touching its last segment", 6, 8],
  ];

  for (const [label, from, to] of overlaps) {
    const a = await avail(S(from), S(to));
    check(`${label} (${from}-${to}) cannot have the seat`,
      !a.available.some((s) => s.id === seat.id),
      "the seat was offered on a journey that overlaps a sale");
  }

  console.log("\n== and the clear stretches genuinely are clear ==");
  const clear = [
    ["before the sale", 1, 4],
    ["after the sale", 7, 11],
    ["a single segment before", 1, 2],
    ["a single segment after", 10, 11],
    ["ending exactly where it starts", 3, 4],
    ["starting exactly where it ends", 7, 8],
  ];

  for (const [label, from, to] of clear) {
    const a = await avail(S(from), S(to));
    check(`${label} (${from}-${to}) still offers it`,
      a.available.some((s) => s.id === seat.id),
      "a journey clear of the sale lost the seat");
  }

  /* ================================================================ */
  console.log("\n== a second sale on the SAME seat, on a clear stretch ==");
  const second = await sell(seat.id, S(8), S(10));
  check("the same seat sells again further along", second.ok, second.why);

  if (second.ok) {
    const twice = await timeline(seat.id);
    const nowTicketed = twice.segments.filter((s) => s.occupiedBy === "ticket").map((s) => s.index);
    check("now segments 3,4,5 and 7,8 are ticketed",
      JSON.stringify(nowTicketed) === JSON.stringify([3, 4, 5, 7, 8]), JSON.stringify(nowTicketed));
    check("segment 6, the gap between them, is still free",
      twice.segments[6].occupiedBy === null, JSON.stringify(twice.segments[6]));

    const gap = await avail(S(7), S(8));
    check("and that gap is still purchasable",
      gap.available.some((s) => s.id === seat.id), "the one free segment between two sales was lost");

    const across = await avail(S(7), S(9));
    check("but a journey crossing into the second sale is not",
      !across.available.some((s) => s.id === seat.id));
  }

  /* ================================================================ */
  console.log("\n== the matrix agrees, pair by pair ==");
  const m = (await call("GET", `/trips/${trip.id}/availability/matrix`, { token: at })).body;
  let mismatches = 0;
  let checkedPairs = 0;

  for (const pair of m.pairs) {
    const direct = await avail(pair.fromStationId, pair.toStationId);
    checkedPairs++;
    if (direct.availableCount !== pair.available) {
      mismatches++;
      if (mismatches <= 3) {
        console.log(`      ${pair.fromSequence}-${pair.toSequence}: matrix ${pair.available}, direct ${direct.availableCount}`);
      }
    }
  }
  check(`all ${checkedPairs} pairs agree with a direct availability call`, mismatches === 0,
    `${mismatches} disagreed`);

  /* ================================================================ */
  console.log("\n== the passenger-facing matrix agrees too ==");
  const pm = (await call("GET", `/search/departures/${trip.id}/matrix`, { token: bt })).body;
  const operatorByPair = new Map(m.pairs.map((p) => [`${p.fromSequence}-${p.toSequence}`, p.available]));
  const passengerDisagreements = pm.pairs.filter(
    (p) => operatorByPair.get(`${p.fromSequence}-${p.toSequence}`) !== p.available
  );
  check("a passenger sees the same numbers an operator does",
    passengerDisagreements.length === 0,
    JSON.stringify(passengerDisagreements.slice(0, 3)));

  /* ================================================================ */
  console.log("\n== the travel dates did not disturb any of it ==");
  check("the booking recorded a boarding date", !!sold.booking.boardingDate, JSON.stringify(sold.booking.boardingDate));
  check("and it did not become the segment key",
    sold.booking.tickets[0].tripSeatId === seat.id,
    `${sold.booking.tickets[0].tripSeatId} vs ${seat.id}`);
  check("the ticket still points at the seat it occupies",
    after.segments.filter((s) => s.occupiedBy === "ticket").length === 3);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("harness error:", e); process.exit(1); });
