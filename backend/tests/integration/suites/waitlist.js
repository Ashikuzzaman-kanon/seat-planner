// The waitlist (§12), end to end against the running API.
//
// The test that matters is the conversion one: a seat returned under a
// demand-based policy has to reach the person queueing for it without anyone
// searching for it. Everything else here is the scaffolding that makes that
// claim trustworthy — that you cannot queue for a seat that is available, that
// the queue is served in join order, that declining passes the seat straight
// on, and that no path leaks a hold.
//
// ## Why the stretch is blocked rather than bought
//
// Selling out a real stretch means buying four hundred seats through the API,
// which is minutes of test and a large hole in a wallet. Blocking them with
// this suite's own `BLOCK` rows takes the same seats out of availability
// through the same table and the same unique index, so everything under test
// sees a genuinely full stretch. Two seats are bought properly, because the
// feature turns on returning a real ticket — and every block is removed at the
// end, by reason, so a real sale on the same departure is never touched.
const path = require("path");
const BACKEND = require("path").resolve(__dirname, "../../..");
const { sequelize, Trip, TripSeat, SeatSegmentBooking } = require(`${BACKEND}/src/models`);
const { SEGMENT_SOURCE } = require(`${BACKEND}/src/models/SeatSegmentBooking`);
const inventory = require(`${BACKEND}/src/services/inventoryService`);

const BASE = process.env.API_BASE;
const MINE = "waitlist suite";

let pass = 0;
let fail = 0;
const check = (what, ok, note = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what} ${ok ? "" : note}`);
  ok ? pass++ : fail++;
};

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, body: json, raw: text };
};

const login = async (email) => {
  const r = await call("POST", "/auth/login", {
    body: { email, password: "UnitTest123!" },
  });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.raw.slice(0, 200)}`);
  return r.body.accessToken;
};

const traveller = (name, nid) => ({ name, nid, dob: "1990-05-05" });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Only ever removes this suite's own rows. */
const unblock = () =>
  SeatSegmentBooking.destroy({ where: { source: SEGMENT_SOURCE.BLOCK, reason: MINE } });

