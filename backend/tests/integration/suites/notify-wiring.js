// That the new messages are actually reached by the real paths.
//
// The template suite proves each message renders correctly when called. This
// proves it gets called at all — the part a refactor breaks silently, and the
// part that matters, since a perfectly written email nobody triggers is worth
// nothing.
//
// It reads the API's own log rather than spying on a function, because the API
// runs in its own process. Unit-test accounts sit on @example.com, which
// `isUnroutable` deliberately refuses to hand to SMTP, so every message lands
// in that log as `[email:unroutable address]` — which is exactly the evidence
// needed here.
const fs = require("fs");

const BASE = process.env.API_BASE;
// The API runs in the test runner's process; it appends every message it does
// not actually send to this file, one JSON line each.
const LOG = process.env.EMAIL_OUTBOX;

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
  const textBody = await res.text();
  let json = null;
  try {
    json = JSON.parse(textBody);
  } catch {
    /* not json */
  }
  return { status: res.status, body: json, raw: textBody };
};

const login = async (email) => {
  const r = await call("POST", "/auth/login", { body: { email, password: "UnitTest123!" } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.raw.slice(0, 200)}`);
  return r.body.accessToken;
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Where the log has got to, so each check only looks at what it caused. */
const mark = () => {
  try {
    return fs.statSync(LOG).size;
  } catch {
    return 0;
  }
};

const since = (offset) => {
  try {
    const fd = fs.openSync(LOG, "r");
    const size = fs.statSync(LOG).size;
    if (size <= offset) {
      fs.closeSync(fd);
      return "";
    }
    const buffer = Buffer.alloc(size - offset);
    fs.readSync(fd, buffer, 0, buffer.length, offset);
    fs.closeSync(fd);
    // The outbox holds one JSON line per message; read it back in the shape the
    // console shows, which is what the checks below were written against.
    return buffer
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          const m = JSON.parse(line);
          return `[email:${m.why}] To: ${m.to}\nSubject: ${m.subject}\n${m.text}`;
        } catch {
          return line;
        }
      })
      .join("\n");
  } catch {
    return "";
  }
};

const P = (n) => ({ name: `Notify Passenger ${n}`, nid: "1990555566677", dob: "1993-07-19" });

(async () => {
  const buyer = await login("unittest-user@example.com");
  const su = await login("unittest-super1@example.com");

  await call("POST", "/wallet/topup", { token: buyer, body: { amount: 20000 } });

  /* ---------------- Find something to buy, well ahead ---------------- */

  const stations = (await call("GET", "/search/stations", { token: buyer })).body.stations;
  const dates = (await call("GET", "/search/dates?days=12", { token: buyer })).body.dates;

  let from = null;
  let to = null;
  let departure = null;
  // Skipping the near dates: a ticket on a train that has already left cannot
  // be returned, and every check here starts with a return.
  outer: for (const date of dates.map((d) => d.value || d).slice(3)) {
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
    console.error("no usable departure found");
    process.exit(1);
  }

  const journey = { tripId: departure.tripId, fromStationId: from.id, toStationId: to.id };

  const buy = async (label) => {
    const held = await call("POST", "/holds/auto", {
      token: buyer,
      body: { ...journey, count: 1, together: false },
    });
    if (held.status !== 201) throw new Error(`could not hold for ${label}: ${held.raw.slice(0, 200)}`);
    const made = await call("POST", "/bookings", {
      token: buyer,
      body: {
        holdReference: held.body.hold.reference,
        passengers: [P(label)],
        method: "wallet",
      },
    });
    if (made.status !== 201) {
      await call("DELETE", `/holds/${held.body.hold.reference}`, { token: buyer });
      throw new Error(`could not buy for ${label}: ${made.raw.slice(0, 250)}`);
    }
    return made.body.booking || made.body;
  };

  console.log(`\n  using ${from.name} -> ${to.name} on ${departure.train?.name}`);

  /* ---------------- A convenient return ---------------- */

  console.log("\n== returning a ticket sends a message ==");

  let booking = await buy("convenient");
  let ticket = booking.tickets[0];

  let at = mark();
  const opts = await call("GET", `/tickets/${ticket.id}/refund-quote`, { token: buyer });
  const convenient = (opts.body?.options || []).find((o) => o.type === "convenient" && o.ok);
  const demand = (opts.body?.options || []).find((o) => o.type === "demand" && o.ok);
  check("a return is available on a fresh ticket", !!(convenient || demand),
    JSON.stringify(opts.body?.options)?.slice(0, 250));

  if (convenient) {
    const returned = await call("POST", `/tickets/${ticket.id}/refund`, {
      token: buyer,
      body: { type: "convenient" },
    });
    check("the convenient return is accepted", [200, 201].includes(returned.status),
      returned.raw.slice(0, 200));
    await pause(1200);

    const log = since(at);
    check("a message went out for it", /\[email:/.test(log), "no send logged");
    check("its subject says the money was credited",
      /Subject: Ticket returned .* credited/.test(log),
      (log.match(/Subject: [^\n]*/g) || []).join(" | ").slice(0, 200));
    check("it tells them the money is in their wallet already",
      /in your wallet now/i.test(log));
  }

  /* ---------------- A demand return ---------------- */

  if (demand) {
    booking = await buy("demand");
    ticket = booking.tickets[0];

    at = mark();
    const returned = await call("POST", `/tickets/${ticket.id}/refund`, {
      token: buyer,
      body: { type: "demand" },
    });
    check("the demand return is accepted", [200, 201].includes(returned.status),
      returned.raw.slice(0, 200));
    await pause(1200);

    const log = since(at);
    check("a message went out for it", /\[email:/.test(log), "no send logged");
    check("its subject says it is waiting on resale, not paid",
      /Subject: Ticket returned .* waiting on resale/.test(log),
      (log.match(/Subject: [^\n]*/g) || []).join(" | ").slice(0, 200));
    check("it states plainly that nothing has been paid yet",
      /Nothing has been paid yet/i.test(log),
      "a passenger who learns this a fortnight later has been treated badly");
    check("and that an unsold seat refunds nothing", /refunds nothing/i.test(log));

    /* ------------ and pays out, with a message, when it resells ------------ */

    console.log("\n== the seat reselling pays out, and says so ==");

    at = mark();
    // Somebody else buying the same stretch is what settles it.
    const resale = await buy("resale");
    check("the seat is bought again", !!resale?.reference, "resale did not complete");
    await pause(1500);

    const resaleLog = since(at);
    check("a payout message went out",
      /Subject: (Part of your return has paid|Return complete)/.test(resaleLog),
      (resaleLog.match(/Subject: [^\n]*/g) || []).join(" | ").slice(0, 300));
    check("it names the money that just arrived",
      /credited|Credited now/i.test(resaleLog),
      "being paid without being told is barely better than not being paid");
  }

  /* ---------------- A decision on a request ---------------- */

  console.log("\n== a decision on a request sends a message ==");

  at = mark();
  const withdrawal = await call("POST", "/wallet/withdraw", {
    token: buyer,
    body: { amount: 50, destination: "Notify Test Account 0123", reason: "checking notifications" },
  });
  check("a withdrawal can be requested", [200, 201].includes(withdrawal.status),
    withdrawal.raw.slice(0, 200));

  const reference =
    withdrawal.body?.request?.reference || withdrawal.body?.approval?.reference || withdrawal.body?.reference;
  check("it has a reference", !!reference, JSON.stringify(withdrawal.body)?.slice(0, 200));

  if (reference) {
    const decided = await call("POST", `/approvals/${reference}/decide`, {
      token: su,
      body: { decision: "reject", note: "Destination account could not be verified" },
    });
    check("it can be decided", [200, 201].includes(decided.status), decided.raw.slice(0, 250));
    await pause(1200);

    const log = since(at);
    check("the requester is told the decision",
      /Subject: wallet withdrawal not approved/i.test(log),
      (log.match(/Subject: [^\n]*/g) || []).join(" | ").slice(0, 250));
    check("and the reason travels with it",
      /could not be verified/i.test(log),
      "rejected with no reason generates a support call");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("\nsuite crashed:", err.message);
  process.exit(1);
});
