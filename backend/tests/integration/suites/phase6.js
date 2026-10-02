// Phase 6A — returning a ticket, and the one queue that decides transfers and
// withdrawals.
//
// Re-runnable: it buys what it returns, and drains the wallet it funds.
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

const P = (n) => ({ name: `Refund Passenger ${n}`, nid: `199077778888${n}`, dob: "1994-01-15" });

/** Buy `count` seats on a departure far enough out to be returnable. */
async function buy({ token, adminToken, superToken, userId, count = 1, minDays = 5 }) {
  const trips = (await call("GET", "/trips?limit=500", { token: adminToken })).body.trips;
  const candidates = trips
    .filter((t) => t.status === "scheduled" && t.seatCount > 20 && daysAhead(t.departureDate) >= minDays)
    .sort((a, b) => b.seatCount - a.seatCount);

  for (const c of candidates) {
    const train = (await call("GET", `/trains/${c.trainId}`, { token: adminToken })).body.train;
    if (!train?.stops || train.stops.length < 4) continue;

    const A = train.stops[0].stationId;
    const C = train.stops[2].stationId;

    const held = await call("POST", "/holds/auto", {
      token, body: { tripId: c.id, fromStationId: A, toStationId: C, count },
    });
    if (held.status !== 201) continue;

    const quote = await call("POST", "/bookings/quote", {
      token, body: { holdReference: held.body.hold.reference },
    });

    // Fund exactly, so the suite leaves the wallet as it found it.
    const balance = (await call("GET", "/wallet", { token })).body.wallet.balanceMinor;
    if (balance > 0) {
      await call("POST", `/wallet/user/${userId}/adjust`, {
        token: superToken,
        body: { amount: balance / 100, direction: "debit", description: "Phase 6 suite: reset" },
      });
    }
    await call("POST", `/wallet/user/${userId}/adjust`, {
      token: superToken,
      body: { amount: quote.body.totalMinor / 100, direction: "credit", description: "Phase 6 suite: fare" },
    });

    const booked = await call("POST", "/bookings", {
      token,
      body: {
        holdReference: held.body.hold.reference,
        passengers: Array.from({ length: count }, (_, i) => P(i + 1)),
        method: "wallet",
      },
    });
    if (booked.status !== 201) continue;

    return { booking: booked.body.booking, trip: c, train, A, C, quote: quote.body };
  }
  return null;
}

