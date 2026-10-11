// Phase 5A, the parts HTTP cannot reach on its own:
//   1. one wallet, several simultaneous purchases, only enough credit for one
//   2. the expiry job actually returning abandoned seats to sale
//
// Part 1 goes over HTTP so the whole stack is under contention. Part 2 runs
// in-process so a hold can be backdated instead of waiting a real minute out.
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

const daysAhead = (d) => {
  const t = new Date();
  return Math.round(
    (new Date(`${d}T00:00:00Z`) - Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())) / 86400000
  );
};

const PASSENGER = (n) => ({ name: `Race Passenger ${n}`, nid: `199088887777${n}`, dob: "1988-02-02" });

async function findTrip(token) {
  const trips = (await call("GET", "/trips?limit=500", { token })).body.trips;
  const candidates = trips
    .filter((t) => t.status === "scheduled" && t.seatCount > 20 && daysAhead(t.departureDate) >= 2)
    .sort((a, b) => b.seatCount - a.seatCount);

  for (const c of candidates) {
    const train = (await call("GET", `/trains/${c.trainId}`, { token })).body.train;
    if (train?.stops?.length >= 4) return { trip: c, train };
  }
  return {};
}

(async () => {
  const buyer = await login("unittest-user@example.com");
  const admin = await login("unittest-admin@example.com");
  const su = await login("unittest-super1@example.com");
  const bt = buyer.accessToken, at = admin.accessToken, st = su.accessToken;

  const { trip, train } = await findTrip(at);
  if (!trip) { console.log("no usable departure"); process.exit(1); }
  const A = train.stops[0].stationId;
  const B = train.stops[1].stationId;
  console.log(`using ${train.name} on ${trip.departureDate}`);

  /* ---------------------------------------------------------------- *
   * One wallet, five buyers, credit for one
   * ---------------------------------------------------------------- */
  console.log("\n== a wallet cannot be spent twice ==");

  const RACERS = 5;
  const avail = (await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}`, { token: at })).body;
  const seats = avail.available.slice(0, RACERS).map((s) => s.id);
  check(`found ${RACERS} free seats to race for`, seats.length === RACERS, `${seats.length}`);

  // Each racer gets their OWN seat, so the only thing they contend over is money.
  const holds = [];
  for (const seatId of seats) {
    const h = await call("POST", "/holds", {
      token: bt, body: { tripId: trip.id, seatIds: [seatId], fromStationId: A, toStationId: B },
    });
    holds.push(h.body.hold.reference);
  }
  check("each racer holds a different seat", new Set(holds).size === RACERS);

  const fare = (await call("POST", "/bookings/quote", { token: bt, body: { holdReference: holds[0] } }))
    .body.totalMinor;

  // Empty the wallet, then fund exactly one fare.
  const balance = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  if (balance > 0) {
    await call("POST", `/wallet/user/${buyer.user.id}/adjust`, {
      token: st,
      body: { amount: balance / 100, direction: "debit", description: "Race suite: empty the wallet" },
    });
  }
  await call("POST", `/wallet/user/${buyer.user.id}/adjust`, {
    token: st,
    body: { amount: fare / 100, direction: "credit", description: "Race suite: exactly one fare" },
  });
  const funded = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  check("the wallet holds exactly one fare", funded === fare, `${funded} vs ${fare}`);

  const results = await Promise.all(
    holds.map((reference, i) =>
      call("POST", "/bookings", {
        token: bt,
        body: { holdReference: reference, passengers: [PASSENGER(i)], method: "wallet" },
      })
    )
  );

  const won = results.filter((r) => r.status === 201);
  const lost = results.filter((r) => r.status !== 201);
  check("exactly one purchase went through", won.length === 1,
    `${won.length} succeeded: ${JSON.stringify(results.map((r) => r.status))}`);
  check("the rest were told the wallet was short",
    lost.every((r) => r.status === 400 && /balance/i.test(r.body?.error?.message || "")),
    JSON.stringify(lost.map((r) => r.body?.error?.message)));

  const drained = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  check("the wallet is empty, never negative", drained === 0, `${drained}`);

  const ledger = (await call("GET", "/wallet/verify", { token: bt })).body;
  check("the ledger agrees with the cached balance", ledger.consistent === true, JSON.stringify(ledger));

  const afterRace = (await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}`, { token: at })).body;
  check("only the sold seat left availability",
    afterRace.availableCount === avail.availableCount - RACERS,
    `${avail.availableCount} -> ${afterRace.availableCount} (the losers still hold theirs)`);

  // Give the losers' seats back, so the next run starts where this one did.
  for (let i = 0; i < holds.length; i++) {
    if (results[i].status !== 201) await call("DELETE", `/holds/${holds[i]}`, { token: bt });
  }
  const cleaned = (await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}`, { token: at })).body;
  check("releasing the losers returns all but the sold seat",
    cleaned.availableCount === avail.availableCount - 1,
    `${cleaned.availableCount} vs ${avail.availableCount - 1}`);

  /* ---------------------------------------------------------------- *
   * The expiry job
   * ---------------------------------------------------------------- */
  console.log("\n== an abandoned checkout is returned to sale ==");

  const abandoned = await call("POST", "/holds", {
    token: bt,
    body: { tripId: trip.id, seatIds: [cleaned.available[0].id], fromStationId: A, toStationId: B },
  });
  check("a checkout was opened", abandoned.status === 201, JSON.stringify(abandoned.body));

  const held = (await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}`, { token: at })).body;
  check("the seat left sale", held.availableCount === cleaned.availableCount - 1,
    `${cleaned.availableCount} -> ${held.availableCount}`);

  // Backdate it rather than waiting the timeout out for real.
  const { sequelize, SeatHold } = require("../../../src/models");
  const holdService = require("../../../src/services/holdService");

  await SeatHold.update(
    { expiresAt: new Date(Date.now() - 60_000) },
    { where: { reference: abandoned.body.hold.reference } }
  );

  const swept = await holdService.expireDue();
  check("the job found it", swept.expired >= 1, JSON.stringify(swept));
  check("and freed its segments", swept.seatsFreed >= 1, JSON.stringify(swept));

  const freed = (await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}`, { token: at })).body;
  check("the seat is on sale again", freed.availableCount === cleaned.availableCount,
    `${freed.availableCount} vs ${cleaned.availableCount}`);

  const expiredHold = await call("GET", `/holds/${abandoned.body.hold.reference}`, { token: bt });
  check("the hold reads as expired", expiredHold.body.hold.status === "expired",
    expiredHold.body.hold?.status);
  check("and is no longer live", expiredHold.body.hold.isLive === false);

  const quoteDead = await call("POST", "/bookings/quote", {
    token: bt, body: { holdReference: abandoned.body.hold.reference },
  });
  check("an expired checkout cannot be paid for", quoteDead.status === 400, `got ${quoteDead.status}`);

  const again = await holdService.expireDue();
  check("running the job twice changes nothing", again.expired === 0, JSON.stringify(again));

  await sequelize.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
