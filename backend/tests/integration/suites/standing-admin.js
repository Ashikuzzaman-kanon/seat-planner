// Managing standing: capacity on the class, an on/off switch on the departure.
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
  const planner = await login("unittest-planner@example.com");
  const su = await login("unittest-super1@example.com");
  const bt = buyer.accessToken, at = admin.accessToken, pt = planner.accessToken, st = su.accessToken;

  const me = (await call("GET", "/auth/profile", { token: bt })).body.profile;
  const passenger = { name: me.fullName, nid: me.nid, dob: me.dateOfBirth };

  /* ============================================================== */
  console.log("== lever 1: capacity, on the coach class ==");

  const classes = (await call("GET", "/reference/coach-classes", { token: at })).body.items;
  check("classes carry their capacity", classes.every((c) => typeof c.standingCapacity === "number"),
    JSON.stringify(classes.map((c) => [c.name, c.standingCapacity])));
  check("and say whether they sell standing at all",
    classes.every((c) => typeof c.sellsStanding === "boolean"));

  const target = classes.find((c) => c.name === "Shovon Chair");
  const original = target.standingCapacity;
  console.log(`  ${target.name}: ${original} per coach`);

  const plannerTries = await call("PUT", `/reference/coach-classes/${target.id}`, {
    token: pt, body: { name: target.name, standingCapacity: 5 },
  });
  check("a planner cannot change it", plannerTries.status === 403, `${plannerTries.status}`);

  const changed = await call("PUT", `/reference/coach-classes/${target.id}`, {
    token: at, body: { name: target.name, standingCapacity: 12 },
  });
  check("an admin can", changed.status === 200, msg(changed));
  check("and it takes", changed.body.item.standingCapacity === 12, `${changed.body.item.standingCapacity}`);

  const silly = await call("PUT", `/reference/coach-classes/${target.id}`, {
    token: at, body: { name: target.name, standingCapacity: -5 },
  });
  check("a negative capacity is refused", silly.status === 400, `${silly.status}`);

  const huge = await call("PUT", `/reference/coach-classes/${target.id}`, {
    token: at, body: { name: target.name, standingCapacity: 9999 },
  });
  check("an absurd one is too", huge.status === 400, `${huge.status}`);

  const renamed = await call("PUT", `/reference/coach-classes/${target.id}`, {
    token: at, body: { name: target.name, standingCapacity: original },
  });
  check("restored", renamed.body.item.standingCapacity === original);

  const noStanding = classes.find((c) => c.standingCapacity === 0);
  check("some classes sell no standing at all", !!noStanding,
    JSON.stringify(classes.map((c) => c.standingCapacity)));

  /* ============================================================== */
  console.log("\n== lever 2: the switch, on the departure ==");

  const trips = (await call("GET", "/trips?trainId=1&limit=50", { token: at })).body.trips
    .filter((t) => t.status === "scheduled" && t.seatCount > 0);
  const trip = trips[trips.length - 1];

  check("a departure says whether standing is on",
    typeof trip.standingEnabled === "boolean", JSON.stringify(trip.standingEnabled));
  check("and it is on by default", trip.standingEnabled === true);

  const passengerTries = await call("PATCH", `/trips/${trip.id}/standing`, {
    token: bt, body: { enabled: false },
  });
  check("a passenger cannot throw it", passengerTries.status === 403, `${passengerTries.status}`);

  // Buy a seat so there is something to attach standing to.
  const train = (await call("GET", `/trains/${trip.trainId}`, { token: at })).body.train;
  const S = (n) => train.stops[n - 1].stationId;

  const avail = (await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${S(4)}&toStationId=${S(7)}&coachClassId=${target.id}`,
    { token: at })).body;
  check("a seat is free in the standing class", avail.availableCount > 0, `${avail.availableCount}`);

  const hold = await call("POST", "/holds", {
    token: bt,
    body: { tripId: trip.id, seatIds: [avail.available[0].id], fromStationId: S(4), toStationId: S(7) },
  });
  const q = await call("POST", "/bookings/quote", { token: bt, body: { holdReference: hold.body.hold.reference } });

  const bal = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  if (bal > 0) {
    await call("POST", `/wallet/user/${me.id}/adjust`, {
      token: st, body: { amount: bal / 100, direction: "debit", description: "admin test reset" },
    });
  }
  await call("POST", `/wallet/user/${me.id}/adjust`, {
    token: st, body: { amount: q.body.totalMinor / 100 + 500, direction: "credit", description: "admin test" },
  });

  const booked = await call("POST", "/bookings", {
    token: bt,
    body: { holdReference: hold.body.hold.reference, passengers: [passenger], method: "wallet" },
  });
  check("bought a seat", booked.status === 201, msg(booked));
  const seated = booked.body.booking.tickets[0];

  const onOffer = (await call("GET", `/tickets/${seated.id}/standing`, { token: bt })).body;
  check("standing is offered while the switch is on", onOffer.sellsStanding === true);
  check("with the class capacity behind it", onOffer.coachCapacity === original,
    `${onOffer.coachCapacity} vs ${original}`);

  console.log("\n  -- switching it off --");
  const off = await call("PATCH", `/trips/${trip.id}/standing`, { token: at, body: { enabled: false } });
  check("an operator can switch it off", off.status === 200, msg(off));
  check("the departure records it", off.body.trip.standingEnabled === false);

  const offered = (await call("GET", `/tickets/${seated.id}/standing`, { token: bt })).body;
  check("standing is no longer offered", offered.sellsStanding === false);
  check("and it says the departure is the reason, not the class",
    /not being sold on this departure/i.test(offered.unavailableReason || ""),
    offered.unavailableReason);
  check("while the class still reports its own capacity",
    offered.classCapacity === original, `${offered.classCapacity}`);
  check("every leg is closed", offered.legs.every((l) => !l.available));

  const refused = await call("POST", `/tickets/${seated.id}/standing`, {
    token: bt, body: { fromStationId: S(1), toStationId: S(4) },
  });
  check("and buying is refused, not merely hidden", refused.status === 409 || refused.status === 400,
    `${refused.status}: ${msg(refused)}`);

  console.log("\n  -- and back on --");
  const backOn = await call("PATCH", `/trips/${trip.id}/standing`, { token: at, body: { enabled: true } });
  check("switched back", backOn.body.trip.standingEnabled === true);
  const reopened = (await call("GET", `/tickets/${seated.id}/standing`, { token: bt })).body;
  check("standing is on offer again", reopened.sellsStanding === true);
  check("and legs are buyable", reopened.legs.some((l) => l.available));

  /* ============================================================== */
  console.log("\n== the stricter of the two always wins ==");

  await call("PUT", `/reference/coach-classes/${target.id}`, {
    token: at, body: { name: target.name, standingCapacity: 0 },
  });
  const classOff = (await call("GET", `/tickets/${seated.id}/standing`, { token: bt })).body;
  check("a class at zero closes standing even with the departure switch on",
    classOff.sellsStanding === false && classOff.standingEnabledOnDeparture === true,
    JSON.stringify([classOff.sellsStanding, classOff.standingEnabledOnDeparture]));
  check("and says the class is the reason",
    /not sold in this class/i.test(classOff.unavailableReason || ""), classOff.unavailableReason);

  await call("PUT", `/reference/coach-classes/${target.id}`, {
    token: at, body: { name: target.name, standingCapacity: original },
  });
  const restored = (await call("GET", `/tickets/${seated.id}/standing`, { token: bt })).body;
  check("restoring the class restores standing", restored.sellsStanding === true);

  // Leave the seat returned so the suite is repeatable.
  await call("POST", `/tickets/${seated.id}/refund`, { token: bt, body: { type: "convenient" } });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("harness error:", e); process.exit(1); });