(async () => {
  const buyer = await login("unittest-user@example.com");
  const queuer = await login("unittest-target@example.com");
  const second = await login("unittest-super2@example.com");
  const su = await login("unittest-super1@example.com");

  await unblock(); // in case a previous run died mid-way

  /* ---------------- Find a stretch, buy two seats, block the rest ---------------- */

  console.log("\n== setting up a full stretch ==");

  // Consecutive stops on a real route, so every pair below is a one-leg stretch
  // some train actually runs — Ekota's, the first train with a route.
  const route = (await call("GET", "/trains/1", { token: su })).body.train.stops;
  const stations = route.map((s) => ({ id: s.stationId, name: s.station?.name, code: s.station?.code }));
  const dates = (await call("GET", "/search/dates?days=10", { token: buyer })).body.dates;

  let from = null;
  let to = null;
  let departure = null;
  // Two days out at least: the scenario returns a ticket, and a departure
  // leaving within hours is past returning, whatever time the suite runs.
  outer: for (const date of dates.map((d) => d.value || d).slice(2)) {
    for (let i = 0; i < Math.min(stations.length - 1, 8); i++) {
      const f = stations[i];
      const t = stations[i + 1];
      const r = await call(
        "GET",
        `/search/departures?fromStationId=${f.id}&toStationId=${t.id}&date=${date}`,
        { token: buyer }
      );
      const usable = (r.body?.departures || []).find((d) => d.availableCount >= 4 && d.fares?.length);
      if (usable) {
        from = f;
        to = t;
        departure = usable;
        break outer;
      }
    }
  }

  if (!departure) {
    console.error("no usable stretch found");
    process.exit(1);
  }
  console.log(
    `  ${from.name} -> ${to.name} on ${departure.train?.name || "a train"}, ` +
      `${departure.availableCount} seat(s) free`
  );

  const journey = { tripId: departure.tripId, fromStationId: from.id, toStationId: to.id };

  await call("POST", "/wallet/topup", { token: buyer, body: { amount: 20000 } });
  await call("POST", "/wallet/topup", { token: queuer, body: { amount: 20000 } });
  await call("POST", "/wallet/topup", { token: second, body: { amount: 20000 } });

  // Two real tickets, so there is something genuine to return later.
  const held = await call("POST", "/holds/auto", {
    token: buyer,
    body: { ...journey, count: 2, together: false },
  });
  if (held.status !== 201) {
    console.error("could not hold two seats:", held.raw.slice(0, 200));
    process.exit(1);
  }
  const made = await call("POST", "/bookings", {
    token: buyer,
    body: {
      holdReference: held.body.hold.reference,
      passengers: [traveller("Filler One", "1234567890123"), traveller("Filler Two", "1234567890124")],
      method: "wallet",
    },
  });
  if (made.status !== 201) {
    await call("DELETE", `/holds/${held.body.hold.reference}`, { token: buyer });
    console.error("could not buy two seats:", made.raw.slice(0, 300));
    process.exit(1);
  }
  const booking = made.body.booking || made.body;
  console.log(`  bought ${booking.tickets.length} real ticket(s): ${booking.reference}`);

  // Now block everything else that is still free over this stretch.
  const allSeats = await TripSeat.findAll({
    where: { tripId: departure.tripId },
    attributes: ["id"],
    raw: true,
  });
  let blocked = 0;
  for (const seat of allSeats) {
    try {
      await inventory.reserveSegments({
        tripId: departure.tripId,
        seats: [{ tripSeatId: seat.id, fromStationId: from.id, toStationId: to.id }],
        source: SEGMENT_SOURCE.BLOCK,
        reason: MINE,
      });
      blocked += 1;
    } catch {
      // Already occupied by a real ticket or hold — exactly what we want.
    }
  }
  console.log(`  blocked ${blocked} other seat(s) over the stretch`);

  const afterFill = await call(
    "GET",
    `/search/departures?fromStationId=${from.id}&toStationId=${to.id}&date=${departure.departureDate}`,
    { token: buyer }
  );
  const nowFull = (afterFill.body?.departures || []).find((d) => d.tripId === departure.tripId);
  check("the stretch is now sold out", (nowFull?.availableCount || 0) === 0,
    `${nowFull?.availableCount} left`);

  try {
    /* ---------------- Joining ---------------- */

    console.log("\n== joining the queue ==");

    const joined = await call("POST", "/waitlist", {
      token: queuer,
      body: { ...journey, count: 1, passengers: [traveller("Queued Passenger", "9876543210987")] },
    });
    check("a passenger can queue for a sold-out stretch", joined.status === 201,
      joined.raw.slice(0, 250));
    const entry = joined.body?.entry;
    check("with a reference to quote", !!entry?.reference, JSON.stringify(entry));
    check("and a place in the line", entry?.position === 1, `position ${entry?.position}`);
    check("that names the train, not a trip id", !!entry?.train?.name, JSON.stringify(entry?.train));
    check("and both stations", !!entry?.fromStation && !!entry?.toStation,
      `${entry?.fromStation} -> ${entry?.toStation}`);
    check("waiting, with no offer yet", entry?.status === "waiting" && !entry?.offer, entry?.status);

    const secondJoin = await call("POST", "/waitlist", {
      token: second,
      body: { ...journey, count: 1, passengers: [traveller("Behind In Line", "1111111111111")] },
    });
    check("a second passenger queues behind the first", secondJoin.status === 201,
      secondJoin.raw.slice(0, 160));
    check("and is told they are second", secondJoin.body?.entry?.position === 2,
      `position ${secondJoin.body?.entry?.position}`);

    const mine = await call("GET", "/waitlist", { token: queuer });
    check("the queue place shows in my list",
      (mine.body?.entries || []).some((e) => e.reference === entry.reference));

    /* ---------------- What the queue refuses ---------------- */

    console.log("\n== what the queue refuses ==");

    let openStretch = null;
    for (let i = 0; i < Math.min(stations.length - 1, 10); i++) {
      const r = await call(
        "GET",
        `/search/departures?fromStationId=${stations[i].id}&toStationId=${stations[i + 1].id}` +
          `&date=${departure.departureDate}`,
        { token: queuer }
      );
      const open = (r.body?.departures || []).find((d) => d.availableCount > 0);
      if (open) {
        openStretch = {
          tripId: open.tripId,
          fromStationId: stations[i].id,
          toStationId: stations[i + 1].id,
        };
        break;
      }
    }
    if (openStretch) {
      const refused = await call("POST", "/waitlist", {
        token: queuer,
        body: { ...openStretch, count: 1, passengers: [traveller("Too Eager", "2222222222222")] },
      });
      check("queueing for a journey with seats free is refused", refused.status === 400,
        `${refused.status} ${refused.raw.slice(0, 160)}`);
      check("and says to just buy one",
        /still|buy/i.test(refused.body?.error?.message || ""), refused.body?.error?.message);
    }

    const noPassengers = await call("POST", "/waitlist", {
      token: queuer,
      body: { ...journey, count: 1 },
    });
    check("queueing without saying who travels is refused", noPassengers.status === 400);

    const mismatched = await call("POST", "/waitlist", {
      token: queuer,
      body: { ...journey, count: 2, passengers: [traveller("Only One", "3333333333333")] },
    });
    check("and so is one passenger for two seats", mismatched.status === 400,
      mismatched.raw.slice(0, 160));

    const notMine = await call("GET", `/waitlist/${secondJoin.body.entry.reference}`, {
      token: queuer,
    });
    check("another passenger's queue place is not readable", notMine.status === 403,
      `${notMine.status}`);

    const noOffer = await call("POST", `/waitlist/${entry.reference}/offer/confirm`, {
      token: queuer,
    });
    check("confirming with no offer open is refused", noOffer.status === 400,
      noOffer.body?.error?.message);

    /* ---------------- The conversion ---------------- */

    console.log("\n== a returned seat reaches the queue ==");

    const ticket = booking.tickets[0];
    const options = await call("GET", `/tickets/${ticket.id}/refund-quote`, { token: buyer });
    check("return options are offered on it", options.status === 200, options.raw.slice(0, 200));
    const demand = (options.body?.options || []).find((o) => o.type === "demand" && o.ok);
    const convenient = (options.body?.options || []).find((o) => o.type === "convenient" && o.ok);
    const chosen = demand || convenient;
    check("at least one return policy is available", !!chosen,
      JSON.stringify(options.body?.options)?.slice(0, 300));

    const returned = await call("POST", `/tickets/${ticket.id}/refund`, {
      token: buyer,
      body: { type: chosen.type },
    });
    check(`the ticket is returned (${chosen.type})`, returned.status === 201,
      returned.raw.slice(0, 200));

    // The sweep fires after the refund commits and is deliberately not awaited
    // by the refund request, so give it a moment to land.
    await pause(2000);

    const afterReturn = await call("GET", `/waitlist/${entry.reference}`, { token: queuer });
    const offered = afterReturn.body?.entry;
    check("the first in the queue has been offered the seat", offered?.status === "offered",
      `status ${offered?.status}`);
    check("with the seat named", (offered?.offer?.seats || []).length === 1,
      JSON.stringify(offered?.offer));
    check("and a coach for it", !!offered?.offer?.seats?.[0]?.coachCode,
      JSON.stringify(offered?.offer?.seats?.[0]));
    check("on a clock longer than a checkout's ten minutes",
      offered?.offerSecondsRemaining > 11 * 60, `${offered?.offerSecondsRemaining}s`);

    const behind = await call("GET", `/waitlist/${secondJoin.body.entry.reference}`, {
      token: second,
    });
    check("the second in line is still waiting, not offered the same seat",
      behind.body?.entry?.status === "waiting", behind.body?.entry?.status);
    check("and has moved up to first", behind.body?.entry?.position === 1,
      `position ${behind.body?.entry?.position}`);

    const stillFull = await call(
      "GET",
      `/search/departures?fromStationId=${from.id}&toStationId=${to.id}&date=${departure.departureDate}`,
      { token: buyer }
    );
    const searchable = (stillFull.body?.departures || []).find((d) => d.tripId === departure.tripId);
    check("the returned seat is not on open sale — it is held for the queue",
      (searchable?.availableCount || 0) === 0, `${searchable?.availableCount} showing as free`);

    /* ---------------- Answering ---------------- */

    console.log("\n== taking the offer ==");

    const priced = await call("GET", `/waitlist/${entry.reference}/offer/quote`, { token: queuer });
    check("the offer can be priced before confirming", priced.status === 200,
      priced.raw.slice(0, 200));
    check("for exactly the seat offered", priced.body?.lines?.length === 1,
      JSON.stringify(priced.body?.lines));

    const strangerConfirm = await call("POST", `/waitlist/${entry.reference}/offer/confirm`, {
      token: second,
    });
    check("someone else cannot take the offer", strangerConfirm.status === 403,
      `${strangerConfirm.status}`);

    const took = await call("POST", `/waitlist/${entry.reference}/offer/confirm`, { token: queuer });
    check("the offer is taken in one call, with no body at all", took.status === 201,
      took.raw.slice(0, 250));
    const won = took.body?.booking || took.body;
    check("and becomes a real booking", !!won?.reference, JSON.stringify(won)?.slice(0, 200));
    check("with a ticket in the queued passenger's name",
      won?.tickets?.[0]?.passengerName === "Queued Passenger",
      JSON.stringify(won?.tickets?.[0])?.slice(0, 200));

    const closed = await call("GET", `/waitlist/${entry.reference}`, { token: queuer });
    check("the queue place is now confirmed", closed.body?.entry?.status === "confirmed",
      closed.body?.entry?.status);
    check("and carries the booking it became", !!closed.body?.entry?.bookingId);

    const afterTaking = await call("POST", `/waitlist/${entry.reference}/offer/confirm`, {
      token: queuer,
    });
    check("it cannot be taken twice", afterTaking.status === 400, `${afterTaking.status}`);

    /* ---------------- Declining passes it on ---------------- */

    console.log("\n== declining passes the seat straight on ==");

    const third = await call("POST", "/waitlist", {
      token: queuer,
      body: { ...journey, count: 1, passengers: [traveller("Third In Line", "4444444444444")] },
    });
    check("a third place is taken behind the second", third.status === 201, third.raw.slice(0, 200));

    const ticket2 = booking.tickets[1];
    const opts2 = await call("GET", `/tickets/${ticket2.id}/refund-quote`, { token: buyer });
    const pick = (opts2.body?.options || []).find((o) => o.ok);
    const returned2 = await call("POST", `/tickets/${ticket2.id}/refund`, {
      token: buyer,
      body: { type: pick.type },
    });
    check("a second ticket is returned", returned2.status === 201, returned2.raw.slice(0, 200));
    await pause(2000);

    const secondNow = await call("GET", `/waitlist/${secondJoin.body.entry.reference}`, {
      token: second,
    });
    check("the seat went to whoever was next, not to the newest joiner",
      secondNow.body?.entry?.status === "offered", secondNow.body?.entry?.status);

    const declined = await call("POST", `/waitlist/${secondJoin.body.entry.reference}/offer/decline`, {
      token: second,
    });
    check("declining is accepted", declined.status === 200, declined.raw.slice(0, 200));
    check("and says it was passed on", declined.body?.passedOn >= 1,
      `passedOn ${declined.body?.passedOn}`);

    const thirdNow = await call("GET", `/waitlist/${third.body.entry.reference}`, { token: queuer });
    check("the next person now holds it", thirdNow.body?.entry?.status === "offered",
      thirdNow.body?.entry?.status);
    check("with the seat named for them", (thirdNow.body?.entry?.offer?.seats || []).length === 1);

    /* ---------------- Leaving releases the seat ---------------- */

    console.log("\n== leaving the queue gives the seat back ==");

    const left = await call("DELETE", `/waitlist/${third.body.entry.reference}`, { token: queuer });
    check("a passenger can leave, offer and all", left.status === 200, left.raw.slice(0, 160));
    check("and the offer is reported as released", left.body?.releasedOffer === true,
      JSON.stringify(left.body));

    await pause(1500);

    const backOnSale = await call(
      "GET",
      `/search/departures?fromStationId=${from.id}&toStationId=${to.id}&date=${departure.departureDate}`,
      { token: buyer }
    );
    const free = (backOnSale.body?.departures || []).find((d) => d.tripId === departure.tripId);
    check("with nobody left waiting, the seat returns to open sale",
      (free?.availableCount || 0) >= 1, `${free?.availableCount} free`);

    /* ---------------- Watching the queue ---------------- */

    console.log("\n== watching a queue ==");

    const watch = await call("GET", `/waitlist/trip/${departure.tripId}`, { token: su });
    check("a privileged role can watch a departure's queue", watch.status === 200,
      watch.raw.slice(0, 200));
    check("seeing every entry in join order",
      (watch.body?.entries || []).length >= 2 && // the two this suite queued
        watch.body.entries.every((e, i, a) => i === 0 || new Date(a[i - 1].joinedAt) <= new Date(e.joinedAt)),
      JSON.stringify((watch.body?.entries || []).map((e) => [e.reference, e.joinedAt, e.status])));
    check("with the passenger named", (watch.body?.entries || []).every((e) => !!e.passenger?.name));
    check("but not their identity documents",
      (watch.body?.entries || []).every((e) => !e.passengers),
      "NIDs leaked to a queue watcher");
    check("and a count of what the queue still wants",
      typeof watch.body?.seatsWanted === "number", JSON.stringify(watch.body?.counts));

    const nosy = await call("GET", `/waitlist/trip/${departure.tripId}`, { token: queuer });
    check("an ordinary passenger cannot watch the queue", nosy.status === 403, `${nosy.status}`);
  } finally {
    /* ---------------- Tidy up ---------------- */
    for (const token of [queuer, second, buyer]) {
      const open = await call("GET", "/waitlist", { token });
      for (const e of open.body?.entries || []) {
        if (e.status === "waiting" || e.status === "offered") {
          await call("DELETE", `/waitlist/${e.reference}`, { token });
        }
      }
    }
    const removed = await unblock();
    console.log(`\n  cleaned up ${removed} blocked segment row(s)`);
    await sequelize.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error("\nsuite crashed:", err.message);
  try {
    await unblock();
    await sequelize.close();
  } catch {
    /* nothing more to do */
  }
  process.exit(1);
});
