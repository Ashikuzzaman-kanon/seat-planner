// Phase 7A — checking tickets on a train (§14).
//
// What this is really testing is the refusals. Anyone can write "valid ticket
// is valid"; the value is in whether a checker standing in a corridor is told
// something they can act on when it is *not* valid — and whether the attempt
// was written down either way, because the refused attempts are the ones that
// reveal a shared screenshot or a forged code.
const BASE = process.env.API_BASE;

let pass = 0;
let fail = 0;
const check = (what, ok, note = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what} ${ok ? "" : note}`);
  ok ? pass++ : fail++;
};

const call = async (method, p, { token, body } = {}) => {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* not json */
  }
  return { status: res.status, body: json, raw };
};

const login = async (email) => {
  const r = await call("POST", "/auth/login", { body: { email, password: "UnitTest123!" } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.raw.slice(0, 200)}`);
  return r.body.accessToken;
};

const P = (n) => ({ name: `Checked Passenger ${n}`, nid: "1990555544443", dob: "1991-02-03" });
const ref = () => `dev-${Math.random().toString(36).slice(2, 12)}`;

(async () => {
  const buyer = await login("unittest-user@example.com");
  const checker = await login("unittest-checker@example.com");
  const su = await login("unittest-super1@example.com");

  await call("POST", "/wallet/topup", { token: buyer, body: { amount: 20000 } });

  /* ---------------- Something to check ---------------- */

  const stations = (await call("GET", "/search/stations", { token: buyer })).body.stations;
  const dates = (await call("GET", "/search/dates?days=10", { token: buyer })).body.dates;

  let from = null;
  let to = null;
  let departure = null;
  let searchDate = null;
  outer: for (const date of dates.map((d) => d.value || d).slice(2)) {
    for (const f of stations.slice(0, 6)) {
      for (const t of stations.slice(0, 12)) {
        if (f.id === t.id) continue;
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
          searchDate = date;
          break outer;
        }
      }
    }
  }
  if (!departure) {
    console.error("no usable departure");
    process.exit(1);
  }

  const journey = { tripId: departure.tripId, fromStationId: from.id, toStationId: to.id };
  console.log(`\n  ${from.name} -> ${to.name} on ${departure.train?.name}, ${searchDate}`);

  const buy = async (count, label) => {
    const held = await call("POST", "/holds/auto", {
      token: buyer,
      body: { ...journey, count, together: false },
    });
    if (held.status !== 201) throw new Error(`hold failed (${label}): ${held.raw.slice(0, 200)}`);
    const made = await call("POST", "/bookings", {
      token: buyer,
      body: {
        holdReference: held.body.hold.reference,
        passengers: Array.from({ length: count }, (_, i) => P(`${label}${i}`)),
        method: "wallet",
      },
    });
    if (made.status !== 201) {
      await call("DELETE", `/holds/${held.body.hold.reference}`, { token: buyer });
      throw new Error(`buy failed (${label}): ${made.raw.slice(0, 250)}`);
    }
    return made.body.booking || made.body;
  };

  const booking = await buy(3, "A");
  const [ticketA, ticketB, ticketC] = booking.tickets;

  // The QR a passenger actually presents.
  const qr = await call("GET", `/bookings/${booking.id}/tickets/${ticketA.ticketNumber}/qr`, {
    token: buyer,
  });
  check("a ticket has a QR to present", qr.status === 200, qr.raw.slice(0, 160));
  // An image, not the token as text: the signed token is inside the picture,
  // and qr-decode.js reads it back out and verifies it.
  check("which comes as an image to show at the gate", /^data:image\/png;base64,/.test(qr.body?.dataUrl || ""),
    JSON.stringify(Object.keys(qr.body || {})));

  /* ---------------- Who may do what ---------------- */

  console.log("\n== checking is not admitting ==");

  const passengerTry = await call("POST", "/verify/check", {
    token: buyer,
    body: { ticketNumber: ticketA.ticketNumber },
  });
  check("a passenger cannot check tickets", passengerTry.status === 403, `${passengerTry.status}`);

  const passengerScan = await call("POST", "/verify/scan", {
    token: buyer,
    body: { ticketNumber: ticketA.ticketNumber },
  });
  check("nor scan them", passengerScan.status === 403, `${passengerScan.status}`);

  /* ---------------- Looking, without burning it ---------------- */

  console.log("\n== looking at a ticket changes nothing ==");

  const looked = await call("POST", "/verify/check", {
    token: checker,
    body: { ticketNumber: ticketA.ticketNumber, tripId: departure.tripId },
  });
  check("a checker can look", looked.status === 200, looked.raw.slice(0, 200));
  check("a good ticket is not refused", looked.body?.refused === false, looked.body?.verdict);
  check("and is recorded as looked at, not admitted", looked.body?.verdict === "checked",
    looked.body?.verdict);
  check("the passenger is named for matching against a card",
    !!looked.body?.ticket?.passengerName, JSON.stringify(looked.body?.ticket));
  check("with only the last four NID digits",
    (looked.body?.ticket?.nidLastFour || "").length === 4 &&
      !JSON.stringify(looked.body).includes("1990555544443"),
    "a full NID on a checker's screen is a number that can be photographed");
  check("the seat and coach are shown", !!looked.body?.ticket?.seatNumber && !!looked.body?.ticket?.coachCode);

  const stillValid = await call("POST", "/verify/check", {
    token: checker,
    body: { ticketNumber: ticketA.ticketNumber },
  });
  check("looking twice is still fine — nothing was burned",
    stillValid.body?.refused === false, stillValid.body?.verdict);

  /* ---------------- Admitting ---------------- */

  console.log("\n== admitting a passenger ==");

  const admitted = await call("POST", "/verify/scan", {
    token: checker,
    body: {
      ticketNumber: ticketA.ticketNumber,
      tripId: departure.tripId,
      stationId: from.id,
      clientReference: ref(),
    },
  });
  check("a valid ticket is accepted", admitted.body?.verdict === "accepted",
    `${admitted.status} ${admitted.raw.slice(0, 200)}`);
  check("and the checker is told plainly", /let them travel/i.test(admitted.body?.message || ""),
    admitted.body?.message);

  const second = await call("POST", "/verify/scan", {
    token: checker,
    body: { ticketNumber: ticketA.ticketNumber, tripId: departure.tripId, stationId: from.id },
  });
  check("the same ticket a second time is refused", second.body?.verdict === "already_used",
    second.body?.verdict);
  check("and it is a 200, not an error — the scanner asked and got an answer",
    second.status === 200, `${second.status}`);
  check("the refusal says when it was first scanned",
    /already scanned/i.test(second.body?.message || ""), second.body?.message);
  check("and names where", !!second.body?.firstScan?.station || /at /.test(second.body?.message || ""),
    JSON.stringify(second.body?.firstScan));

  /* ---------------- Codes that are not tickets ---------------- */

  console.log("\n== codes that are not tickets ==");

  const forged = await call("POST", "/verify/scan", {
    token: checker,
    body: { token: "eyJhIjoiYiJ9.bm90LWEtc2lnbmF0dXJl", tripId: departure.tripId },
  });
  check("a bad signature is called a forgery", forged.body?.verdict === "forged",
    forged.body?.verdict);
  check("and says the railway did not issue it",
    /not issued by us/i.test(forged.body?.message || ""), forged.body?.message);

  const gibberish = await call("POST", "/verify/scan", {
    token: checker,
    body: { token: "not-even-close", tripId: departure.tripId },
  });
  check("an unreadable code is not called a forgery", gibberish.body?.verdict === "unreadable",
    gibberish.body?.verdict);

  const unknown = await call("POST", "/verify/scan", {
    token: checker,
    body: { ticketNumber: "TZZZZ-ZZZZ", tripId: departure.tripId },
  });
  check("a number we do not hold is refused", unknown.body?.verdict === "unknown",
    unknown.body?.verdict);
  check("and tells them to check the digits",
    /check the digits/i.test(unknown.body?.message || ""), unknown.body?.message);

  const empty = await call("POST", "/verify/scan", { token: checker, body: {} });
  check("scanning nothing is a validation error", empty.status === 400, `${empty.status}`);

  /* ---------------- Real ticket, wrong place ---------------- */

  console.log("\n== a real ticket in the wrong place ==");

  const wrongTrain = await call("POST", "/verify/scan", {
    token: checker,
    body: { ticketNumber: ticketB.ticketNumber, tripId: departure.tripId + 99999 },
  });
  check("a ticket for another service is refused", wrongTrain.body?.verdict === "wrong_service",
    wrongTrain.body?.verdict);
  check("and says which service it IS for, which is the useful part",
    /is for /i.test(wrongTrain.body?.message || ""), wrongTrain.body?.message);
  check("it was not burned by the refusal",
    (await call("POST", "/verify/check", { token: checker, body: { ticketNumber: ticketB.ticketNumber } }))
      .body?.refused === false,
    "a wrong-train refusal must not consume the ticket");

  /* ---------------- A returned ticket ---------------- */

  console.log("\n== a returned ticket ==");

  const opts = await call("GET", `/tickets/${ticketC.id}/refund-quote`, { token: buyer });
  const pick = (opts.body?.options || []).find((o) => o.ok);
  if (pick) {
    await call("POST", `/tickets/${ticketC.id}/refund`, { token: buyer, body: { type: pick.type } });
    const refunded = await call("POST", "/verify/scan", {
      token: checker,
      body: { ticketNumber: ticketC.ticketNumber, tripId: departure.tripId },
    });
    check("a refunded ticket is refused", refunded.body?.verdict === "not_valid",
      refunded.body?.verdict);
    check("and says it was returned, not merely 'invalid'",
      /returned and refunded/i.test(refunded.body?.message || ""),
      refunded.body?.message);
  }

  /* ---------------- Offline ---------------- */

  console.log("\n== checking a service with no network ==");

  const manifest = await call("GET", `/verify/trips/${departure.tripId}/manifest`, {
    token: checker,
  });
  check("a manifest can be downloaded", manifest.status === 200, manifest.raw.slice(0, 200));
  check("it names the train", !!manifest.body?.train, JSON.stringify(manifest.body?.train));
  check("and lists the tickets on board", (manifest.body?.tickets || []).length > 0,
    `${manifest.body?.count}`);
  check("each with the status an offline scanner needs",
    (manifest.body?.tickets || []).every((t) => t.ticketNumber && t.status));
  check("NIDs are truncated in a file that leaves the building",
    (manifest.body?.tickets || []).every((t) => !t.passengerNid && (t.nidLastFour || "").length <= 4),
    "a full NID in a downloadable manifest");
  check("it warns that a stale manifest still looks valid",
    /download again/i.test(manifest.body?.advice || ""), manifest.body?.advice);
  check("already-scanned tickets are marked, so an offline scanner can refuse them",
    (manifest.body?.tickets || []).some((t) => t.alreadyScannedAt),
    "nothing marked as scanned though one was admitted");

  const booking2 = await buy(2, "B");
  const [offA, offB] = booking2.tickets;

  const whenA = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const refA = ref();
  const synced = await call("POST", "/verify/scans/sync", {
    token: checker,
    body: {
      scans: [
        { ticketNumber: offA.ticketNumber, tripId: departure.tripId, stationId: from.id, scannedAt: whenA, clientReference: refA },
        { ticketNumber: offB.ticketNumber, tripId: departure.tripId, stationId: from.id, scannedAt: new Date(Date.now() - 80 * 60 * 1000).toISOString(), clientReference: ref() },
      ],
    },
  });
  check("a batch of offline scans is accepted", synced.status === 200, synced.raw.slice(0, 250));
  check("and both were admitted", synced.body?.accepted === 2, JSON.stringify(synced.body));

  const again = await call("POST", "/verify/scans/sync", {
    token: checker,
    body: {
      scans: [
        { ticketNumber: offA.ticketNumber, tripId: departure.tripId, scannedAt: whenA, clientReference: refA },
      ],
    },
  });
  check("re-sending the same scan records nothing twice",
    again.body?.duplicates === 1,
    JSON.stringify(again.body));
  check("which is what makes a retry over bad signal safe",
    again.body?.accepted === 0, JSON.stringify(again.body));

  const history = await call("GET", `/verify/tickets/${offA.ticketNumber}/scans`, { token: checker });
  check("a ticket's scan history is readable", history.status === 200, history.raw.slice(0, 200));
  check("and keeps the time the scan actually happened, not when it synced",
    (history.body?.scans || []).some((s) => new Date(s.scannedAt) < new Date(s.syncedAt)),
    JSON.stringify((history.body?.scans || []).map((s) => ({ at: s.scannedAt, sync: s.syncedAt }))));
  check("and marks it as having come from offline",
    (history.body?.scans || []).some((s) => s.offline === true));

  /* ---------------- Reconciling afterwards ---------------- */

  console.log("\n== how the service went ==");

  const report = await call("GET", `/verify/trips/${departure.tripId}/scans`, { token: checker });
  check("a trip's scans can be read back", report.status === 200, report.raw.slice(0, 200));
  check("with what was sold and what was admitted",
    typeof report.body?.sold === "number" && typeof report.body?.admitted === "number",
    JSON.stringify({ sold: report.body?.sold, admitted: report.body?.admitted }));
  check("and the difference, which is what a no-show count is made of",
    report.body?.unscanned === report.body?.sold - report.body?.admitted,
    `${report.body?.unscanned}`);
  check("the refused attempts are kept, not only the admitted ones",
    (report.body?.scans || []).some((s) => s.refused === true),
    "refusals are the evidence of a shared screenshot or a forged code");
  check("each scan names who did it", (report.body?.scans || []).every((s) => s.checkedBy || s.checkedById));

  const nosy = await call("GET", `/verify/trips/${departure.tripId}/scans`, { token: buyer });
  check("a passenger cannot read a service's scan log", nosy.status === 403, `${nosy.status}`);

  /* ---------------- It is all audited ---------------- */

  const audit = await call("GET", "/audit?action=ticket.scan&limit=5", { token: su });
  check("admitting a passenger is audited",
    audit.status === 200 && (audit.body?.events || []).length > 0,
    `${audit.status} ${(audit.body?.events || []).length} events`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("\nsuite crashed:", err.message);
  process.exit(1);
});
