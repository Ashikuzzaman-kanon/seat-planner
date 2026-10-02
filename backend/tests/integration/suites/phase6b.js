// Per-departure return switches, money floors and caps, and what happens when
// the railway is the one who cancels.
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

const daysAhead = (d) => {
  const t = new Date();
  return Math.round(
    (new Date(`${d}T00:00:00Z`) - Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())) / 86400000
  );
};

const P = (n) => ({ name: `Cancel Passenger ${n}`, nid: `199033334444${n}`, dob: "1995-06-06" });

/** Buy `count` seats on the departure with the FEWEST seats, to keep the big
 *  fixtures free for other suites. */
async function buyOn(trip, { token, adminToken, superToken, userId, count = 1 }) {
  const train = (await call("GET", `/trains/${trip.trainId}`, { token: adminToken })).body.train;
  const A = train.stops[0].stationId;
  const C = train.stops[Math.min(2, train.stops.length - 1)].stationId;

  const held = await call("POST", "/holds/auto", {
    token, body: { tripId: trip.id, fromStationId: A, toStationId: C, count },
  });
  if (held.status !== 201) return null;

  const quote = await call("POST", "/bookings/quote", {
    token, body: { holdReference: held.body.hold.reference },
  });

  const balance = (await call("GET", "/wallet", { token })).body.wallet.balanceMinor;
  if (balance > 0) {
    await call("POST", `/wallet/user/${userId}/adjust`, {
      token: superToken, body: { amount: balance / 100, direction: "debit", description: "6B suite: reset" },
    });
  }
  await call("POST", `/wallet/user/${userId}/adjust`, {
    token: superToken,
    body: { amount: quote.body.totalMinor / 100, direction: "credit", description: "6B suite: fare" },
  });

  const booked = await call("POST", "/bookings", {
    token,
    body: {
      holdReference: held.body.hold.reference,
      passengers: Array.from({ length: count }, (_, i) => P(i + 1)),
      method: "wallet",
    },
  });
  return booked.status === 201 ? { booking: booked.body.booking, A, C, train } : null;
}

