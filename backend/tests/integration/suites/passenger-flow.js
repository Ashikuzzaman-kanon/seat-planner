// The passenger journey exactly as the UI drives it: search, choose, hold,
// name the travellers, pay, collect the tickets.
//
// Every call here uses only what a default-role account holds — the point is to
// prove a passenger never needs an operational permission to buy a ticket.
const BASE = process.env.API_BASE;

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

async function call(method, path, { token, body, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

const login = async (email) =>
  (await call("POST", "/auth/login", { body: { email, password: "UnitTest123!" } })).body;

const P = (n) => ({ name: `Flow Passenger ${n}`, nid: `199055556666${n}`, dob: "1993-07-19" });

(async () => {
  const buyer = await login("unittest-user@example.com");
  const su = await login("unittest-super1@example.com");
  const bt = buyer.accessToken, st = su.accessToken;

  console.log("== a passenger holds only the passenger baseline ==");
  check("buying, returning, queueing and reading plans — nothing operational",
    JSON.stringify([...buyer.permissions].sort()) ===
      JSON.stringify(["booking:create", "plan:view", "refund:request", "waitlist:join"]),
    JSON.stringify(buyer.permissions));
  check("no trip:view", !buyer.permissions.includes("trip:view"));
  check("no network:view", !buyer.permissions.includes("network:view"));
  check("no inventory:view", !buyer.permissions.includes("inventory:view"));

  console.log("\n== the operational screens stay shut ==");
  check("the departure board is refused", (await call("GET", "/trips", { token: bt })).status === 403);
  check("the train list is refused", (await call("GET", "/trains", { token: bt })).status === 403);
  check("quota rules are refused", (await call("GET", "/quota/rules", { token: bt })).status === 403);

  console.log("\n== but shopping works ==");
  const stations = (await call("GET", "/search/stations", { token: bt })).body.stations;
  check("stations are listed", stations?.length > 0, `${stations?.length}`);
  check("with codes and names", stations.every((s) => s.code && s.name));

  const dates = (await call("GET", "/search/dates?days=10", { token: bt })).body.dates;
  check("bookable dates are offered", dates?.length === 10, `${dates?.length}`);
  check("starting today in Dhaka", dates[0] === new Date().toISOString().slice(0, 10) ||
    dates[0] === new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10), dates[0]);

  // Find a route that actually runs.
  let found = null;
  for (const date of dates.slice(1)) {
    for (const from of stations.slice(0, 6)) {
      for (const to of stations.slice(0, 12)) {
        if (from.id === to.id) continue;
        const r = await call("GET",
          `/search/departures?fromStationId=${from.id}&toStationId=${to.id}&date=${date}`, { token: bt });
        const usable = (r.body?.departures || []).find((d) => d.availableCount >= 2 && d.fares.length);
        if (usable) { found = { from, to, date, departure: usable }; break; }
      }
      if (found) break;
    }
    if (found) break;
  }

  check("a searchable journey was found", !!found, "no route with seats and a fare");
  if (!found) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }

  const { from, to, date, departure } = found;
  console.log(`  ${from.name} -> ${to.name} on ${date}: ${departure.train.name}, ${departure.availableCount} free, from ${departure.cheapestFormatted}`);

  check("the card shows a departure time", !!departure.from.time, JSON.stringify(departure.from));
  check("and an arrival time", !!departure.to.time);
  check("and prices per class", departure.fares.every((f) => f.fareMinor > 0 && f.coachClass));
  check("cheapest first", departure.fares.every((f, i, a) => i === 0 || a[i - 1].fareMinor <= f.fareMinor));

  console.log("\n== the route a passenger can inspect ==");
  const route = await call("GET", `/search/departures/${departure.tripId}/route`, { token: bt });
  check("stops are listed", route.body.stops?.length >= 2, `${route.body.stops?.length}`);
  check("with station names", route.body.stops.every((s) => s.station?.name));
  check("and no operational noise",
    route.body.generatedAt === undefined && route.body.coaches === undefined);

  console.log("\n== seats, for picking by hand ==");
  const seats = await call("GET",
    `/search/departures/${departure.tripId}/seats?fromStationId=${from.id}&toStationId=${to.id}`,
    { token: bt });
  check("served", seats.status === 200, JSON.stringify(seats.body?.error));
  check("every seat knows its coach", seats.body.available.every((s) => s.coachCode),
    JSON.stringify(seats.body.available.slice(0, 2)));
  check("and its position in the coach",
    seats.body.available.every((s) => Number.isInteger(s.rowIndex) && Number.isInteger(s.cellIndex)));
  check("a passenger is not told why other seats are withheld",
    seats.body.withheld === undefined, "withholding reasons leaked to a passenger");

  console.log("\n== choosing ==");
  const journey = {
    tripId: departure.tripId,
    fromStationId: from.id,
    toStationId: to.id,
    count: 2,
  };

  const preview = await call("POST", "/holds/preview", {
    token: bt, body: { ...journey, together: true },
  });
  check("a proposal is offered", preview.status === 200, JSON.stringify(preview.body?.error));
  check("for two seats", preview.body.seats?.length === 2);
  check("with a plain description of how close they are", !!preview.body.togetherLabel,
    preview.body.togetherLabel);

  const held = await call("POST", "/holds/auto", {
    token: bt, body: { ...journey, together: true },
  });
  check("held", held.status === 201, JSON.stringify(held.body?.error));
  const hold = held.body.hold;
  check("with a countdown to pay", hold.secondsRemaining > 0 && hold.isLive === true);

  console.log("\n== paying ==");
  const quote = await call("POST", "/bookings/quote", { token: bt, body: { holdReference: hold.reference } });
  check("priced", quote.status === 200, JSON.stringify(quote.body?.error));
  check("payment methods are offered with reasons",
    quote.body.payment.options.every((o) => o.label && o.detail && typeof o.available === "boolean"),
    JSON.stringify(quote.body.payment.options));

  // Top up exactly, the way the wallet screen would.
  const balance = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  if (balance > 0) {
    await call("POST", `/wallet/user/${buyer.user.id}/adjust`, {
      token: st, body: { amount: balance / 100, direction: "debit", description: "Flow suite: reset" },
    });
  }
  const topUp = await call("POST", "/wallet/topup", {
    token: bt,
    body: { amount: Math.max(100, Math.ceil(quote.body.totalMinor / 100)) },
  });
  check("the passenger can top up their own wallet", topUp.status === 200,
    JSON.stringify(topUp.body?.error));

  const booked = await call("POST", "/bookings", {
    token: bt,
    body: { holdReference: hold.reference, passengers: [P(1), P(2)], method: "wallet" },
  });
  check("bought", booked.status === 201, JSON.stringify(booked.body?.error || booked.body?.message));
  if (booked.status !== 201) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }

  const booking = booked.body.booking;

  console.log("\n== what the confirmation screen renders ==");
  check("a reference to quote", /^[A-Z0-9]{6}$/.test(booking.reference), booking.reference);
  check("the train", !!booking.trip?.train?.name, JSON.stringify(booking.trip));
  check("both station names", !!booking.fromStation?.name && !!booking.toStation?.name);
  check("a formatted total", !!booking.totalFormatted, booking.totalFormatted);
  check("a ticket per passenger with a formatted fare",
    booking.tickets.length === 2 && booking.tickets.every((t) => t.fareFormatted),
    JSON.stringify(booking.tickets.map((t) => t.fareFormatted)));
  check("each ticket names its coach and seat",
    booking.tickets.every((t) => t.coachCode && t.seatNumber));

  console.log("\n== collecting the tickets ==");
  for (const ticket of booking.tickets) {
    const qr = await call("GET", `/bookings/${booking.id}/tickets/${ticket.ticketNumber}/qr`, { token: bt });
    check(`QR for seat ${ticket.seatNumber}`, qr.status === 200 && /^data:image\/png/.test(qr.body.dataUrl || ""),
      `${qr.status}`);
  }

  const pdf = await call("GET", `/bookings/${booking.id}/pdf`, { token: bt, raw: true });
  check("the PDF downloads", pdf.status === 200 && pdf.buffer.subarray(0, 5).toString("latin1") === "%PDF-");

  console.log("\n== and appears in their list ==");
  const list = await call("GET", "/bookings", { token: bt });
  check("listed", list.body.bookings.some((b) => b.id === booking.id));
  check("only their own", list.body.bookings.every((b) => b.userId === buyer.user.id));

  const byRef = await call("GET", `/bookings/reference/${booking.reference}`, { token: bt });
  check("and findable by reference", byRef.status === 200 && byRef.body.booking.id === booking.id);

  console.log("\n== bad searches are refused kindly ==");
  const backwards = await call("GET",
    `/search/departures?fromStationId=${to.id}&toStationId=${to.id}&date=${date}`, { token: bt });
  check("same station both ends", backwards.status === 400,
    `${backwards.status}: ${backwards.body?.error?.message}`);

  const past = await call("GET",
    `/search/departures?fromStationId=${from.id}&toStationId=${to.id}&date=2020-01-01`, { token: bt });
  check("a date in the past", past.status === 400, `${past.status}`);

  const nonsenseDate = await call("GET",
    `/search/departures?fromStationId=${from.id}&toStationId=${to.id}&date=not-a-date`, { token: bt });
  check("a malformed date", nonsenseDate.status === 400, `${nonsenseDate.status}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