(async () => {
  const buyer = await login("unittest-user@example.com");
  const other = await login("unittest-target@example.com");
  const admin = await login("unittest-admin@example.com");
  const su = await login("unittest-super1@example.com");
  const bt = buyer.accessToken, xt = other.accessToken, at = admin.accessToken, st = su.accessToken;

  console.log("== who may do what ==");
  check("a passenger may return their own ticket", buyer.permissions.includes("refund:request"));
  check("but not see everyone's refunds", !buyer.permissions.includes("refund:view_all"));
  check("nor work the approval queue", !buyer.permissions.includes("approval:view"));
  check("an admin works the queue", admin.permissions.includes("approval:view"));
  check("and decides transfers", admin.permissions.includes("approval:decide_transfer"));
  check("but not withdrawals — money leaving stays narrow",
    !admin.permissions.includes("approval:decide_withdrawal"));

  /* ---------------------------------------------------------------- */
  console.log("\n== quoting a return ==");
  const first = await buy({ token: bt, adminToken: at, superToken: st, userId: buyer.user.id });
  check("bought something to return", !!first, "no departure far enough out");
  if (!first) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }

  const ticket = first.booking.tickets[0];
  console.log(`  ${first.train.name} on ${first.trip.departureDate}, seat ${ticket.seatNumber}, ${ticket.fareFormatted}`);

  const quote = await call("GET", `/tickets/${ticket.id}/refund-quote`, { token: bt });
  check("quoted", quote.status === 200, msg(quote));
  check("both policies are offered side by side", quote.body.options?.length === 2,
    JSON.stringify(quote.body.options?.map((o) => o.type)));

  const conv = quote.body.options.find((o) => o.type === "convenient");
  const dem = quote.body.options.find((o) => o.type === "demand");

  check("each explains itself", conv.label && conv.describe && dem.label && dem.describe);
  check("the convenient return pays now", conv.ok && conv.immediate === true, JSON.stringify(conv));
  check("its deduction and refund add back to the fare",
    conv.deductionMinor + conv.refundMinor === ticket.fareMinor,
    `${conv.deductionMinor} + ${conv.refundMinor} != ${ticket.fareMinor}`);
  check("the demand return promises nothing up front", dem.ok && dem.immediate === false);
  // Far out, the convenient deduction (10% at 96 h+) equals the demand charge
  // (10%); closer in, the convenient one takes more. Never less, either way.
  check("it is never worth less than the convenient one",
    dem.maximumMinor >= conv.refundMinor,
    `demand ${dem.maximumMinor} vs convenient ${conv.refundMinor}`);
  check("and covers every segment", dem.lines.length === quote.body.segmentCount,
    `${dem.lines.length} lines vs ${quote.body.segmentCount} segments`);

  const strangerQuote = await call("GET", `/tickets/${ticket.id}/refund-quote`, { token: xt });
  check("someone else cannot quote it", strangerQuote.status === 404, `${strangerQuote.status}`);

  /* ---------------------------------------------------------------- */
  console.log("\n== a convenient return ==");
  const beforeWallet = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  const availBefore = (await call("GET",
    `/trips/${first.trip.id}/availability?fromStationId=${first.A}&toStationId=${first.C}`,
    { token: at })).body.availableCount;

  const returned = await call("POST", `/tickets/${ticket.id}/refund`, {
    token: bt, body: { type: "convenient" },
  });
  check("accepted", returned.status === 201, msg(returned));
  const refund = returned.body.refund;

  check("settled immediately", refund.status === "settled", refund.status);
  check("credited exactly what was quoted", refund.refundedMinor === conv.refundMinor,
    `${refund.refundedMinor} vs ${conv.refundMinor}`);

  const afterWallet = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  check("the wallet grew by that amount", afterWallet === beforeWallet + conv.refundMinor,
    `${beforeWallet} -> ${afterWallet}`);
  check("the ledger still balances",
    (await call("GET", "/wallet/verify", { token: bt })).body.consistent === true);

  const availAfter = (await call("GET",
    `/trips/${first.trip.id}/availability?fromStationId=${first.A}&toStationId=${first.C}`,
    { token: at })).body.availableCount;
  check("the seat is back on sale", availAfter === availBefore + 1, `${availBefore} -> ${availAfter}`);

  const ticketNow = (await call("GET", `/bookings/${first.booking.id}`, { token: bt }))
    .body.booking.tickets.find((t) => t.id === ticket.id);
  check("the ticket reads as refunded", ticketNow.status === "refunded", ticketNow.status);

  const twice = await call("POST", `/tickets/${ticket.id}/refund`, {
    token: bt, body: { type: "convenient" },
  });
  check("it cannot be returned twice", twice.status === 409, `${twice.status}: ${msg(twice)}`);

  const booking = (await call("GET", `/bookings/${first.booking.id}`, { token: bt })).body.booking;
  check("a booking with no tickets left is itself refunded", booking.status === "refunded",
    booking.status);

  /* ---------------------------------------------------------------- */
  console.log("\n== a demand-based return, and the resale that pays it ==");
  const second = await buy({ token: bt, adminToken: at, superToken: st, userId: buyer.user.id });
  check("bought another", !!second);
  if (!second) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }

  const seatTicket = second.booking.tickets[0];
  const demandQuote = (await call("GET", `/tickets/${seatTicket.id}/refund-quote`, { token: bt })).body;
  const demandOption = demandQuote.options.find((o) => o.type === "demand");

  const walletBeforeDemand = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;

  const demandReturn = await call("POST", `/tickets/${seatTicket.id}/refund`, {
    token: bt, body: { type: "demand" },
  });
  check("accepted", demandReturn.status === 201, msg(demandReturn));
  const dr = demandReturn.body.refund;

  check("it waits for a buyer", dr.status === "awaiting_resale", dr.status);
  check("nothing has been credited yet", dr.refundedMinor === 0, `${dr.refundedMinor}`);
  check("but a ceiling is recorded", dr.maximumMinor === demandOption.maximumMinor);
  check("one watch per segment", dr.segments.length === demandQuote.segmentCount,
    `${dr.segments.length} vs ${demandQuote.segmentCount}`);
  check("none of them resold yet", dr.segments.every((s) => !s.isResold));

  const walletAfterReturn = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  check("no money moved on accepting it", walletAfterReturn === walletBeforeDemand,
    `${walletBeforeDemand} -> ${walletAfterReturn}`);

  const seatFree = (await call("GET",
    `/trips/${second.trip.id}/availability?fromStationId=${second.A}&toStationId=${second.C}`,
    { token: at })).body;
  check("the seat is on sale again", seatFree.available.some((s) => s.id === seatTicket.tripSeatId),
    "the returned seat is not purchasable");

  // Someone else buys that exact seat.
  console.log("\n  -- another passenger buys the returned seat --");
  const resaleHold = await call("POST", "/holds", {
    token: xt,
    body: {
      tripId: second.trip.id,
      seatIds: [seatTicket.tripSeatId],
      fromStationId: second.A,
      toStationId: second.C,
    },
  });
  check("held by the new buyer", resaleHold.status === 201, msg(resaleHold));

  const resaleQuote = await call("POST", "/bookings/quote", {
    token: xt, body: { holdReference: resaleHold.body.hold.reference },
  });
  const otherBalance = (await call("GET", "/wallet", { token: xt })).body.wallet.balanceMinor;
  if (otherBalance > 0) {
    await call("POST", `/wallet/user/${other.user.id}/adjust`, {
      token: st, body: { amount: otherBalance / 100, direction: "debit", description: "Phase 6: reset" },
    });
  }
  await call("POST", `/wallet/user/${other.user.id}/adjust`, {
    token: st,
    body: { amount: resaleQuote.body.totalMinor / 100, direction: "credit", description: "Phase 6: resale" },
  });

  const resold = await call("POST", "/bookings", {
    token: xt,
    body: { holdReference: resaleHold.body.hold.reference, passengers: [P(9)], method: "wallet" },
  });
  check("resold", resold.status === 201, msg(resold));

  const settled = (await call("GET", `/refunds/${dr.reference}`, { token: bt })).body.refund;
  check("the refund settled", settled.status === "settled", settled.status);
  check("paying its full ceiling", settled.refundedMinor === dr.maximumMinor,
    `${settled.refundedMinor} vs ${dr.maximumMinor}`);
  check("every segment is marked resold", settled.segments.every((s) => s.isResold));
  check("each naming the ticket that bought it",
    settled.segments.every((s) => s.resoldTicketId), JSON.stringify(settled.segments.map((s) => s.resoldTicketId)));

  const walletSettled = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  check("the money arrived", walletSettled === walletAfterReturn + dr.maximumMinor,
    `${walletAfterReturn} + ${dr.maximumMinor} != ${walletSettled}`);
  check("the ledger balances after a resale payout",
    (await call("GET", "/wallet/verify", { token: bt })).body.consistent === true);

  /* ---------------------------------------------------------------- */
  console.log("\n== a ticket transfer needs a person ==");
  const third = await buy({ token: bt, adminToken: at, superToken: st, userId: buyer.user.id });
  check("bought a third", !!third);
  if (!third) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }
  const transferable = third.booking.tickets[0];

  const badNid = await call("POST", `/tickets/${transferable.id}/transfer`, {
    token: bt, body: { toNid: "123", toName: "New Passenger" },
  });
  check("a short NID is refused", badNid.status === 400, `${badNid.status}`);

  const sameNid = await call("POST", `/tickets/${transferable.id}/transfer`, {
    token: bt, body: { toNid: transferable.passengerNid, toName: "Same Person" },
  });
  check("transferring to the same NID is refused", sameNid.status === 400, msg(sameNid));

  const transfer = await call("POST", `/tickets/${transferable.id}/transfer`, {
    token: bt,
    body: { toNid: "1999000011112", toName: "Karim Ahmed", reason: "Cannot travel; my brother will" },
  });
  check("requested", transfer.status === 201, msg(transfer));
  const request = transfer.body.request;
  check("it is pending", request.status === "pending");
  check("and the ticket has not changed hands yet",
    (await call("GET", `/bookings/${third.booking.id}`, { token: bt }))
      .body.booking.tickets[0].passengerName === transferable.passengerName);

  const twiceTransfer = await call("POST", `/tickets/${transferable.id}/transfer`, {
    token: bt, body: { toNid: "1999000011113", toName: "Someone Else" },
  });
  check("a second request for the same ticket is refused", twiceTransfer.status === 409,
    `${twiceTransfer.status}`);

  console.log("\n  -- the queue --");
  const queues = await call("GET", "/approvals/queues", { token: at });
  check("the queues are listed", queues.status === 200, msg(queues));
  // Transfers and withdrawals. Abuse reports have their own review queue (7B).
  check("both kinds are registered", queues.body.queues?.length === 2,
    JSON.stringify(queues.body.queues?.map((q) => q.type)));
  const transferQueue = queues.body.queues.find((q) => q.type === "ticket_transfer");
  check("the transfer queue shows a pending request", transferQueue.pending >= 1,
    `${transferQueue.pending}`);
  check("and says this admin may decide it", transferQueue.canDecide === true);
  const withdrawalQueue = queues.body.queues.find((q) => q.type === "wallet_withdrawal");
  check("but not withdrawals", withdrawalQueue.canDecide === false);

  const passengerQueue = await call("GET", "/approvals/queues", { token: bt });
  check("a passenger cannot see the queue at all", passengerQueue.status === 403,
    `${passengerQueue.status}`);

  const mine = await call("GET", "/approvals/mine", { token: bt });
  check("but can see their own requests", mine.status === 200 &&
    mine.body.requests.some((r) => r.reference === request.reference), msg(mine));

  const listed = await call("GET", "/approvals?type=ticket_transfer&status=pending", { token: at });
  check("the queue lists it", listed.body.requests.some((r) => r.reference === request.reference));
  check("with a one-line summary a reviewer can act on",
    listed.body.requests.find((r) => r.reference === request.reference)?.summary?.includes("Karim Ahmed"),
    JSON.stringify(listed.body.requests.find((r) => r.reference === request.reference)?.summary));

  console.log("\n  -- deciding --");
  const passengerDecides = await call("POST", `/approvals/${request.reference}/decide`, {
    token: bt, body: { decision: "approve" },
  });
  check("a passenger cannot approve their own request", passengerDecides.status === 403,
    `${passengerDecides.status}`);

  const approved = await call("POST", `/approvals/${request.reference}/decide`, {
    token: at, body: { decision: "approve", note: "ID checked at the counter" },
  });
  check("an admin can", approved.status === 200, msg(approved));
  check("recorded as approved", approved.body.request.status === "approved");
  check("with who decided it", approved.body.request.decidedById === admin.user.id);
  check("and why", approved.body.request.decisionNote === "ID checked at the counter");

  const movedTicket = (await call("GET", `/bookings/${third.booking.id}`, { token: bt }))
    .body.booking.tickets.find((t) => t.id === transferable.id);
  check("the ticket now names the new passenger", movedTicket.passengerName === "Karim Ahmed",
    movedTicket.passengerName);
  check("under the new National ID", movedTicket.passengerNid === "1999000011112");

  const decideAgain = await call("POST", `/approvals/${request.reference}/decide`, {
    token: at, body: { decision: "reject" },
  });
  check("a decided request cannot be decided again", decideAgain.status === 409,
    `${decideAgain.status}: ${msg(decideAgain)}`);

  /* ---------------------------------------------------------------- */
  console.log("\n== withdrawing money ==");
  const balance = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  if (balance < 20000) {
    await call("POST", `/wallet/user/${buyer.user.id}/adjust`, {
      token: st, body: { amount: 500, direction: "credit", description: "Phase 6: withdrawal test" },
    });
  }
  const fundedBalance = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;

  const tooMuch = await call("POST", "/wallet/withdraw", {
    token: bt, body: { amount: fundedBalance / 100 + 5000, destination: "01700000000" },
  });
  check("more than the balance is refused", tooMuch.status === 400, msg(tooMuch));

  const noDestination = await call("POST", "/wallet/withdraw", {
    token: bt, body: { amount: 100, destination: "x" },
  });
  check("a missing destination is refused", noDestination.status === 400, `${noDestination.status}`);

  const withdraw = await call("POST", "/wallet/withdraw", {
    token: bt, body: { amount: 100, destination: "01712345678", reason: "Not travelling after all" },
  });
  check("requested", withdraw.status === 201, msg(withdraw));
  const wr = withdraw.body.request;

  const balanceWhilePending = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  check("nothing leaves the wallet while it waits", balanceWhilePending === fundedBalance,
    `${fundedBalance} -> ${balanceWhilePending}`);

  const adminTries = await call("POST", `/approvals/${wr.reference}/decide`, {
    token: at, body: { decision: "approve" },
  });
  check("an admin cannot approve a withdrawal", adminTries.status === 403, `${adminTries.status}`);

  const paid = await call("POST", `/approvals/${wr.reference}/decide`, {
    token: st, body: { decision: "approve", note: "Verified" },
  });
  check("a super admin can", paid.status === 200, msg(paid));

  const afterWithdrawal = (await call("GET", "/wallet", { token: bt })).body.wallet.balanceMinor;
  check("the money left the wallet", afterWithdrawal === fundedBalance - 10000,
    `${fundedBalance} -> ${afterWithdrawal}`);
  check("the ledger still balances",
    (await call("GET", "/wallet/verify", { token: bt })).body.consistent === true);

  const entries = (await call("GET", "/wallet/transactions", { token: bt })).body.transactions;
  check("recorded as a withdrawal", entries[0]?.reason === "withdrawal", entries[0]?.reason);
  check("naming who approved it", /approved by/.test(entries[0]?.description || ""),
    entries[0]?.description);

  console.log("\n  -- withdrawing a request --");
  const second_wr = await call("POST", "/wallet/withdraw", {
    token: bt, body: { amount: 100, destination: "01712345678" },
  });
  check("raised", second_wr.status === 201, msg(second_wr));
  const cancelled = await call("POST", `/approvals/${second_wr.body.request.reference}/cancel`, {
    token: bt,
  });
  check("the requester can withdraw it", cancelled.status === 200, msg(cancelled));
  check("marked cancelled", cancelled.body.request.status === "cancelled");

  const strangerCancel = await call("POST", `/approvals/${wr.reference}/cancel`, { token: xt });
  check("someone else cannot", strangerCancel.status === 403 || strangerCancel.status === 404,
    `${strangerCancel.status}`);

  /* ---------------------------------------------------------------- */
  console.log("\n== jobs ==");
  const jobs = (await call("GET", "/trips/jobs", { token: at })).body.jobs;
  check("the refund-closing job is registered",
    jobs.some((j) => j.name === "refund.close"), JSON.stringify(jobs.map((j) => j.name)));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
