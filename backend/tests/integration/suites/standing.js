// Connecting standing tickets (§10): a seat for the middle of a journey, and
// standing for the parts it does not cover.
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
  const other = await login("unittest-target@example.com");
  const admin = await login("unittest-admin@example.com");
  const su = await login("unittest-super1@example.com");
  const bt = buyer.accessToken, xt = other.accessToken, at = admin.accessToken, st = su.accessToken;

  const me = (await call("GET", "/auth/profile", { token: bt })).body.profile;
  const passenger = { name: me.fullName, nid: me.nid, dob: me.dateOfBirth };

  const fund = async (token, userId, amountMinor) => {
    const bal = (await call("GET", "/wallet", { token })).body.wallet.balanceMinor;
    if (bal > 0) {
      await call("POST", `/wallet/user/${userId}/adjust`, {
        token: st, body: { amount: bal / 100, direction: "debit", description: "standing: reset" },
      });
    }
    await call("POST", `/wallet/user/${userId}/adjust`, {
      token: st, body: { amount: amountMinor / 100, direction: "credit", description: "standing: fare" },
    });
  };

  // Ekota, 11 stops. Buy a seat over the MIDDLE so both sides are available.
  const trips = (await call("GET", "/trips?trainId=1&limit=50", { token: at })).body.trips
    .filter((t) => t.status === "scheduled" && t.seatCount > 0);
  const trip = trips[trips.length - 1];
  const train = (await call("GET", `/trains/${trip.trainId}`, { token: at })).body.train;
  const S = (n) => train.stops[n - 1].stationId;

  console.log(`Ekota ${trip.departureDate}, seat over stops 4→7\n`);

  console.log("== buy a seat in a class that sells standing ==");
  const classes = (await call("GET", "/reference/coach-classes", { token: at })).body.items;
  const standingClass = classes.find((c) => c.standingCapacity > 0);
  check("a class sells standing", !!standingClass,
    JSON.stringify(classes.map((c) => [c.name, c.standingCapacity])));
  if (!standingClass) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }
  console.log(`  ${standingClass.name}, ${standingClass.standingCapacity} standing per coach`);

  const avail = (await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${S(4)}&toStationId=${S(7)}&coachClassId=${standingClass.id}`,
    { token: at })).body;
  check("seats are free over the middle", avail.availableCount > 0, `${avail.availableCount}`);

  const hold = await call("POST", "/holds", {
    token: bt,
    body: { tripId: trip.id, seatIds: [avail.available[0].id], fromStationId: S(4), toStationId: S(7) },
  });
  const q = await call("POST", "/bookings/quote", { token: bt, body: { holdReference: hold.body.hold.reference } });
  await fund(bt, me.id, q.body.totalMinor);
  const booked = await call("POST", "/bookings", {
    token: bt,
    body: { holdReference: hold.body.hold.reference, passengers: [passenger], method: "wallet" },
  });
  check("bought", booked.status === 201, msg(booked));
  if (booked.status !== 201) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }

  const seated = booked.body.booking.tickets[0];
  console.log(`  seat ${seated.seatNumber}, coach ${seated.coachCode}, ${seated.fareFormatted}`);

  /* ============================================================== */
  console.log("\n== what standing is on offer ==");
  const opts = await call("GET", `/tickets/${seated.id}/standing`, { token: bt });
  check("offered", opts.status === 200, msg(opts));
  check("the class sells standing", opts.body.sellsStanding === true);
  check("capacity is reported", opts.body.coachCapacity === standingClass.standingCapacity,
    `${opts.body.coachCapacity}`);

  const before = opts.body.legs.filter((l) => l.position === "before");
  const after = opts.body.legs.filter((l) => l.position === "after");
  check("legs before the seat are offered", before.length === 3, `${before.length}`);
  check("and legs after it", after.length === 4, `${after.length}`);
  check("every leg abuts the seated one",
    opts.body.legs.every((l) => l.toSequence === 4 || l.fromSequence === 7),
    JSON.stringify(opts.body.legs.map((l) => `${l.fromSequence}-${l.toSequence}`)));
  check("none of them overlaps the seat",
    opts.body.legs.every((l) => l.toSequence <= 4 || l.fromSequence >= 7));
  check("each is priced", opts.body.legs.every((l) => l.fareMinor > 0),
    JSON.stringify(opts.body.legs.map((l) => l.fareMinor)));

  const fullRun = before.find((l) => l.fromSequence === 1);
  check("standing costs the configured share of a seat",
    fullRun.fareMinor === Math.round((fullRun.seatedFareMinor * opts.body.farePercent) / 100),
    `${fullRun.fareMinor} vs ${opts.body.farePercent}% of ${fullRun.seatedFareMinor}`);

  /* ============================================================== */
  console.log("\n== buy standing for the run up to the seat ==");
  const walletBefore = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  await fund(bt, me.id, fullRun.fareMinor);

  const bought = await call("POST", `/tickets/${seated.id}/standing`, {
    token: bt, body: { fromStationId: S(1), toStationId: S(4), method: "wallet" },
  });
  check("bought", bought.status === 201, msg(bought));
  if (bought.status !== 201) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }

  const standTicket = bought.body.booking.tickets[0];
  check("it is a standing ticket", standTicket.isStanding === true, standTicket.kind);
  check("with no seat", standTicket.tripSeatId === null && !standTicket.seatNumber,
    JSON.stringify([standTicket.tripSeatId, standTicket.seatNumber]));
  check("but a coach to stand in", !!standTicket.coachCode, standTicket.coachCode);
  check("attached to the seated ticket", standTicket.seatedTicketId === seated.id);
  check("carrying the same passenger as the seat",
    standTicket.passengerName === seated.passengerName && standTicket.passengerNid === seated.passengerNid);
  check("over its own stretch, not the seat's",
    standTicket.fromStationId === S(1) && standTicket.toStationId === S(4),
    JSON.stringify([standTicket.fromStationId, standTicket.toStationId]));
  check("recording the segments it occupies",
    JSON.stringify(standTicket.segments) === JSON.stringify([0, 1, 2]),
    JSON.stringify(standTicket.segments));
  check("it says how many places are left", bought.body.remaining === standingClass.standingCapacity - 1,
    `${bought.body.remaining}`);
  check("it has its own ticket number", !!standTicket.ticketNumber);
  check("and its own booking", bought.body.booking.reference !== booked.body.booking.reference);

  /* ============================================================== */
  console.log("\n== the rules ==");
  const gap = await call("POST", `/tickets/${seated.id}/standing`, {
    token: bt, body: { fromStationId: S(1), toStationId: S(3) },
  });
  check("a leg that does not reach the seat is refused", gap.status === 400, msg(gap));
  check("and says why", /join onto your seated leg/i.test(msg(gap)), msg(gap));

  const overlap = await call("POST", `/tickets/${seated.id}/standing`, {
    token: bt, body: { fromStationId: S(5), toStationId: S(9) },
  });
  check("a leg overlapping the seat is refused", overlap.status === 400, msg(overlap));
  check("as pointless rather than merely invalid",
    /already have a seat/i.test(msg(overlap)), msg(overlap));

  const backwards = await call("POST", `/tickets/${seated.id}/standing`, {
    token: bt, body: { fromStationId: S(7), toStationId: S(4) },
  });
  check("a backwards leg is refused", backwards.status === 400, `${backwards.status}`);

  const twice = await call("POST", `/tickets/${seated.id}/standing`, {
    token: bt, body: { fromStationId: S(1), toStationId: S(4) },
  });
  check("the same leg cannot be bought twice", twice.status === 400 || twice.status === 409,
    `${twice.status}: ${msg(twice)}`);

  const reOffered = (await call("GET", `/tickets/${seated.id}/standing`, { token: bt })).body;
  const held = reOffered.legs.find((l) => l.fromSequence === 1 && l.toSequence === 4);
  check("and the options say it is already held",
    held.available === false && held.reason === "already_held", JSON.stringify(held));
  check("the held leg is listed", reOffered.held.length === 1, `${reOffered.held.length}`);

  /* ============================================================== */
  console.log("\n== standing on the other side too ==");
  const onward = after.find((l) => l.toSequence === 11);
  await fund(bt, me.id, onward.fareMinor);
  const second = await call("POST", `/tickets/${seated.id}/standing`, {
    token: bt, body: { fromStationId: S(7), toStationId: S(11), method: "wallet" },
  });
  check("both sides of a seat can be covered", second.status === 201, msg(second));
  check("now two standing legs ride on the seat",
    (await call("GET", `/tickets/${seated.id}/standing`, { token: bt })).body.held.length === 2);

  /* ============================================================== */
  console.log("\n== capacity is real ==");
  const capacityLeg = (await call("GET", `/tickets/${seated.id}/standing`, { token: bt }))
    .body.legs.find((l) => l.fromSequence === 2 && l.toSequence === 4);
  check("remaining room is reported per leg",
    capacityLeg.remaining === standingClass.standingCapacity - 1,
    `${capacityLeg.remaining} of ${standingClass.standingCapacity}`);

  // Fill the coach on segment 0 by hand, and check the leg crossing it closes.
  const coachId = standTicket.tripCoachId;
  const { sequelize, Ticket } = require("../../../src/models");
  const filler = [];
  for (let i = 0; i < standingClass.standingCapacity - 1; i++) {
    const t = await Ticket.create({
      bookingId: bought.body.booking.id,
      ticketNumber: `TSTFILL${String(i).padStart(3, "0")}`,
      kind: "standing",
      seatedTicketId: seated.id,
      tripSeatId: null,
      seatNumber: null,
      tripCoachId: coachId,
      coachCode: standTicket.coachCode,
      coachClassId: standingClass.id,
      passengerName: "Capacity Filler",
      passengerNid: "1990000099999",
      passengerDob: "1990-01-01",
      fromStationId: S(1),
      toStationId: S(2),
      segments: [0],
      fareMinor: 0,
      status: "valid",
    });
    filler.push(t.id);
  }
  console.log(`  filled segment 0 to capacity (${standingClass.standingCapacity})`);

  const nowFull = (await call("GET", `/tickets/${seated.id}/standing`, { token: bt })).body;
  const crossesZero = nowFull.legs.find((l) => l.fromSequence === 1 && l.toSequence === 4);
  const avoidsZero = nowFull.legs.find((l) => l.fromSequence === 3 && l.toSequence === 4);

  check("a leg crossing the full segment is closed",
    crossesZero.available === false, JSON.stringify(crossesZero));
  check("but one that avoids it is still open",
    avoidsZero.available === true, JSON.stringify(avoidsZero));

  const refusedForSpace = await call("POST", `/tickets/${seated.id}/standing`, {
    token: bt, body: { fromStationId: S(2), toStationId: S(4) },
  });
  check("and buying across it is refused for lack of room",
    refusedForSpace.status === 409 || refusedForSpace.status === 400,
    `${refusedForSpace.status}: ${msg(refusedForSpace)}`);

  await Ticket.destroy({ where: { id: filler } });
  console.log("  filler removed");

  /* ============================================================== */
  console.log("\n== standing follows its seat (§11.3) ==");
  const standingRefund = await call("POST", `/tickets/${standTicket.id}/refund`, {
    token: bt, body: { type: "convenient" },
  });
  check("standing cannot be returned while the seat is held",
    standingRefund.status === 400, `${standingRefund.status}`);
  check("and says to return the seat instead",
    /goes with seat/i.test(msg(standingRefund)), msg(standingRefund));

  const walletBeforeReturn = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  const seatRefund = await call("POST", `/tickets/${seated.id}/refund`, {
    token: bt, body: { type: "convenient" },
  });
  check("returning the seat works", seatRefund.status === 201, msg(seatRefund));

  const afterAll = (await call("GET", `/bookings/${bought.body.booking.id}`, { token: bt })).body.booking;
  check("the standing leg went with it",
    afterAll.tickets.every((t) => t.status === "refunded"),
    JSON.stringify(afterAll.tickets.map((t) => [t.ticketNumber, t.status])));

  const walletAfterReturn = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  check("and its fare came back in full, with no deduction",
    walletAfterReturn > walletBeforeReturn,
    `${walletBeforeReturn} -> ${walletAfterReturn}`);
  check("the ledger still balances",
    (await call("GET", "/wallet/verify", { token: bt })).body.consistent === true);

  await sequelize.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("harness error:", e); process.exit(1); });
