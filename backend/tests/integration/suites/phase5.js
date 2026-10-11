// Phase 5A — wallet ledger, seat holds, and the atomic booking transaction.
//
// Re-runnable: it drains the wallet it tops up and only ever holds spare seats,
// so a second run starts from the same place the first one did.
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

const PASSENGER = (n) => ({ name: `Test Passenger ${n}`, nid: `199012345678${n}`, dob: "1990-05-14" });

(async () => {
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }

  const buyer = await login("unittest-user@example.com");
  const stranger = await login("unittest-target@example.com");
  const admin = await login("unittest-admin@example.com");
  const su = await login("unittest-super1@example.com");
  const bt = buyer.accessToken, xt = stranger.accessToken, at = admin.accessToken, st = su.accessToken;

  console.log("\n== who may buy, and who may only look ==");
  check("the default role can buy", buyer.permissions.includes("booking:create"),
    JSON.stringify(buyer.permissions));
  check("the admin role oversees sales without being able to buy",
    admin.permissions.includes("booking:view_all") && !admin.permissions.includes("booking:create"),
    JSON.stringify(admin.permissions.filter((p) => p.startsWith("booking"))));
  check("hand-adjusting a wallet is not an admin power",
    !admin.permissions.includes("wallet:adjust"));

  console.log("\n== wallet ledger ==");
  const w = await call("GET", "/wallet", { token: bt });
  check("every user has a wallet", w.status === 200 && typeof w.body.wallet.balanceMinor === "number",
    JSON.stringify(w.body));
  const opening = w.body.wallet.balanceMinor;

  const small = await call("POST", "/wallet/topup", { token: bt, body: { amount: 1 } });
  check("a top-up below the minimum is refused", small.status === 400, `got ${small.status}`);

  const top = await call("POST", "/wallet/topup", { token: bt, body: { amount: 5000 } });
  check("top-up accepted", top.status === 200, JSON.stringify(top.body?.message || top.body));
  check("the balance moved by exactly the amount",
    top.body.wallet.balanceMinor === opening + 500000,
    `${opening} -> ${top.body.wallet.balanceMinor}`);
  check("the entry records the balance it produced",
    top.body.transaction.balanceAfterMinor === top.body.wallet.balanceMinor,
    `${top.body.transaction.balanceAfterMinor} vs ${top.body.wallet.balanceMinor}`);

  const huge = await call("POST", "/wallet/topup", { token: bt, body: { amount: 999999 } });
  check("the balance cap is enforced", huge.status === 400, `got ${huge.status}`);

  const verified = await call("GET", "/wallet/verify", { token: bt });
  check("the cached balance matches a re-sum of the ledger", verified.body.consistent === true,
    JSON.stringify(verified.body));

  check("a passenger cannot read someone else's wallet",
    (await call("GET", `/wallet/user/${buyer.user.id}`, { token: bt })).status === 403);
  check("an overseer can",
    (await call("GET", `/wallet/user/${buyer.user.id}`, { token: at })).status === 200);

  console.log("\n== picking a departure to sell ==");
  const trips = (await call("GET", "/trips?limit=500", { token: at })).body.trips;
  const candidates = trips
    .filter((t) => t.status === "scheduled" && t.seatCount > 20 && daysAhead(t.departureDate) >= 2)
    .sort((a, b) => b.seatCount - a.seatCount);

  let trip = null, train = null;
  for (const c of candidates) {
    const detail = (await call("GET", `/trains/${c.trainId}`, { token: at })).body.train;
    if (detail?.stops?.length >= 4) { trip = c; train = detail; break; }
  }
  check("found a departure with seats and at least four stops", !!trip, "none available");
  if (!trip) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }
  console.log(`  using ${train.name} on ${trip.departureDate} (${trip.seatCount} seats, ${train.stops.length} stops)`);

  const A = train.stops[0].stationId;
  const C = train.stops[2].stationId;
  const D = train.stops[3].stationId;

  console.log("\n== holds ==");
  const before = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${C}`, { token: at });
  const availableBefore = before.body.availableCount;
  const seatIds = before.body.available.slice(0, 2).map((s) => s.id);

  /*
   * What the seat already carried beyond this journey, before we touch it.
   *
   * These departures are sold across by every suite, so a seat free from A to C
   * may well be sold on later stretches already. "Nothing beyond the journey
   * was taken" has to mean *by this purchase* — so it is checked against this,
   * not against an empty seat that no longer exists after months of runs.
   */
  const timelineBefore = (
    await call("GET", `/trips/${trip.id}/seats/${seatIds[0]}/timeline`, { token: at })
  ).body;

  const hold = await call("POST", "/holds", {
    token: bt, body: { tripId: trip.id, seatIds, fromStationId: A, toStationId: C },
  });
  check("hold created", hold.status === 201, JSON.stringify(hold.body));
  if (hold.status !== 201) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }
  check("it has a countdown", hold.body.hold.secondsRemaining > 0, JSON.stringify(hold.body.hold));

  const during = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${C}`, { token: at });
  check("held seats leave availability immediately",
    during.body.availableCount === availableBefore - 2,
    `${availableBefore} -> ${during.body.availableCount}`);

  const clash = await call("POST", "/holds", {
    token: bt, body: { tripId: trip.id, seatIds, fromStationId: A, toStationId: C },
  });
  check("the same seats cannot be held twice", clash.status === 409, `got ${clash.status}`);

  const tooMany = await call("POST", "/holds", {
    token: bt,
    body: {
      tripId: trip.id,
      seatIds: before.body.available.slice(5, 12).map((s) => s.id),
      fromStationId: A, toStationId: C,
    },
  });
  check("more than four seats together is refused", tooMany.status === 400, `got ${tooMany.status}`);

  const ref = hold.body.hold.reference;
  const notMine = await call("GET", `/holds/${ref}`, { token: xt });
  check("a checkout is private to whoever opened it", notMine.status === 403, `got ${notMine.status}`);

  console.log("\n== quote ==");
  const quote = await call("POST", "/bookings/quote", { token: bt, body: { holdReference: ref } });
  check("quoted", quote.status === 200, JSON.stringify(quote.body));
  if (quote.status !== 200) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }
  check("one line per seat", quote.body.lines.length === 2, `${quote.body.lines.length}`);
  check("the total is the exact sum of the lines",
    quote.body.totalMinor === quote.body.lines.reduce((n, l) => n + l.fareMinor, 0),
    `${quote.body.totalMinor}`);
  check("each line explains how its fare was reached",
    quote.body.lines.every((l) => l.explanation), JSON.stringify(quote.body.lines[0]));
  check("payment options are offered", Array.isArray(quote.body.payment?.options));

  console.log("\n== passenger validation ==");
  const badNid = await call("POST", "/bookings", {
    token: bt,
    body: { holdReference: ref, passengers: [{ ...PASSENGER(1), nid: "123" }, PASSENGER(2)] },
  });
  check("a short NID is refused", badNid.status === 400, `got ${badNid.status}`);

  const unborn = await call("POST", "/bookings", {
    token: bt,
    body: { holdReference: ref, passengers: [{ ...PASSENGER(1), dob: "2099-01-01" }, PASSENGER(2)] },
  });
  check("a date of birth in the future is refused", unborn.status === 400, `got ${unborn.status}`);

  const wrongCount = await call("POST", "/bookings", {
    token: bt, body: { holdReference: ref, passengers: [PASSENGER(1)] },
  });
  check("one passenger per seat is required", wrongCount.status === 400, `got ${wrongCount.status}`);

  console.log("\n== a declined payment leaves nothing behind ==");
  const walletBefore = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  const bookingsBefore = (await call("GET", "/bookings", { token: bt })).body.pagination.total;

  const declined = await call("POST", "/bookings", {
    token: bt,
    body: {
      holdReference: ref,
      passengers: [PASSENGER(1), PASSENGER(2)],
      method: "gateway",
      gatewayToken: "fail",
    },
  });
  check("the purchase is refused", declined.status === 400, `got ${declined.status}`);

  const walletAfter = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  check("no money moved", walletAfter === walletBefore, `${walletBefore} -> ${walletAfter}`);
  check("no booking was written",
    (await call("GET", "/bookings", { token: bt })).body.pagination.total === bookingsBefore,
    "a booking survived a declined payment");
  check("no ledger entry was written either",
    (await call("GET", "/wallet/verify", { token: bt })).body.entries === verified.body.entries,
    "an entry exists for a payment that failed");

  const stillHeld = await call("GET", `/holds/${ref}`, { token: bt });
  check("the hold survived, so the passenger can retry", stillHeld.body.hold.isLive === true,
    JSON.stringify(stillHeld.body.hold?.status));

  const seatsStillGone = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${C}`, { token: at });
  check("and the seats are still theirs", seatsStillGone.body.availableCount === availableBefore - 2,
    `${seatsStillGone.body.availableCount}`);

  console.log("\n== paying from the wallet ==");
  const booked = await call("POST", "/bookings", {
    token: bt,
    body: { holdReference: ref, passengers: [PASSENGER(1), PASSENGER(2)], method: "wallet" },
  });
  check("booking confirmed", booked.status === 201, JSON.stringify(booked.body?.message || booked.body));
  if (booked.status !== 201) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }

  const booking = booked.body.booking;
  check("it has a short readable reference", /^[A-Z0-9]{6}$/.test(booking.reference), booking.reference);
  check("two tickets issued", booking.tickets.length === 2);
  check("each ticket has its own number",
    new Set(booking.tickets.map((t) => t.ticketNumber)).size === 2,
    JSON.stringify(booking.tickets.map((t) => t.ticketNumber)));
  check("passenger identity sits on the ticket, not the booking",
    booking.tickets.every((t) => t.passengerName && t.passengerNid && t.passengerDob));
  check("ticket fares add up to the booking total",
    booking.tickets.reduce((n, t) => n + t.fareMinor, 0) === quote.body.totalMinor,
    `${booking.tickets.reduce((n, t) => n + t.fareMinor, 0)} vs ${quote.body.totalMinor}`);
  check("one payment row, from the wallet",
    booking.payments.length === 1 && booking.payments[0].provider === "wallet",
    JSON.stringify(booking.payments));

  const paidWallet = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  /*
   * Checked on the ledger row, not the balance.
   *
   * Every suite buys as the same account, so buying a seat that an earlier suite
   * returned under the demand policy correctly pays that return out — into this
   * same wallet, mid-purchase. The balance then moves by the fare *and* by
   * somebody else's refund. The purchase debit is the thing this line claims
   * something about, and it is its own row.
   */
  const ledger = (await call("GET", "/wallet/transactions?limit=10", { token: bt })).body;
  const rows = ledger.transactions || ledger.items || [];
  const purchase = rows.find((r) => r.direction === "debit" && r.reason === "booking");
  check("the wallet was debited by exactly the total",
    purchase?.amountMinor === quote.body.totalMinor,
    `purchase debit ${purchase?.amountMinor} vs total ${quote.body.totalMinor}` +
      ` (balance ${walletBefore} -> ${paidWallet})`);

  check("the ledger still balances after a purchase",
    (await call("GET", "/wallet/verify", { token: bt })).body.consistent === true);

  console.log("\n== the seats are now sold, not held ==");
  const after = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${C}`, { token: at });
  check("still two fewer seats on that stretch", after.body.availableCount === availableBefore - 2,
    `${after.body.availableCount} vs ${availableBefore - 2}`);

  const timeline = (await call("GET", `/trips/${trip.id}/seats/${seatIds[0]}/timeline`, { token: at })).body;
  check("the seat's first two segments now belong to a ticket",
    timeline.segments.slice(0, 2).every((s) => s.occupiedBy === "ticket"),
    JSON.stringify(timeline.segments.map((s) => s.occupiedBy)));
  check("and nothing beyond the journey was taken by this purchase",
    timeline.segments
      .slice(2)
      .every((s, i) => s.occupiedBy === timelineBefore.segments[i + 2]?.occupiedBy),
    JSON.stringify({
      before: timelineBefore.segments.map((s) => s.occupiedBy),
      after: timeline.segments.map((s) => s.occupiedBy),
    }));

  check("the hold is marked converted",
    (await call("GET", `/holds/${ref}`, { token: bt })).body.hold.status === "converted");

  console.log("\n== segment inventory still holds ==");
  const laterLeg = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${C}&toStationId=${D}`, { token: at });
  check("a seat sold A-C is still on sale C-D",
    laterLeg.body.available.some((s) => s.id === seatIds[0]),
    "a sale on one stretch wrongly removed the seat from another");

  console.log("\n== split payment ==");
  const hold2 = await call("POST", "/holds", {
    token: bt, body: { tripId: trip.id, seatIds: [seatIds[0]], fromStationId: C, toStationId: D },
  });
  check("the same seat can be held again for a later stretch", hold2.status === 201,
    JSON.stringify(hold2.body));
  if (hold2.status !== 201) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }

  const ref2 = hold2.body.hold.reference;
  const quote2 = await call("POST", "/bookings/quote", { token: bt, body: { holdReference: ref2 } });

  // Leave the wallet just short of the fare, so a split is the only way through.
  const balNow = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  if (balNow > 0) {
    await call("POST", `/wallet/user/${buyer.user.id}/adjust`, {
      token: st,
      body: { amount: balNow / 100, direction: "debit", description: "Phase 5 suite: empty the wallet" },
    });
  }
  const partial = Math.max(100, Math.floor(quote2.body.totalMinor / 2));
  const credited = await call("POST", `/wallet/user/${buyer.user.id}/adjust`, {
    token: st,
    body: { amount: partial / 100, direction: "credit", description: "Phase 5 suite: part of one fare" },
  });
  check("a super admin can set a balance up by hand", credited.status === 200,
    JSON.stringify(credited.body?.message || credited.body));
  check("an admin cannot",
    (await call("POST", `/wallet/user/${buyer.user.id}/adjust`, {
      token: at, body: { amount: 10, direction: "credit", description: "should be refused" },
    })).status === 403);

  const walletOnly = await call("POST", "/bookings", {
    token: bt, body: { holdReference: ref2, passengers: [PASSENGER(3)], method: "wallet" },
  });
  check("wallet-only is refused when it cannot cover the fare", walletOnly.status === 400,
    `got ${walletOnly.status}: ${walletOnly.body?.message}`);

  // What the wallet held at the moment of the split — the whole of which should
  // be spent first, whatever arrived in it beforehand.
  const heldBeforeSplit = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;

  const split = await call("POST", "/bookings", {
    token: bt, body: { holdReference: ref2, passengers: [PASSENGER(3)], method: "split" },
  });
  check("splitting across wallet and card succeeds", split.status === 201,
    JSON.stringify(split.body?.message || split.body));
  if (split.status === 201) {
    check("two payment rows", split.body.booking.payments.length === 2,
      JSON.stringify(split.body.booking.payments.map((p) => p.provider)));
    check("they add to the fare exactly",
      split.body.booking.payments.reduce((n, p) => n + p.amountMinor, 0) === quote2.body.totalMinor,
      `vs ${quote2.body.totalMinor}`);
    // The property is "the wallet went in first, all of it" — the wallet row is
    // the whole balance it had, and the card covered only the rest.
    const walletPart = split.body.booking.payments.find((p) => p.provider === "wallet");
    check("the wallet went in first, all of it",
      walletPart?.amountMinor === heldBeforeSplit,
      `wallet paid ${walletPart?.amountMinor} of ${heldBeforeSplit} it held`);
    check("the ledger balances after a split",
      (await call("GET", "/wallet/verify", { token: bt })).body.consistent === true);
  }

  console.log("\n== looking a booking up ==");
  const byRef = await call("GET", `/bookings/reference/${booking.reference}`, { token: bt });
  check("found by reference", byRef.status === 200 && byRef.body.booking.id === booking.id,
    `got ${byRef.status}`);

  const nosy = await call("GET", `/bookings/${booking.id}`, { token: xt });
  check("another passenger is told it does not exist", nosy.status === 404, `got ${nosy.status}`);

  const staff = await call("GET", `/bookings/${booking.id}`, { token: at });
  check("an overseer who cannot buy can still read it", staff.status === 200, `got ${staff.status}`);

  const everyones = await call("GET", "/bookings?all=1", { token: at });
  check("and can list everyone's", everyones.status === 200 && everyones.body.pagination.total >= 2,
    JSON.stringify(everyones.body?.pagination));

  const mineOnly = await call("GET", "/bookings", { token: xt });
  check("a passenger's list is only their own",
    mineOnly.body.bookings.every((b) => b.userId === stranger.user.id),
    JSON.stringify(mineOnly.body.bookings.map((b) => b.userId)));

  console.log("\n== releasing a hold puts the seats back ==");
  const spare = (await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${C}`, { token: at })).body;
  const hold3 = await call("POST", "/holds", {
    token: bt,
    body: { tripId: trip.id, seatIds: [spare.available[0].id], fromStationId: A, toStationId: C },
  });
  check("held", hold3.status === 201, JSON.stringify(hold3.body));
  const released = await call("DELETE", `/holds/${hold3.body.hold.reference}`, { token: bt });
  check("released", released.status === 200, JSON.stringify(released.body));
  check("the segments were freed, not just the flag", released.body.released > 0,
    JSON.stringify(released.body));
  const restored = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${C}`, { token: at });
  check("the seat is back on sale", restored.body.availableCount === spare.availableCount,
    `${spare.availableCount} -> ${restored.body.availableCount}`);
  check("releasing twice is harmless",
    (await call("DELETE", `/holds/${hold3.body.hold.reference}`, { token: bt })).status === 200);

  console.log("\n== jobs ==");
  const jobs = (await call("GET", "/trips/jobs", { token: at })).body.jobs;
  check("the hold-expiry job is registered and runs on its own",
    jobs.some((j) => j.name === "hold.expire" && j.everyMinutes === 1),
    JSON.stringify(jobs.map((j) => j.name)));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