(async () => {
  const buyer = await login("unittest-user@example.com");
  const admin = await login("unittest-admin@example.com");
  const su = await login("unittest-super1@example.com");
  const bt = buyer.accessToken, at = admin.accessToken, st = su.accessToken;

  console.log("== who may switch a departure's returns ==");
  check("an admin may", admin.permissions.includes("refund:configure"));
  check("a passenger may not", !buyer.permissions.includes("refund:configure"));

  const trips = (await call("GET", "/trips?limit=500", { token: at })).body.trips;
  const usable = trips
    .filter((t) => t.status === "scheduled" && t.seatCount > 10 && daysAhead(t.departureDate) >= 4)
    .sort((a, b) => a.seatCount - b.seatCount);

  check("found departures to work with", usable.length >= 2, `${usable.length}`);
  if (usable.length < 2) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }

  const switchTrip = usable[0];
  console.log(`  using ${switchTrip.train.name} on ${switchTrip.departureDate}`);

  console.log("\n== both returns are offered by default ==");
  const fresh = (await call("GET", `/trips/${switchTrip.id}`, { token: at })).body.trip;
  check("convenient is on", fresh.convenientReturnEnabled === true);
  check("demand is on", fresh.demandReturnEnabled === true);

  const bought = await buyOn(switchTrip, {
    token: bt, adminToken: at, superToken: st, userId: buyer.user.id,
  });
  check("bought a ticket on it", !!bought, "could not buy");
  if (!bought) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }
  const ticket = bought.booking.tickets[0];

  const bothOffered = (await call("GET", `/tickets/${ticket.id}/refund-quote`, { token: bt })).body;
  check("and the quote offers both", bothOffered.options.every((o) => o.ok),
    JSON.stringify(bothOffered.options.map((o) => [o.type, o.ok, o.reason])));

  console.log("\n== turning one off ==");
  const passengerTries = await call("PATCH", `/trips/${switchTrip.id}/refund-options`, {
    token: bt, body: { demand: false },
  });
  check("a passenger cannot switch it", passengerTries.status === 403, `${passengerTries.status}`);

  const off = await call("PATCH", `/trips/${switchTrip.id}/refund-options`, {
    token: at, body: { demand: false },
  });
  check("an admin can", off.status === 200, msg(off));
  check("the switch is recorded", off.body.trip.demandReturnEnabled === false);
  check("the other is untouched", off.body.trip.convenientReturnEnabled === true);
  check("the message says what is offered", /convenient/.test(off.body.message), off.body.message);

  const oneOffered = (await call("GET", `/tickets/${ticket.id}/refund-quote`, { token: bt })).body;
  const demOff = oneOffered.options.find((o) => o.type === "demand");
  const convOn = oneOffered.options.find((o) => o.type === "convenient");

  check("the demand option is refused", demOff.ok === false);
  check("and says it is switched off, not that it is impossible",
    demOff.reason === "disabled", demOff.reason);
  check("with a message a passenger can read", /not offered on this departure/.test(demOff.message),
    demOff.message);
  check("but it is still listed rather than silently dropped",
    oneOffered.options.length === 2, `${oneOffered.options.length} options`);
  check("the convenient option still works", convOn.ok === true);

  const refused = await call("POST", `/tickets/${ticket.id}/refund`, {
    token: bt, body: { type: "demand" },
  });
  check("asking for the switched-off one is refused", refused.status === 400, msg(refused));

  console.log("\n== turning both off ==");
  await call("PATCH", `/trips/${switchTrip.id}/refund-options`, {
    token: at, body: { convenient: false, demand: false },
  });
  const noneOffered = (await call("GET", `/tickets/${ticket.id}/refund-quote`, { token: bt })).body;
  check("neither is available", noneOffered.options.every((o) => !o.ok),
    JSON.stringify(noneOffered.options.map((o) => [o.type, o.ok])));

  // Put them back so the fixture is as it was found.
  await call("PATCH", `/trips/${switchTrip.id}/refund-options`, {
    token: at, body: { convenient: true, demand: true },
  });
  const restored = (await call("GET", `/trips/${switchTrip.id}`, { token: at })).body.trip;
  check("both switch back on", restored.convenientReturnEnabled && restored.demandReturnEnabled);

  console.log("\n== a disruption refund cannot be asked for ==");
  const sneaky = await call("POST", `/tickets/${ticket.id}/refund`, {
    token: bt, body: { type: "disruption" },
  });
  check("refused by validation before it reaches the policy",
    sneaky.status === 400, `${sneaky.status}: ${msg(sneaky)}`);

  console.log("\n== the railway cancels ==");
  // A departure of its own, so cancelling it disturbs nothing else.
  const cancelTrip = usable.find((t) => t.id !== switchTrip.id);
  const onboard = await buyOn(cancelTrip, {
    token: bt, adminToken: at, superToken: st, userId: buyer.user.id, count: 2,
  });
  check("two tickets sold on the departure to be cancelled", onboard?.booking?.tickets?.length === 2,
    JSON.stringify(onboard?.booking?.ticketCount));
  if (!onboard) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }

  const paid = onboard.booking.totalMinor;
  const walletBefore = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;

  const cancelled = await call("POST", `/trips/${cancelTrip.id}/cancel`, {
    token: at, body: { reason: "Cyclone warning" },
  });
  check("cancelled", cancelled.status === 200, msg(cancelled));
  check("it reports what it refunded", cancelled.body.trip.refunds?.refunded === 2,
    JSON.stringify(cancelled.body.trip.refunds));
  check("paying the full fare, nothing deducted",
    cancelled.body.trip.refunds.paidMinor === paid,
    `refunded ${cancelled.body.trip.refunds.paidMinor} of ${paid} paid`);

  const walletAfter = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  check("the passenger got every poisha back", walletAfter === walletBefore + paid,
    `${walletBefore} + ${paid} != ${walletAfter}`);
  check("the ledger balances",
    (await call("GET", "/wallet/verify", { token: bt })).body.consistent === true);

  const afterBooking = (await call("GET", `/bookings/${onboard.booking.id}`, { token: bt })).body.booking;
  check("both tickets read as refunded",
    afterBooking.tickets.every((t) => t.status === "refunded"),
    JSON.stringify(afterBooking.tickets.map((t) => t.status)));
  check("and the booking with them", afterBooking.status === "refunded", afterBooking.status);

  const refunds = (await call("GET", "/refunds", { token: bt })).body.refunds;
  const disruptionRefunds = refunds.filter((r) => r.type === "disruption");
  check("recorded as disruption refunds", disruptionRefunds.length >= 2, `${disruptionRefunds.length}`);
  check("with a zero deduction", disruptionRefunds.every((r) => r.deductionPercent === 0));
  check("settled outright", disruptionRefunds.every((r) => r.status === "settled"));
  check("naming why", disruptionRefunds.some((r) => /Cyclone/.test(r.note || "")),
    JSON.stringify(disruptionRefunds.map((r) => r.note)));

  console.log("\n== cancelling twice pays nobody twice ==");
  const again = await call("POST", `/trips/${cancelTrip.id}/cancel`, {
    token: at, body: { reason: "again" },
  });
  check("the second cancel is refused", again.status === 400, `${again.status}`);
  check("and the balance has not moved",
    (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor === walletAfter);

  console.log("\n== reinstating says what it cannot undo ==");
  const back = await call("POST", `/trips/${cancelTrip.id}/reinstate`, {
    token: at, body: { reason: "Cyclone passed" },
  });
  check("it runs again", back.status === 200 && back.body.trip.status === "scheduled", msg(back));
  check("and reports the refunds that do not come back",
    back.body.trip.refundedOnCancellation >= 2,
    JSON.stringify(back.body.trip.refundedOnCancellation));
  check("the money stayed with the passenger",
    (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor === walletAfter);

  const seatsBack = (await call("GET",
    `/trips/${cancelTrip.id}/availability?fromStationId=${onboard.A}&toStationId=${onboard.C}`,
    { token: at })).body;
  check("the seats are on sale again", seatsBack.availableCount > 0, `${seatsBack.availableCount}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
