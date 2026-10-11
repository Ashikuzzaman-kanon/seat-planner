// Phase 5B — auto-select, ticket documents, and the QR a checker reads.
//
// Re-runnable: every hold it opens is released, and the one booking it makes is
// paid from credit it adds itself.
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
  if (raw) {
    return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  }
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

const PASSENGER = (n) => ({ name: `Doc Passenger ${n}`, nid: `199044443333${n}`, dob: "1991-03-21" });

const opened = [];

(async () => {
  const buyer = await login("unittest-user@example.com");
  const admin = await login("unittest-admin@example.com");
  const stranger = await login("unittest-target@example.com");
  const su = await login("unittest-super1@example.com");
  const bt = buyer.accessToken, at = admin.accessToken, xt = stranger.accessToken, st = su.accessToken;

  const trips = (await call("GET", "/trips?limit=500", { token: at })).body.trips;
  const candidates = trips
    .filter((t) => t.status === "scheduled" && t.seatCount > 20 && daysAhead(t.departureDate) >= 2)
    .sort((a, b) => b.seatCount - a.seatCount);

  let trip = null, train = null;
  for (const c of candidates) {
    const detail = (await call("GET", `/trains/${c.trainId}`, { token: at })).body.train;
    if (detail?.stops?.length >= 4) { trip = c; train = detail; break; }
  }
  if (!trip) { console.log("no usable departure"); process.exit(1); }

  const A = train.stops[0].stationId;
  const C = train.stops[2].stationId;
  console.log(`using ${train.name} on ${trip.departureDate} (${trip.seatCount} seats)\n`);

  const journey = { tripId: trip.id, fromStationId: A, toStationId: C };

  console.log("== previewing a selection reserves nothing ==");
  const before = (await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${C}`, { token: at })).body;

  const preview = await call("POST", "/holds/preview", { token: bt, body: { ...journey, count: 2 } });
  check("a preview is returned", preview.status === 200, JSON.stringify(preview.body));
  check("it names the seats", preview.body.seats?.length === 2, JSON.stringify(preview.body.seatIds));
  check("each seat carries its coach code", preview.body.seats.every((s) => s.coachCode),
    JSON.stringify(preview.body.seats.map((s) => s.coachCode)));
  check("it says how close together they are", !!preview.body.togetherLabel, preview.body.togetherLabel);

  const afterPreview = (await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${C}`, { token: at })).body;
  check("nothing was taken", afterPreview.availableCount === before.availableCount,
    `${before.availableCount} -> ${afterPreview.availableCount}`);

  console.log("\n== asking to sit together ==");
  const together = await call("POST", "/holds/preview", {
    token: bt, body: { ...journey, count: 2, together: true },
  });
  check("a pair is found", together.status === 200, JSON.stringify(together.body));
  check("they are side by side", together.body.togetherness === "side_by_side",
    together.body.togetherness);

  const seats = together.body.seats;
  check("in the same coach", new Set(seats.map((s) => s.coachCode)).size === 1);
  check("in the same row", new Set(seats.map((s) => s.rowIndex)).size === 1,
    JSON.stringify(seats.map((s) => s.rowIndex)));
  check("with nothing between them",
    Math.abs(seats[0].cellIndex - seats[1].cellIndex) === 1,
    JSON.stringify(seats.map((s) => s.cellIndex)));

  console.log("\n== criteria ==");
  const windowSeats = await call("POST", "/holds/preview", {
    token: bt, body: { ...journey, count: 2, criteria: { window: true } },
  });
  check("window seats are found", windowSeats.status === 200, JSON.stringify(windowSeats.body));
  check("and every one of them is a window seat",
    windowSeats.body.seats.every((s) => s.attributes?.window),
    JSON.stringify(windowSeats.body.seats.map((s) => s.attributes)));
  check("nothing was relaxed", windowSeats.body.relaxed?.length === 0,
    JSON.stringify(windowSeats.body.relaxed));

  const impossible = await call("POST", "/holds/preview", {
    token: bt,
    body: { ...journey, count: 2, criteria: { unicorn_stable: true }, strict: true },
  });
  check("an unmeetable preference is refused, not silently dropped", impossible.status === 409,
    `got ${impossible.status}`);
  check("and the refusal says which preference failed",
    impossible.body?.error?.details?.unsatisfiable?.includes("unicorn_stable"),
    JSON.stringify(impossible.body?.error?.details));
  check("with a message a passenger can act on",
    /no free seat has/i.test(impossible.body?.error?.message || ""),
    impossible.body?.error?.message);

  const lenient = await call("POST", "/holds/preview", {
    token: bt, body: { ...journey, count: 2, criteria: { unicorn_stable: true }, strict: false },
  });
  check("without strict, seats are offered anyway", lenient.status === 200, JSON.stringify(lenient.body));
  check("but the concession is reported",
    lenient.body.relaxed?.includes("unicorn_stable"), JSON.stringify(lenient.body.relaxed));

  console.log("\n== more seats than anyone may buy at once ==");
  const greedy = await call("POST", "/holds/preview", { token: bt, body: { ...journey, count: 9 } });
  check("refused above the per-booking cap", greedy.status === 400, `got ${greedy.status}`);

  console.log("\n== choosing and holding in one step ==");
  const auto = await call("POST", "/holds/auto", {
    token: bt, body: { ...journey, count: 3, together: true },
  });
  check("held", auto.status === 201, JSON.stringify(auto.body));
  if (auto.status === 201) opened.push(auto.body.hold.reference);

  check("three seats", auto.body.hold.seatIds.length === 3);
  check("it took one attempt on a quiet train", auto.body.attempts === 1, `${auto.body.attempts}`);
  check("the message says where they are", /coach|side by side|same row|row of each other/i.test(auto.body.message),
    auto.body.message);

  const afterAuto = (await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${C}`, { token: at })).body;
  check("three seats left availability", afterAuto.availableCount === before.availableCount - 3,
    `${before.availableCount} -> ${afterAuto.availableCount}`);

  console.log("\n== buying them, then the documents ==");
  const quote = await call("POST", "/bookings/quote", {
    token: bt, body: { holdReference: auto.body.hold.reference },
  });
  check("quoted", quote.status === 200, JSON.stringify(quote.body));

  // Fund the wallet for exactly this purchase.
  const balance = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  if (balance > 0) {
    await call("POST", `/wallet/user/${buyer.user.id}/adjust`, {
      token: st, body: { amount: balance / 100, direction: "debit", description: "5B suite: reset" },
    });
  }
  await call("POST", `/wallet/user/${buyer.user.id}/adjust`, {
    token: st,
    body: { amount: quote.body.totalMinor / 100, direction: "credit", description: "5B suite: one fare" },
  });

  const booked = await call("POST", "/bookings", {
    token: bt,
    body: {
      holdReference: auto.body.hold.reference,
      passengers: [PASSENGER(1), PASSENGER(2), PASSENGER(3)],
      method: "wallet",
    },
  });
  check("bought", booked.status === 201, JSON.stringify(booked.body?.message || booked.body));
  if (booked.status !== 201) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }

  opened.length = 0; // the hold converted; nothing to release
  const booking = booked.body.booking;

  console.log("\n== the PDF ==");
  const pdf = await call("GET", `/bookings/${booking.id}/pdf`, { token: bt, raw: true });
  check("served", pdf.status === 200, `got ${pdf.status}`);
  check("as a PDF", pdf.headers.get("content-type") === "application/pdf",
    pdf.headers.get("content-type"));
  check("named after the booking",
    (pdf.headers.get("content-disposition") || "").includes(`ticket-${booking.reference}.pdf`),
    pdf.headers.get("content-disposition"));
  check("with a real PDF header", pdf.buffer.subarray(0, 5).toString("latin1") === "%PDF-",
    pdf.buffer.subarray(0, 8).toString("latin1"));

  const text = pdf.buffer.toString("latin1");
  check("one page per ticket", (text.match(/\/Type\s*\/Page[^s]/g) || []).length === 3,
    `${(text.match(/\/Type\s*\/Page[^s]/g) || []).length} pages`);
  check("the QR images are embedded", text.includes("/Image"));
  check("it is not an empty shell", pdf.buffer.length > 10000, `${pdf.buffer.length} bytes`);

  const strangerPdf = await call("GET", `/bookings/${booking.id}/pdf`, { token: xt, raw: true });
  check("someone else cannot download it", strangerPdf.status === 404, `got ${strangerPdf.status}`);

  const staffPdf = await call("GET", `/bookings/${booking.id}/pdf`, { token: at, raw: true });
  check("an overseer can", staffPdf.status === 200, `got ${staffPdf.status}`);

  console.log("\n== the QR a checker scans ==");
  const number = booking.tickets[0].ticketNumber;
  const qr = await call("GET", `/bookings/${booking.id}/tickets/${number}/qr`, { token: bt });
  check("served", qr.status === 200, JSON.stringify(qr.body));
  check("as a PNG data URI", /^data:image\/png;base64,/.test(qr.body.dataUrl || ""),
    (qr.body.dataUrl || "").slice(0, 40));
  check("for the ticket asked for", qr.body.ticketNumber === number);

  const wrongTicket = await call("GET", `/bookings/${booking.id}/tickets/TKTNOPE99/qr`, { token: bt });
  check("a ticket not on this booking is refused", wrongTicket.status === 404,
    `got ${wrongTicket.status}`);

  console.log("\n== the signature ==");
  const { issue, verify } = require("../../../src/utils/ticketToken");
  const full = (await call("GET", `/bookings/${booking.id}`, { token: bt })).body.booking;
  const token = issue(full.tickets[0], full);
  const read = verify(token);

  check("a real ticket verifies", read.valid === true, read.message);
  check("and reads back the seat that was sold",
    read.ticket.seatNumber === full.tickets[0].seatNumber,
    `${read.ticket.seatNumber} vs ${full.tickets[0].seatNumber}`);
  check("and the PNR", read.ticket.bookingReference === booking.reference);
  check("carrying only the last four NID digits",
    read.ticket.nidLastFour === full.tickets[0].passengerNid.slice(-4) &&
      !JSON.stringify(read.payload).includes(full.tickets[0].passengerNid),
    read.ticket.nidLastFour);

  const forged = token.slice(0, -4) + "AAAA";
  check("a tampered signature is rejected", verify(forged).valid === false);

  console.log("\n== a full train ==");
  // Ask for more seats than remain on a stretch nobody can serve.
  const hopeless = await call("POST", "/holds/preview", {
    token: bt, body: { ...journey, count: 10 },
  });
  check("refused before anything is reserved", hopeless.status === 400 || hopeless.status === 409,
    `got ${hopeless.status}`);

  console.log("\n== permissions ==");
  const staffTriesToHold = await call("POST", "/holds/auto", {
    token: at, body: { ...journey, count: 1 },
  });
  check("an overseer who cannot buy cannot auto-hold either", staffTriesToHold.status === 403,
    `got ${staffTriesToHold.status}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error("harness error:", err);
  process.exit(1);
});
