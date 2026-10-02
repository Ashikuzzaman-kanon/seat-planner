// Phase 7B — reporting, scoring, and holding an account (§14).
//
// The spec's shape is: scored signals → human review queue → automatic hold
// only at a high threshold, always reversible, always audited. The distance
// between those steps is the thing worth testing. A system that holds an
// account the moment somebody accuses them would pass a naive test of "does
// reporting work" and be indefensible in use.
//
// So most of this checks what *doesn't* happen: an open report scores nothing,
// a dismissed one is withdrawn rather than discounted, churn under the floor
// counts zero, and a checker who can report cannot hold.
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

const me = async (token) => (await call("GET", "/auth/me", { token })).body.user;

(async () => {
  const buyer = await login("unittest-user@example.com");
  // Two people, as in the stations: a checker raises reports; an admin reviews
  // them and decides on holds.
  const staff = await login("unittest-admin@example.com");
  const checker = await login("unittest-checker@example.com");
  const passenger = await login("unittest-target@example.com");
  const su = await login("unittest-super1@example.com");

  const buyerId = (await me(buyer)).id;

  // Leave nothing from a previous run holding this account down.
  await call("POST", `/abuse/accounts/${buyerId}/release`, {
    token: staff,
    body: { note: "clearing state before the suite runs" },
  });

  await call("POST", "/wallet/topup", { token: buyer, body: { amount: 20000 } });

  /* ---------------- Something to report ---------------- */

  const stations = (await call("GET", "/search/stations", { token: buyer })).body.stations;
  const dates = (await call("GET", "/search/dates?days=10", { token: buyer })).body.dates;

  let from = null;
  let to = null;
  let departure = null;
  outer: for (const date of dates.map((d) => d.value || d).slice(2)) {
    for (const f of stations.slice(0, 6)) {
      for (const t of stations.slice(0, 12)) {
        if (f.id === t.id) continue;
        const r = await call(
          "GET",
          `/search/departures?fromStationId=${f.id}&toStationId=${t.id}&date=${date}`,
          { token: buyer }
        );
        const usable = (r.body?.departures || []).find((d) => d.availableCount >= 2 && d.fares?.length);
        if (usable) {
          from = f;
          to = t;
          departure = usable;
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
  const held = await call("POST", "/holds/auto", {
    token: buyer,
    body: { ...journey, count: 1, together: false },
  });
  const made = await call("POST", "/bookings", {
    token: buyer,
    body: {
      holdReference: held.body.hold.reference,
      passengers: [{ name: "Reported Passenger", nid: "1990555522221", dob: "1990-01-01" }],
      method: "wallet",
    },
  });
  const booking = made.body.booking || made.body;
  const ticket = booking.tickets[0];
  check("a ticket exists to report", !!ticket?.ticketNumber, made.raw.slice(0, 200));

  /* ---------------- Who may do what ---------------- */

  console.log("\n== reporting is not punishing ==");

  const passengerReport = await call("POST", "/abuse/reports", {
    token: passenger,
    body: { ticketNumber: ticket.ticketNumber, kind: "identity_mismatch", detail: "made this up entirely" },
  });
  check("a passenger cannot report tickets", passengerReport.status === 403,
    `${passengerReport.status}`);

  const passengerHold = await call("POST", `/abuse/accounts/${buyerId}/hold`, {
    token: passenger,
    body: { detail: "because I felt like it today" },
  });
  check("nor hold an account", passengerHold.status === 403, `${passengerHold.status}`);

  const thin = await call("POST", "/abuse/reports", {
    token: checker,
    body: { ticketNumber: ticket.ticketNumber, kind: "identity_mismatch", detail: "bad" },
  });
  check("a report with no account of what happened is refused", thin.status === 400,
    "an unreviewable report is noise in a score that can lock somebody out");

  /* ---------------- Raising one ---------------- */

  const raised = await call("POST", "/abuse/reports", {
    token: checker,
    body: {
      ticketNumber: ticket.ticketNumber,
      kind: "identity_mismatch",
      detail: "The card presented had a different name and date of birth to the ticket.",
      stationId: from.id,
    },
  });
  check("a checker can report a ticket", raised.status === 201, raised.raw.slice(0, 250));
  const reference = raised.body?.report?.reference;
  check("with a reference to follow it by", !!reference);
  check("it starts open, decided by nobody", raised.body?.report?.status === "open");
  check("the response says plainly that nothing has changed for the passenger",
    /nothing has changed/i.test(raised.body?.message || ""), raised.body?.message);

  /* ---------------- An open report is not evidence ---------------- */

  console.log("\n== an open report counts for nothing ==");

  const before = await call("GET", `/abuse/accounts/${buyerId}/standing`, { token: staff });
  check("an account's standing is readable by a reviewer", before.status === 200,
    before.raw.slice(0, 200));
  check("and the open report scored nothing",
    (before.body?.score?.parts || []).find((p) => p.signal === "Upheld reports")?.count === 0,
    JSON.stringify(before.body?.score?.parts?.[0]));
  check("the account is not held", before.body?.held === false);
  check("the score shows its arithmetic, not just a number",
    (before.body?.score?.parts || []).length >= 4 &&
      before.body.score.parts.every((p) => p.note),
    "a score nobody can argue with is a score nobody can appeal");

  const queue = await call("GET", "/abuse/reports?status=open", { token: staff });
  check("the report is in the review queue", queue.status === 200 &&
    (queue.body?.reports || []).some((r) => r.reference === reference),
    `${queue.body?.total} open`);

  const nosyQueue = await call("GET", "/abuse/reports?status=open", { token: passenger });
  check("a passenger cannot read the queue", nosyQueue.status === 403, `${nosyQueue.status}`);

  /* ---------------- Dismissal withdraws it ---------------- */

  console.log("\n== a dismissed report is withdrawn, not discounted ==");

  const second = await call("POST", "/abuse/reports", {
    token: checker,
    body: {
      ticketNumber: ticket.ticketNumber,
      kind: "other",
      detail: "Raised in error by a checker who had the wrong coach.",
    },
  });
  const dismissed = await call("POST", `/abuse/reports/${second.body.report.reference}/review`, {
    token: staff,
    body: { decision: "dismiss", note: "Checker had the wrong coach; the ticket was fine." },
  });
  check("a reviewer can dismiss", dismissed.status === 200, dismissed.raw.slice(0, 200));
  check("and it is recorded as dismissed", dismissed.body?.report?.status === "dismissed");

  const afterDismiss = await call("GET", `/abuse/accounts/${buyerId}/standing`, { token: staff });
  check("a dismissed report adds nothing at all",
    (afterDismiss.body?.score?.parts || []).find((p) => p.signal === "Upheld reports")?.count === 0,
    "a report a human rejected is not weak evidence — it is no evidence");

  const twice = await call("POST", `/abuse/reports/${second.body.report.reference}/review`, {
    token: staff,
    body: { decision: "uphold", note: "changed my mind" },
  });
  check("a decided report cannot be decided again", twice.status === 409, `${twice.status}`);

  /* ---------------- Upholding is what makes a signal ---------------- */

  console.log("\n== upholding turns an accusation into a signal ==");

  const upheld = await call("POST", `/abuse/reports/${reference}/review`, {
    token: staff,
    body: { decision: "uphold", note: "Name and date of birth both wrong; passenger admitted it." },
  });
  check("a reviewer can uphold", upheld.status === 200, upheld.raw.slice(0, 200));
  check("and it is recorded as upheld", upheld.body?.report?.status === "upheld");

  const afterUphold = await call("GET", `/abuse/accounts/${buyerId}/standing`, { token: staff });
  const reportPart = (afterUphold.body?.score?.parts || []).find((p) => p.signal === "Upheld reports");
  check("now it counts", reportPart?.count === 1, JSON.stringify(reportPart));
  check("and the total moved", afterUphold.body?.score?.total > (before.body?.score?.total ?? 0),
    `${before.body?.score?.total} -> ${afterUphold.body?.score?.total}`);

  check("but one upheld report is nowhere near the threshold",
    afterUphold.body?.score?.total < afterUphold.body?.score?.threshold,
    `${afterUphold.body?.score?.total} vs ${afterUphold.body?.score?.threshold}`);
  check("so the account is still not held", afterUphold.body?.held === false,
    "one report must never be enough");

  /* ---------------- Churn is a ratio, past a floor ---------------- */

  console.log("\n== churn counts only in quantity ==");

  const churn = (afterUphold.body?.score?.parts || []).find((p) => p.signal === "Buy-and-return churn");
  check("churn is reported either way", !!churn, JSON.stringify(afterUphold.body?.score?.parts));
  check("and explains itself when it counts nothing",
    churn?.points === 0 ? /floor|normal/i.test(churn.note || "") : true,
    churn?.note);

  /* ---------------- Holding, and lifting ---------------- */

  console.log("\n== a hold stops buying, and nothing else ==");

  const placed = await call("POST", `/abuse/accounts/${buyerId}/hold`, {
    token: staff,
    body: { detail: "Held while a series of identity mismatches is investigated." },
  });
  check("an account can be held by hand", [200, 201].includes(placed.status),
    placed.raw.slice(0, 250));
  check("and it is recorded as placed by a person, not the system",
    placed.body?.hold?.automatic === false, JSON.stringify(placed.body?.hold));

  const blocked = await call("POST", "/holds/auto", {
    token: buyer,
    body: { ...journey, count: 1, together: false },
  });
  check("a held account cannot start a checkout", blocked.status === 403,
    `${blocked.status} ${blocked.raw.slice(0, 160)}`);
  check("and is told why, in the words the reviewer wrote",
    /identity mismatches/i.test(blocked.body?.error?.message || ""),
    blocked.body?.error?.message);
  check("while being told existing tickets are safe",
    /existing tickets are unaffected/i.test(blocked.body?.error?.message || ""),
    "a hold that seems to void paid-for travel is a worse penalty than anyone decided on");

  const stillReads = await call("GET", "/bookings", { token: buyer });
  check("a held account can still read what it already bought", stillReads.status === 200,
    `${stillReads.status}`);

  const standing = await call("GET", `/abuse/accounts/${buyerId}/standing`, { token: staff });
  check("the standing shows the hold", standing.body?.held === true);
  check("and keeps the history of holds, not just the current one",
    (standing.body?.holds || []).length >= 1);

  const heldList = await call("GET", "/abuse/accounts/held", { token: staff });
  check("held accounts can be listed", heldList.status === 200 &&
    (heldList.body?.holds || []).some((h) => h.userId === buyerId),
    `${heldList.body?.total}`);

  const noNote = await call("POST", `/abuse/accounts/${buyerId}/release`, {
    token: staff,
    body: { note: "" },
  });
  check("lifting without a reason is refused", noNote.status === 400,
    "an unexplained release is as unaccountable as an unexplained hold");

  const lifted = await call("POST", `/abuse/accounts/${buyerId}/release`, {
    token: staff,
    body: { note: "Reviewed the footage; the checker was mistaken." },
  });
  check("a hold can always be lifted", lifted.status === 200, lifted.raw.slice(0, 200));
  check("and the release keeps who lifted it and why",
    !!lifted.body?.hold?.releasedAt && !!lifted.body?.hold?.releaseNote,
    JSON.stringify(lifted.body?.hold));

  const buyingAgain = await call("POST", "/holds/auto", {
    token: buyer,
    body: { ...journey, count: 1, together: false },
  });
  check("and the account can buy again immediately", buyingAgain.status === 201,
    `${buyingAgain.status} ${buyingAgain.raw.slice(0, 160)}`);
  if (buyingAgain.status === 201) {
    await call("DELETE", `/holds/${buyingAgain.body.hold.reference}`, { token: buyer });
  }

  /* ---------------- All of it audited ---------------- */

  console.log("\n== every step is audited ==");

  for (const action of ["ticket.report", "report.upheld", "account.hold", "account.release"]) {
    const events = await call("GET", `/audit?action=${action}&limit=3`, { token: su });
    check(`${action} is recorded`,
      events.status === 200 && (events.body?.events || []).length > 0,
      `${events.status}, ${(events.body?.events || []).length} events`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("\nsuite crashed:", err.message);
  process.exit(1);
});
