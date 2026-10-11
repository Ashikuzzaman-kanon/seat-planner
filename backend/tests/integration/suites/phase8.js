// Phase 8A — changing the coaches on a departure (§14.1).
//
// ## Why this suite adds its own coaches
//
// Cancelling a coach refunds everybody on it. Run against an existing coach,
// this suite would refund whoever had bought seats there while testing the app
// by hand. So it only ever acts on coaches it put on the departure itself, and
// only cancels one carrying nothing but its own ticket.
//
// What it leaves behind, deliberately: one cancelled coach per run, holding one
// refunded ticket. Financial history is not something a test should delete —
// the buyer's wallet was credited, and removing the refund would leave a ledger
// entry pointing at nothing. The coach is out of sale, so it changes nothing
// anybody can buy.
const BASE = process.env.API_BASE;
const BACKEND = require("path").resolve(__dirname, "../../..");

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

// A code nothing else will have. Coach codes are unique per departure.
const code = (prefix) => `${prefix}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

(async () => {
  const buyer = await login("unittest-user@example.com");
  const admin = await login("unittest-admin@example.com");
  const planner = await login("unittest-planner@example.com");

  await call("POST", "/wallet/topup", { token: buyer, body: { amount: 20000 } });

  /* ---------------- A departure to work on ---------------- */

  const trips = (await call("GET", "/trips?limit=200", { token: admin })).body.trips || [];
  const today = new Date().toISOString().slice(0, 10);
  // Well ahead, so buying is open and nothing has departed.
  const trip = trips
    .filter((t) => t.status === "scheduled" && t.departureDate > today)
    .sort((a, b) => (a.departureDate < b.departureDate ? 1 : -1))[0];
  if (!trip) {
    console.error("no future departure to work on");
    process.exit(1);
  }

  const { sequelize, SeatPlan } = require(`${BACKEND}/src/models`);
  const plan = await SeatPlan.findOne({ where: { status: "approved" }, order: [["id", "ASC"]] });
  const draft = await SeatPlan.findOne({ where: { status: ["draft", "pending"] } });
  await sequelize.close();

  console.log(`\n  trip ${trip.id} (${trip.departureDate}), plan ${plan.id}`);

  const before = (await call("GET", `/trips/${trip.id}/coaches`, { token: admin })).body;
  check("a departure's coaches can be listed", Array.isArray(before?.coaches),
    JSON.stringify(before).slice(0, 200));
  const coachesBefore = before.coaches.length;

  /* ---------------- Who may do what ---------------- */

  console.log("\n== who may do what ==");

  const plannerAdd = await call("POST", `/trips/${trip.id}/coaches`, {
    token: planner,
    body: { seatPlanId: plan.id, coachCode: code("P") },
  });
  check("a planner cannot add coaches", plannerAdd.status === 403, `${plannerAdd.status}`);

  /* ---------------- Adding ---------------- */

  console.log("\n== adding a coach ==");

  if (draft) {
    const fromDraft = await call("POST", `/trips/${trip.id}/coaches`, {
      token: admin,
      body: { seatPlanId: draft.id, coachCode: code("D") },
    });
    check("a coach cannot be built from an unapproved plan", fromDraft.status === 400,
      `${fromDraft.status} ${fromDraft.raw.slice(0, 160)}`);
  }

  const spareCode = code("S");
  const spare = await call("POST", `/trips/${trip.id}/coaches`, {
    token: admin,
    body: { seatPlanId: plan.id, coachCode: spareCode },
  });
  check("a coach can be added from an approved plan", spare.status === 201, spare.raw.slice(0, 200));
  check("with its seats built", spare.body?.seats > 0, `${spare.body?.seats} seats`);
  check("appended to the end of the train", spare.body?.position === coachesBefore + 1,
    `position ${spare.body?.position}, ${coachesBefore} coaches before`);

  const clash = await call("POST", `/trips/${trip.id}/coaches`, {
    token: admin,
    body: { seatPlanId: plan.id, coachCode: spareCode },
  });
  check("the same code twice is refused, with a sentence", clash.status === 409 &&
    /already/i.test(clash.body?.error?.message || ""), clash.raw.slice(0, 160));

  // Inserted mid-train, the coaches behind it move back.
  const middle = await call("POST", `/trips/${trip.id}/coaches`, {
    token: admin,
    body: { seatPlanId: plan.id, coachCode: code("M"), position: 1 },
  });
  check("a coach can be inserted at the front", middle.status === 201 && middle.body?.position === 1,
    middle.raw.slice(0, 160));

  const order = (await call("GET", `/trips/${trip.id}/coaches`, { token: admin })).body.coaches;
  const positions = order.map((c) => c.position);
  check("and the coupling order stays contiguous, no gaps and no duplicates",
    positions.every((p, i) => p === i + 1), JSON.stringify(positions));

  /* ---------------- Removing an unused coach ---------------- */

  console.log("\n== removing a coach nobody has used ==");

  const removedMiddle = await call("DELETE", `/trips/${trip.id}/coaches/${middle.body.coach.id}`, {
    token: admin,
  });
  check("an unused coach can be removed", removedMiddle.status === 200, removedMiddle.raw.slice(0, 200));

  const afterRemove = (await call("GET", `/trips/${trip.id}/coaches`, { token: admin })).body.coaches;
  check("and it is gone", !afterRemove.some((c) => c.id === middle.body.coach.id));
  check("with the gap it left closed up",
    afterRemove.map((c) => c.position).every((p, i) => p === i + 1),
    JSON.stringify(afterRemove.map((c) => c.position)));

  /* ---------------- A coach with a passenger on it ---------------- */

  console.log("\n== a coach carrying a passenger ==");

  const seats = (await call("GET", `/trips/${trip.id}/seats`, { token: admin })).body.seats || [];
  const onSpare = seats.filter((s) => s.tripCoachId === spare.body.coach.id);
  check("the added coach's seats are on the departure", onSpare.length === spare.body.seats,
    `${onSpare.length} vs ${spare.body.seats}`);

  // Buy one seat on it, for the whole route so it is certain to be free.
  const route = (await call("GET", `/search/departures/${trip.id}/route`, { token: buyer })).body;
  const stops = route?.stops || route?.route || [];
  const from = stops[0]?.stationId;
  const to = stops[stops.length - 1]?.stationId;

  const hold = await call("POST", "/holds", {
    token: buyer,
    body: { tripId: trip.id, seatIds: [onSpare[0].id], fromStationId: from, toStationId: to },
  });
  check("a seat on the new coach can be held", hold.status === 201, hold.raw.slice(0, 200));

  const bought = await call("POST", "/bookings", {
    token: buyer,
    body: {
      holdReference: hold.body?.hold?.reference,
      passengers: [{ name: "Coach Passenger", nid: "1990555544401", dob: "1990-02-02" }],
      method: "wallet",
    },
  });
  check("and bought", bought.status === 201, bought.raw.slice(0, 200));
  const ticket = (bought.body.booking || bought.body).tickets[0];

  const refusedRemove = await call("DELETE", `/trips/${trip.id}/coaches/${spare.body.coach.id}`, {
    token: admin,
  });
  check("a coach with a passenger cannot be removed", refusedRemove.status === 409,
    `${refusedRemove.status}`);
  check("and the refusal points at cancelling instead",
    /cancel the coach instead/i.test(refusedRemove.body?.error?.message || ""),
    refusedRemove.body?.error?.message);

  /* ---------------- Cancelling ---------------- */

  console.log("\n== cancelling a coach ==");

  const plannerCancel = await call("POST", `/trips/${trip.id}/coaches/${spare.body.coach.id}/cancel`, {
    token: planner,
    body: { reason: "Air conditioning failed" },
  });
  check("a planner cannot cancel a coach", plannerCancel.status === 403, `${plannerCancel.status}`);

  const noReason = await call("POST", `/trips/${trip.id}/coaches/${spare.body.coach.id}/cancel`, {
    token: admin,
    body: { reason: "" },
  });
  check("cancelling without a reason is refused — every passenger is told it",
    noReason.status === 400, `${noReason.status}`);

  const cancelled = await call("POST", `/trips/${trip.id}/coaches/${spare.body.coach.id}/cancel`, {
    token: admin,
    body: { reason: "Air conditioning failed at the depot" },
  });
  check("an admin can cancel it", cancelled.status === 200, cancelled.raw.slice(0, 250));
  check("its one passenger is refunded", cancelled.body?.refunded === 1,
    `${cancelled.body?.refunded} refunded`);
  check("in full", cancelled.body?.paidMinor === ticket.fareMinor,
    `${cancelled.body?.paidMinor} paid vs fare ${ticket.fareMinor}`);
  check("and the coach records why", cancelled.body?.coach?.cancellationReason?.includes("Air conditioning"),
    JSON.stringify(cancelled.body?.coach));

  const ticketNow = await call("GET", `/bookings/${(bought.body.booking || bought.body).id}`, {
    token: buyer,
  });
  const theTicket = (ticketNow.body?.booking || ticketNow.body)?.tickets?.[0];
  check("the ticket is now refunded", theTicket?.status === "refunded", theTicket?.status);

  const seatsAfter = await call(
    "GET",
    `/search/departures/${trip.id}/seats?fromStationId=${from}&toStationId=${to}`,
    { token: buyer }
  );
  check("and nothing on the cancelled coach is for sale",
    !(seatsAfter.body?.available || []).some((s) => s.tripCoachId === spare.body.coach.id),
    "a cancelled coach is still selling seats");

  const again = await call("POST", `/trips/${trip.id}/coaches/${spare.body.coach.id}/cancel`, {
    token: admin,
    body: { reason: "Twice" },
  });
  check("cancelling it twice is refused", again.status === 409, `${again.status}`);

  const stillCantRemove = await call("DELETE", `/trips/${trip.id}/coaches/${spare.body.coach.id}`, {
    token: admin,
  });
  check("a cancelled coach with history still cannot be removed",
    stillCantRemove.status === 409, "removing it would destroy the record of what was sold");

  /* ---------------- Reinstating ---------------- */

  console.log("\n== putting it back ==");

  const back = await call("POST", `/trips/${trip.id}/coaches/${spare.body.coach.id}/reinstate`, {
    token: admin,
    body: { reason: "Repaired" },
  });
  check("a cancelled coach can be reinstated", back.status === 200, back.raw.slice(0, 200));
  check("and says its passengers stay refunded",
    /stay refunded/i.test(back.body?.note || ""), back.body?.note);

  const onSale = await call(
    "GET",
    `/search/departures/${trip.id}/seats?fromStationId=${from}&toStationId=${to}`,
    { token: buyer }
  );
  check("its seats are on sale again",
    (onSale.body?.available || []).some((s) => s.tripCoachId === spare.body.coach.id));

  const stillRefunded = await call("GET", `/bookings/${(bought.body.booking || bought.body).id}`, {
    token: buyer,
  });
  check("but the refunded ticket was not quietly revived",
    (stillRefunded.body?.booking || stillRefunded.body)?.tickets?.[0]?.status === "refunded");

  // Leave it out of sale, so this run's coach sells nothing to anybody.
  await call("POST", `/trips/${trip.id}/coaches/${spare.body.coach.id}/cancel`, {
    token: admin,
    body: { reason: "Test coach retired after the suite" },
  });

  /* ---------------- Trip cancellation moved permission ---------------- */

  console.log("\n== cancelling a departure needs the higher permission ==");

  const plannerTrip = await call("POST", `/trips/${trip.id}/cancel`, { token: planner });
  check("a planner cannot cancel a departure", plannerTrip.status === 403, `${plannerTrip.status}`);

  const after = (await call("GET", `/trips/${trip.id}/coaches`, { token: admin })).body.coaches;
  check("the departure is otherwise as it was, plus this run's retired coach",
    after.length === coachesBefore + 1, `${coachesBefore} -> ${after.length}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("\nsuite crashed:", err.message);
  process.exit(1);
});
