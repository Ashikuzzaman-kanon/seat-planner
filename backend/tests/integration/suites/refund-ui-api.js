// Every call the new refund and approval screens make, in the order they make
// them — so a screen that would break on load fails here instead.
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

(async () => {
  const buyer = await login("unittest-user@example.com");
  const admin = await login("unittest-admin@example.com");
  const bt = buyer.accessToken, at = admin.accessToken;

  console.log("== My Returns page loads ==");
  const refunds = await call("GET", "/refunds?page=1", { token: bt });
  check("the list is served", refunds.status === 200, msg(refunds));
  check("with pagination the paginator can use",
    typeof refunds.body.pagination?.pages === "number", JSON.stringify(refunds.body.pagination));

  const withSegments = (refunds.body.refunds || []).find((r) => r.segments?.length);
  if (withSegments) {
    check("a demand return carries its segment watches",
      withSegments.segments.every((s) => typeof s.isResold === "boolean" && s.refundFormatted),
      JSON.stringify(withSegments.segments[0]));
    check("and the amounts the page prints",
      Boolean(withSegments.refundedFormatted && withSegments.maximumFormatted),
      JSON.stringify([withSegments.refundedFormatted, withSegments.maximumFormatted]));
  } else {
    console.log("  (no demand return in the list to inspect)");
  }

  const staffAll = await call("GET", "/refunds?all=1", { token: at });
  check("an overseer can list everyone's", staffAll.status === 200, msg(staffAll));

  console.log("\n== Requests page loads ==");
  const mine = await call("GET", "/approvals/mine", { token: bt });
  check("a passenger's own requests are served", mine.status === 200, msg(mine));

  const queues = await call("GET", "/approvals/queues", { token: at });
  check("the queue cards are served", queues.status === 200, msg(queues));
  check("each carries what the card renders",
    queues.body.queues.every(
      (q) => q.label && typeof q.pending === "number" && typeof q.canDecide === "boolean"
    ),
    JSON.stringify(queues.body.queues));

  const queue = await call("GET", "/approvals?status=pending", { token: at });
  check("the pending queue is served", queue.status === 200, msg(queue));

  const anyRequest = (queue.body.requests || [])[0];
  if (anyRequest) {
    check("a row has the summary the card shows", Boolean(anyRequest.summary || anyRequest.subjectLabel),
      JSON.stringify(anyRequest));
    check("and who asked", Boolean(anyRequest.requestedBy?.email), JSON.stringify(anyRequest.requestedBy));
  }

  console.log("\n== Departures page: the return switches ==");
  const trips = await call("GET", "/trips?limit=20", { token: at });
  check("departures are served", trips.status === 200, msg(trips));
  check("each row carries both switches",
    trips.body.trips.every(
      (t) => typeof t.convenientReturnEnabled === "boolean" && typeof t.demandReturnEnabled === "boolean"
    ),
    JSON.stringify(trips.body.trips[0]));

  const target = trips.body.trips.find(
    (t) => t.status === "scheduled" && daysAhead(t.departureDate) >= 3
  );
  if (target) {
    const before = target.demandReturnEnabled;
    const toggled = await call("PATCH", `/trips/${target.id}/refund-options`, {
      token: at, body: { demand: !before },
    });
    check("the switch flips", toggled.status === 200 && toggled.body.trip.demandReturnEnabled === !before,
      msg(toggled));
    const backAgain = await call("PATCH", `/trips/${target.id}/refund-options`, {
      token: at, body: { demand: before },
    });
    check("and flips back", backAgain.body.trip.demandReturnEnabled === before);
  }

  console.log("\n== Bookings page: the return button's first call ==");
  const bookings = await call("GET", "/bookings", { token: bt });
  const liveTicket = (bookings.body.bookings || [])
    .flatMap((b) => b.tickets || [])
    .find((t) => t.status === "valid");

  if (liveTicket) {
    const quote = await call("GET", `/tickets/${liveTicket.id}/refund-quote`, { token: bt });
    check("the return dialog can price a live ticket", quote.status === 200, msg(quote));
    check("both options come back with a label and a description",
      quote.body.options.every((o) => o.label && o.describe),
      JSON.stringify(quote.body.options.map((o) => [o.type, o.label])));
    check("an unavailable option still says why",
      quote.body.options.every((o) => o.ok || (o.reason && o.message)),
      JSON.stringify(quote.body.options.map((o) => [o.type, o.ok, o.reason])));
  } else {
    console.log("  (no valid ticket to quote — skipped)");
  }

  console.log("\n== Wallet page: the withdrawal form ==");
  const shortOfIt = await call("POST", "/wallet/withdraw", {
    token: bt, body: { amount: 9999999, destination: "01712345678" },
  });
  check("asking for more than the balance is refused with a readable message",
    shortOfIt.status === 400 && /balance/i.test(msg(shortOfIt)), msg(shortOfIt));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
