// The five improvements, each tested against the behaviour that was reported.
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
const addDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

const DHAKA = 1, SETU = 5, DINAJPUR = 15;

(async () => {
  const buyer = await login("unittest-user@example.com");
  const other = await login("unittest-target@example.com");
  const admin = await login("unittest-admin@example.com");
  const su = await login("unittest-super1@example.com");
  const bt = buyer.accessToken, xt = other.accessToken, at = admin.accessToken, st = su.accessToken;

  /* ============================================================== */
  console.log("== 1. Profile ==");

  const profile = await call("GET", "/auth/profile", { token: bt });
  check("an account has a profile", profile.status === 200, msg(profile));
  check("it reports whether it is complete",
    typeof profile.body.profile.hasTravelProfile === "boolean");

  const badNid = await call("PUT", "/auth/profile", {
    token: bt, body: { fullName: "Unit Test User", nid: "123", dateOfBirth: "1990-05-14" },
  });
  check("a short National ID is refused", badNid.status === 400, `${badNid.status}`);

  const futureDob = await call("PUT", "/auth/profile", {
    token: bt, body: { fullName: "Unit Test User", nid: "1990123456789", dateOfBirth: "2099-01-01" },
  });
  check("a birth date in the future is refused", futureDob.status === 400, `${futureDob.status}`);

  const saved = await call("PUT", "/auth/profile", {
    token: bt, body: { fullName: "Unit Test User", nid: "1990123456789", dateOfBirth: "1990-05-14" },
  });
  check("a complete profile saves", saved.status === 200, msg(saved));
  check("and now reads as ready", saved.body.profile.hasTravelProfile === true);
  check("carrying the details the checkout reuses",
    saved.body.profile.nid === "1990123456789" && saved.body.profile.dateOfBirth === "1990-05-14",
    JSON.stringify(saved.body.profile));

  // The second buyer needs one too, for the resale later on.
  await call("PUT", "/auth/profile", {
    token: xt, body: { fullName: "Unit Test Target", nid: "1991987654321", dateOfBirth: "1991-03-03" },
  });

  /* ============================================================== */
  console.log("\n== 2. A reservation that would do nothing is refused ==");

  const trips = (await call("GET", "/trips?trainId=1&limit=50", { token: at })).body.trips
    .filter((t) => t.status === "scheduled" && t.seatCount > 0);
  const near = trips[0];
  const far = trips[trips.length - 1];

  const seatsNear = (await call("GET", `/trips/${near.id}/seats`, { token: at })).body.seats;
  const seatNear = seatsNear[50];
  await call("DELETE", `/trips/${near.id}/seats/${seatNear.id}/quota`, { token: at });

  const inert = await call("PUT", `/trips/${near.id}/seats/${seatNear.id}/quota`, {
    token: at, body: { fromStationId: DHAKA, toStationId: SETU, releaseHoursBefore: 24 },
  });
  check("a hold released before the train even leaves is refused", inert.status === 400,
    `${inert.status}`);
  check("and says why, with the numbers in it",
    /release time|hold nothing/i.test(msg(inert)), msg(inert));

  const seatsFar = (await call("GET", `/trips/${far.id}/seats`, { token: at })).body.seats;
  const seatFar = seatsFar[50];
  await call("DELETE", `/trips/${far.id}/seats/${seatFar.id}/quota`, { token: at });

  const beforeHold = (await call("GET",
    `/trips/${far.id}/availability?fromStationId=${DHAKA}&toStationId=${SETU}`, { token: at })).body;
  const held = await call("PUT", `/trips/${far.id}/seats/${seatFar.id}/quota`, {
    token: at, body: { fromStationId: DHAKA, toStationId: DINAJPUR, releaseHoursBefore: 24 },
  });
  check("a hold that will actually bite is accepted", held.status === 200, msg(held));

  const afterHold = (await call("GET",
    `/trips/${far.id}/availability?fromStationId=${DHAKA}&toStationId=${SETU}`, { token: at })).body;
  check("and the count moves straight away",
    afterHold.availableCount === beforeHold.availableCount - 1,
    `${beforeHold.availableCount} -> ${afterHold.availableCount}`);

  const matrix = (await call("GET", `/trips/${far.id}/availability/matrix`, { token: at })).body;
  const pair = matrix.pairs.find((p) => p.fromStationId === DHAKA && p.toStationId === SETU);
  check("the matrix moves with it", pair.available === afterHold.availableCount,
    `matrix ${pair.available} vs availability ${afterHold.availableCount}`);

  await call("DELETE", `/trips/${far.id}/seats/${seatFar.id}/quota`, { token: at });

  /* ============================================================== */
  console.log("\n== 3. The matrix a passenger can see ==");

  const pm = await call("GET", `/search/departures/${far.id}/matrix`, { token: bt });
  check("served to a passenger", pm.status === 200, msg(pm));
  check("every stop pair is there", pm.body.pairs.length > 0, `${pm.body.pairs?.length}`);
  check("named, not numbered", pm.body.pairs.every((p) => p.fromStation && p.toStation),
    JSON.stringify(pm.body.pairs[0]));
  check("with seats free and total", pm.body.pairs.every((p) =>
    typeof p.available === "number" && typeof p.total === "number"));
  check("and none of the operator's detail",
    pm.body.pairs.every((p) => p.withheld === undefined && p.quota === undefined));

  /* ============================================================== */
  console.log("\n== 4. An overnight train is found on the day you board ==");

  // Setu is reached after midnight, so the trip is filed under the day before.
  const boardDay = addDays(far.departureDate, 1);

  const onBoardDay = await call("GET",
    `/search/departures?fromStationId=${SETU}&toStationId=${DINAJPUR}&date=${boardDay}`, { token: bt });
  check("searching the day you actually travel finds it",
    onBoardDay.body.departures?.some((d) => d.tripId === far.id),
    `looked for trip ${far.id} on ${boardDay}, got ${JSON.stringify(onBoardDay.body.departures?.map((d) => d.tripId))}`);

  const found = onBoardDay.body.departures.find((d) => d.tripId === far.id);
  check("and the boarding date shown is that day", found.from.date === boardDay,
    `${found.from.date} vs ${boardDay}`);
  check("while the trip is still filed under the day it left its origin",
    found.departureDate === far.departureDate, `${found.departureDate}`);

  const onFileDay = await call("GET",
    `/search/departures?fromStationId=${SETU}&toStationId=${DINAJPUR}&date=${far.departureDate}`,
    { token: bt });
  check("searching the filing date no longer offers a boarding time that has not happened",
    !onFileDay.body.departures?.some((d) => d.tripId === far.id),
    `trip ${far.id} still appears on ${far.departureDate}`);

  const fromOrigin = await call("GET",
    `/search/departures?fromStationId=${DHAKA}&toStationId=${DINAJPUR}&date=${far.departureDate}`,
    { token: bt });
  const originRow = fromOrigin.body.departures?.find((d) => d.tripId === far.id);
  check("boarding at the origin is unchanged", !!originRow, `trip ${far.id} on ${far.departureDate}`);
  check("and it says it arrives the next day", originRow.to.dayOffset === 1,
    `dayOffset ${originRow?.to?.dayOffset}`);
  check("naming both dates", originRow.from.date === far.departureDate && originRow.to.date === boardDay,
    JSON.stringify([originRow.from.date, originRow.to.date]));

  /* ============================================================== */
  console.log("\n== 5. A longer resale settles every returned segment ==");

  const fund = async (token, userId, amountMinor) => {
    const bal = (await call("GET", "/wallet", { token })).body.wallet.balanceMinor;
    if (bal > 0) {
      await call("POST", `/wallet/user/${userId}/adjust`, {
        token: st, body: { amount: bal / 100, direction: "debit", description: "improve: reset" },
      });
    }
    await call("POST", `/wallet/user/${userId}/adjust`, {
      token: st, body: { amount: amountMinor / 100, direction: "credit", description: "improve: fare" },
    });
  };

  const avail = (await call("GET",
    `/trips/${far.id}/availability?fromStationId=${DHAKA}&toStationId=${SETU}`, { token: at })).body;
  const seat = avail.available[0];

  const hold = await call("POST", "/holds", {
    token: bt, body: { tripId: far.id, seatIds: [seat.id], fromStationId: DHAKA, toStationId: SETU },
  });
  const q1 = await call("POST", "/bookings/quote", { token: bt, body: { holdReference: hold.body.hold.reference } });
  await fund(bt, buyer.user.id, q1.body.totalMinor);

  const bought = await call("POST", "/bookings", {
    token: bt,
    body: {
      holdReference: hold.body.hold.reference,
      passengers: [{ name: "Unit Test User", nid: "1990123456789", dob: "1990-05-14" }],
      method: "wallet",
    },
  });
  check("bought Dhaka->Setu", bought.status === 201, msg(bought));
  const ticket = bought.body.booking.tickets[0];

  const returned = await call("POST", `/tickets/${ticket.id}/refund`, {
    token: bt, body: { type: "demand" },
  });
  check("returned on the demand rule", returned.status === 201, msg(returned));
  const refund = returned.body.refund;
  const ceiling = refund.maximumMinor;
  check("three segments are being watched", refund.segments.length === 3, `${refund.segments.length}`);
  check("nothing paid yet", refund.refundedMinor === 0);

  const walletBefore = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;

  // Someone buys the SAME seat over a LONGER stretch that contains all three.
  const hold2 = await call("POST", "/holds", {
    token: xt, body: { tripId: far.id, seatIds: [seat.id], fromStationId: DHAKA, toStationId: DINAJPUR },
  });
  check("the seat is re-sellable over a longer journey", hold2.status === 201, msg(hold2));
  const q2 = await call("POST", "/bookings/quote", { token: xt, body: { holdReference: hold2.body.hold.reference } });
  await fund(xt, other.user.id, q2.body.totalMinor);

  const resold = await call("POST", "/bookings", {
    token: xt,
    body: {
      holdReference: hold2.body.hold.reference,
      passengers: [{ name: "Unit Test Target", nid: "1991987654321", dob: "1991-03-03" }],
      method: "wallet",
    },
  });
  check("resold Dhaka->Dinajpur", resold.status === 201, msg(resold));

  const settled = (await call("GET", `/refunds/${refund.reference}`, { token: bt })).body.refund;
  check("all three segments settled at once",
    settled.segments.filter((s) => s.isResold).length === 3,
    JSON.stringify(settled.segments.map((s) => s.isResold)));
  check("the refund is fully paid", settled.status === "settled", settled.status);
  check("paying the fare less the processing charge",
    settled.refundedMinor === ceiling, `${settled.refundedMinor} vs ceiling ${ceiling}`);
  check("which is the whole fare minus 10%",
    settled.refundedMinor === settled.fareMinor - Math.round(settled.fareMinor * 0.1),
    `fare ${settled.fareMinor}, refunded ${settled.refundedMinor}`);

  const walletAfter = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  check("and the money arrived", walletAfter === walletBefore + ceiling,
    `${walletBefore} + ${ceiling} != ${walletAfter}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("harness error:", e); process.exit(1); });
