// The seat map: every seat, sold and free, and what holds the taken ones.
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

const DHAKA = 1, TANGAIL = 4, SETU = 5, DINAJPUR = 15;

(async () => {
  const buyer = await login("unittest-user@example.com");
  const admin = await login("unittest-admin@example.com");
  const planner = await login("unittest-planner@example.com");
  const su = await login("unittest-super1@example.com");
  const bt = buyer.accessToken, at = admin.accessToken, pt = planner.accessToken, st = su.accessToken;

  const trips = (await call("GET", "/trips?trainId=1&limit=50", { token: at })).body.trips
    .filter((t) => t.status === "scheduled" && t.seatCount > 0);
  let trip = trips[trips.length - 1];
  for (const t of trips) {
    const o = await call("GET", `/trips/${t.id}/occupancy`, { token: at });
    if (o.body?.seats?.some((s) => s.state === "sold")) {
      trip = t;
      break;
    }
  }

  console.log(`Ekota ${trip.departureDate} (trip ${trip.id})\n`);

  console.log("== who may look ==");
  check("a planner cannot — no inventory:view",
    (await call("GET", `/trips/${trip.id}/occupancy`, { token: pt })).status === 403);
  check("a passenger cannot either",
    (await call("GET", `/trips/${trip.id}/occupancy`, { token: bt })).status === 403);

  const whole = await call("GET", `/trips/${trip.id}/occupancy`, { token: at });
  check("an operator can", whole.status === 200, msg(whole));

  console.log("\n== the whole departure, with no pair given ==");
  check("every seat is listed, not only the free ones",
    whole.body.seats.length === whole.body.totalSeats, `${whole.body.seats.length} of ${whole.body.totalSeats}`);
  check("the counts add up to the total",
    whole.body.availableCount + whole.body.soldCount + whole.body.heldCount +
      whole.body.blockedCount + whole.body.reservedCount === whole.body.totalSeats,
    JSON.stringify({
      free: whole.body.availableCount, sold: whole.body.soldCount, held: whole.body.heldCount,
      blocked: whole.body.blockedCount, reserved: whole.body.reservedCount, total: whole.body.totalSeats,
    }));
  check("every seat knows its coach and position",
    whole.body.seats.every((s) => s.coachCode && Number.isInteger(s.rowIndex)),
    JSON.stringify(whole.body.seats[0]));
  check("and carries a state the map can colour",
    whole.body.seats.every((s) =>
      ["available", "sold", "held", "blocked", "reserved"].includes(s.state)),
    JSON.stringify([...new Set(whole.body.seats.map((s) => s.state))]));

  console.log("\n== a sold seat names the journey that took it ==");
  const sold = whole.body.seats.filter((s) => s.state === "sold");
  check("some seats are sold", sold.length > 0, `${sold.length}`);
  if (!sold.length) { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(1); }

  const one = sold[0];
  const occupant = one.occupiedBy[0];
  check("it says which stretch", !!occupant.fromStation && !!occupant.toStation,
    JSON.stringify(occupant));
  check("and which booking", !!occupant.bookingReference, JSON.stringify(occupant.bookingReference));
  check("and which ticket", !!occupant.ticketNumber);
  check("and which segments it holds", Array.isArray(occupant.segments) && occupant.segments.length > 0,
    JSON.stringify(occupant.segments));
  console.log(`  seat ${one.seatNumber}: ${occupant.fromStation} → ${occupant.toStation}, ${occupant.bookingReference}`);

  console.log("\n== identity rides on a different permission ==");
  check("an operator with booking:view_all sees the passenger",
    !!occupant.passengerName, "no passenger name for an admin who may see bookings");

  // A role that can read inventory but not bookings.
  const roles = (await call("GET", "/roles", { token: st })).body.roles;
  let seatOnly = roles.find((r) => r.name === "seatmap-only");
  if (!seatOnly) {
    const made = await call("POST", "/roles", {
      token: st,
      body: {
        name: "seatmap-only",
        description: "Reads the seat map but not bookings — for testing the identity split.",
        permissions: ["inventory:view", "trip:view"],
      },
    });
    seatOnly = made.body.role;
  }
  check("a seat-map-only role exists", !!seatOnly, JSON.stringify(seatOnly));

  const target = (await call("GET", "/users?search=unittest-target", { token: st })).body.users?.[0];
  const originalRoles = (target?.roles || []).map((r) => r.id);
  await call("PUT", `/users/${target.id}/roles`, { token: st, body: { roleIds: [seatOnly.id] } });

  const limited = await login("unittest-target@example.com");
  const limitedView = await call("GET", `/trips/${trip.id}/occupancy`, { token: limited.accessToken });

  check("they can read the seat map", limitedView.status === 200, msg(limitedView));
  if (limitedView.status === 200) {
    const theirSold = limitedView.body.seats.filter((s) => s.state === "sold");
    check("and still see which seats are sold", theirSold.length > 0, `${theirSold.length}`);
    check("and over which stretch",
      theirSold[0].occupiedBy[0]?.fromStation !== undefined,
      JSON.stringify(theirSold[0].occupiedBy[0]));
    check("but NOT the passenger's name",
      theirSold.every((s) => s.occupiedBy.every((o) => o.passengerName === undefined)),
      "a passenger name leaked to a role without booking:view_all");
    check("nor their National ID",
      theirSold.every((s) => s.occupiedBy.every((o) => o.passengerNid === undefined)));
  }

  // Put the account back as it was.
  await call("PUT", `/users/${target.id}/roles`, { token: st, body: { roleIds: originalRoles } });
  const restored = await login("unittest-target@example.com");
  check("the borrowed account is handed back",
    restored.permissions.includes("booking:create"), JSON.stringify(restored.permissions));

  console.log("\n== narrowed to one stretch ==");
  const leg = await call("GET",
    `/trips/${trip.id}/occupancy?fromStationId=${DHAKA}&toStationId=${TANGAIL}`, { token: at });
  check("served", leg.status === 200, msg(leg));
  check("its segment list is just that stretch", leg.body.segments.length === 2,
    JSON.stringify(leg.body.segments));

  // A seat sold on a stretch that does NOT overlap reads free here, but still
  // shows its occupancy in the fuller picture — the thing the dialog opens on.
  const freeHereButBusyElsewhere = leg.body.seats.find(
    (s) => s.state === "available" && s.allOccupants.length > 0
  );
  check("a seat free here can still be busy elsewhere on the route",
    !!freeHereButBusyElsewhere,
    "no seat was free on this stretch while sold on another");

  if (freeHereButBusyElsewhere) {
    const elsewhere = freeHereButBusyElsewhere.allOccupants[0];
    console.log(`  seat ${freeHereButBusyElsewhere.seatNumber}: free Dhaka→Tangail, but sold ${elsewhere.fromStation} → ${elsewhere.toStation}`);
    check("and the fuller picture names it",
      !!elsewhere.fromStation && !!elsewhere.toStation, JSON.stringify(elsewhere));
    check("while what clashes with THIS stretch is empty",
      freeHereButBusyElsewhere.occupiedBy.length === 0,
      JSON.stringify(freeHereButBusyElsewhere.occupiedBy));
  }

  console.log("\n== it agrees with plain availability ==");
  const plain = await call("GET",
    `/trips/${trip.id}/availability?fromStationId=${DHAKA}&toStationId=${DINAJPUR}`, { token: at });
  const mapped = await call("GET",
    `/trips/${trip.id}/occupancy?fromStationId=${DHAKA}&toStationId=${DINAJPUR}`, { token: at });
  check("the free count matches",
    plain.body.availableCount === mapped.body.availableCount,
    `availability ${plain.body.availableCount}, map ${mapped.body.availableCount}`);
  check("and the same seats are the free ones",
    JSON.stringify(plain.body.available.map((s) => s.id).sort((a, b) => a - b)) ===
      JSON.stringify(mapped.body.seats.filter((s) => s.state === "available").map((s) => s.id).sort((a, b) => a - b)),
    "the two views disagree about which seats are free");

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("harness error:", e); process.exit(1); });
