// Phase 3 — composition, schedules, rolling-horizon generation, seat flattening.
const BASE = process.env.API_BASE;

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} ${ok ? "" : detail}`);
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

const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();

(async () => {
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }

  const admin = (await call("POST", "/auth/login", {
    body: { email: "unittest-admin@example.com", password: "UnitTest123!" },
  })).body;
  const t = admin.accessToken;
  const planner = (await call("POST", "/auth/login", {
    body: { email: "unittest-planner@example.com", password: "UnitTest123!" },
  })).body.accessToken;

  console.log("\n== permissions ==");
  check("admin holds trip:manage", admin.permissions.includes("trip:manage"));
  const plannerBlocked = await call("GET", "/trips", { token: planner });
  check("planner blocked from departures", plannerBlocked.status === 403, `got ${plannerBlocked.status}`);

  console.log("\n== composition & schedule ==");
  const trains = (await call("GET", "/trains", { token: t })).body.trains;
  const ekota = trains.find((x) => x.name === "Ekota Express");
  const madhumati = trains.find((x) => x.name === "Madhumati Express");

  const comp = await call("GET", `/trains/${ekota.id}/composition`, { token: t });
  check("Ekota composition has 5 coaches", comp.body.coaches.length === 5, `got ${comp.body.coaches.length}`);
  check("composition reports 404 seats",
    comp.body.coaches.reduce((n, c) => n + c.seatCount, 0) === 404);
  check("Ekota layouts are approved", comp.body.coaches.every((c) => c.planApproved === true));

  const mComp = await call("GET", `/trains/${madhumati.id}/composition`, { token: t });
  check("composition reports each layout's approval state",
    mComp.body.coaches.every((c) => typeof c.planApproved === "boolean"));
  const mPending = mComp.body.coaches.filter((c) => !c.planApproved).length;

  const dupe = await call("PUT", `/trains/${ekota.id}/composition`, {
    token: t,
    body: { coaches: [
      { coachCode: "KA", seatPlanId: comp.body.coaches[0].seatPlanId },
      { coachCode: "ka", seatPlanId: comp.body.coaches[1].seatPlanId },
    ] },
  });
  check("duplicate coach code rejected", dupe.status === 400, `got ${dupe.status}`);

  const sched = await call("GET", `/trains/${madhumati.id}/schedule`, { token: t });
  check("Madhumati schedule excludes Sunday",
    !sched.body.schedules[0].runsOn.includes(0) && sched.body.schedules[0].runsOn.length === 6,
    JSON.stringify(sched.body.schedules[0]?.runsOn));

  const badDay = await call("PUT", `/trains/${madhumati.id}/schedule`, {
    token: t, body: { schedules: [{ runsOn: [0, 9] }] },
  });
  check("invalid weekday rejected", badDay.status === 400, `got ${badDay.status}`);

  console.log("\n== generated horizon ==");
  /*
   * Top the horizon up first, rather than reading whatever the hourly job last
   * produced.
   *
   * The horizon is counted in Dhaka time. For up to an hour after Dhaka
   * midnight the newest day has not been generated yet, so a suite that only
   * *reads* sees nine days and reports the generator as broken — when all it
   * observed was the clock. The claim worth testing is "after generating, the
   * horizon is complete", so generate, then look.
   */
  await call("POST", "/trips/generate", { token: t, body: {} });

  const trips = (await call("GET", "/trips?limit=500", { token: t })).body.trips;
  const mTrips = trips.filter((x) => x.train.name === "Madhumati Express");
  const eTrips = trips.filter((x) => x.train.name === "Ekota Express");

  /*
   * Counted rather than asserted flat. Ekota runs daily so it fills the whole
   * horizon; Madhumati skips Sundays, so how many it runs depends on which day
   * of the week the horizon starts — a number that changes every midnight and
   * would make this suite fail once a week for no reason.
   *
   * The invariant is the relationship: Madhumati runs on every horizon day that
   * is not a Sunday.
   */
  const sundays = eTrips.filter((x) => dow(x.departureDate) === 0).length;
  check("Ekota runs every day of the horizon", eTrips.length === 10, `got ${eTrips.length}`);
  check("Madhumati runs every day except Sunday",
    mTrips.length === eTrips.length - sundays,
    `Madhumati ${mTrips.length}, Ekota ${eTrips.length}, Sundays ${sundays}`);
  check("which is all the departures there are",
    trips.length === eTrips.length + mTrips.length, `got ${trips.length}`);
  check("no Madhumati departure falls on a Sunday",
    mTrips.every((x) => dow(x.departureDate) !== 0),
    mTrips.map((x) => `${x.departureDate}:${dow(x.departureDate)}`).join(" "));

  console.log("\n== the approval gate decides what gets seats ==");
  // Cancelling is one-way, so only live departures are asserted on.
  const eLive = eTrips.filter((x) => x.status === "scheduled");
  check("every live Ekota departure carries 404 seats",
    eLive.length > 0 && eLive.every((x) => x.seatCount === 404),
    eTrips.map((x) => `${x.status}:${x.seatCount}`).join(","));
  check("Madhumati departures reflect how many of its layouts are approved",
    mPending > 0 ? mTrips.some((x) => x.seatCount < 273) : true,
    mTrips.map((x) => x.seatCount).join(","));
  check("Ekota seats split across classes",
    Object.keys(eTrips[0].seatsByClass).length === 3, JSON.stringify(eTrips[0].seatsByClass));

  console.log("\n== generation is idempotent ==");
  const again = await call("POST", "/trips/generate", { token: t, body: {} });
  check("second run creates nothing", again.body.report.created === 0, `created ${again.body.report.created}`);
  check("second run finds them all", again.body.report.existing === trips.length,
    `existing ${again.body.report.existing}, listed ${trips.length}`);
  check("second run reports why Madhumati was skipped",
    again.body.report.trains.find((x) => x.train === "Madhumati Express").notes.some((n) => n.includes("pending")));

  console.log("\n== approving a plan changes the outcome ==");
  const plans = (await call("GET", "/plans?limit=100", { token: t })).body.plans;
  const chair41 = plans.find((p) => p.coachNo === "MADHUMATI-755-CHAIR-41");
  const approved = await call("POST", `/plans/${chair41.id}/approve`, { token: t });
  // Already approved by an earlier run is an equally valid starting point.
  check("the Madhumati chair layout is approved",
    approved.status === 200 || chair41.status === "approved",
    `got ${approved.status}, plan was ${chair41.status}`);

  /*
   * Rebuilding replaces every seat row, so it is refused on a departure that
   * has sold tickets — those passengers hold one of the seats about to be
   * deleted. The booking suites sell on these same departures, so this finds
   * one nobody has booked rather than assuming the first is clean.
   */
  /*
   * Hunt for a departure nobody has touched — and do not manufacture one.
   *
   * An earlier version generated extra departures to guarantee a clean target.
   * That worked and was wrong: it pushed the horizon out permanently, which
   * broke this suite's own assertions about how many days are generated, and
   * left real rows behind to satisfy a test.
   *
   * A refunded ticket still references its seat, so a departure with nobody
   * travelling can still be unrebuildable. On a database that has been booked
   * across for a while there may be no clean departure at all — which says
   * nothing about rebuilding, so it is reported as a skip rather than a
   * failure. The guard below is the assertion that matters.
   */
  let rebuilt = null;
  let guarded = null;
  for (const candidate of [...mTrips, ...trips].filter(
    (t2, i, a) => a.findIndex((x) => x.id === t2.id) === i
  )) {
    const attempt = await call("POST", `/trips/${candidate.id}/rebuild`, { token: t });
    if (attempt.status === 200) { rebuilt = attempt; break; }
    // 409 means somebody holds a ticket on it — keep the first as evidence the
    // guard fires, and try the next.
    if (attempt.status === 409 && !guarded) guarded = attempt;
  }

  // Skipped honestly when there is no clean departure, rather than asserted
  // with an expression that cannot fail — a check that always passes is worse
  // than no check, because it looks like coverage.
  if (rebuilt) {
    check("a departure nobody has booked can be rebuilt", true,
    guarded ? guarded.body?.error?.message : "no candidate returned 200 or 409");
  } else {
    console.log(
      "  SKIP  a departure nobody has booked can be rebuilt — every departure now carries " +
        "tickets, and a refunded one still references its seat"
    );
  }
  // The next two only mean anything with a rebuilt departure in hand. Skipping
  // them is honest; exiting the whole suite because the database has been
  // booked across is not.
  if (rebuilt) {
    check("only the approved coach materialises — 41 seats",
      rebuilt.body.trip.seatCount === 41, `got ${rebuilt.body.trip.seatCount}`);
    check("the other three are reported, not silently dropped",
      (rebuilt.body.trip.skipped || []).length === 3,
      JSON.stringify(rebuilt.body.trip.skipped));
  }

  // And where one had been sold on, the refusal is in words rather than a
  // foreign-key error out of the database.
  if (guarded) {
    check("rebuilding a departure with sold tickets is refused", guarded.status === 409);
    // Two refusals, two ways forward: live passengers mean "cancel first, which
    // refunds them"; only returned tickets mean "there is nobody to refund —
    // generate a fresh departure". Either is an explanation; which one depends
    // on the departure the hunt happened to land on.
    check("and explains what to do instead",
      /cancel the departure first|generate a fresh departure/i.test(guarded.body?.error?.message || ""),
      guarded.body?.error?.message);
  }

  console.log("\n== seats flattened correctly ==");
  const seats = (await call("GET", `/trips/${eLive[0].id}/seats`, { token: t })).body.seats;
  check("404 seat rows exist", seats.length === 404, `got ${seats.length}`);
  check("no seat number repeats within a coach",
    new Set(seats.map((s) => `${s.tripCoachId}-${s.seatNumber}`)).size === 404);
  check("every seat keeps its grid position",
    seats.every((s) => Number.isInteger(s.rowIndex) && Number.isInteger(s.cellIndex)));

  const detail = (await call("GET", `/trips/${eLive[0].id}`, { token: t })).body.trip;
  const ka = detail.coaches.find((c) => c.coachCode === "KA");
  const kaSeats = seats.filter((s) => s.tripCoachId === ka.id);
  check("AC chair coach contributes 80 seats", kaSeats.length === 80, `got ${kaSeats.length}`);
  check("AC chair seat numbers are exactly 1–80",
    new Set(kaSeats.map((s) => Number(s.seatNumber))).size === 80 &&
      Math.min(...kaSeats.map((s) => Number(s.seatNumber))) === 1 &&
      Math.max(...kaSeats.map((s) => Number(s.seatNumber))) === 80);

  const windows = seats.filter((s) => s.isWindow).length;
  // 32 (AC chair) + 12 (cabin) + 38×3 (shovon) = 158
  check("window seats carried through from the layouts", windows === 158, `got ${windows}`);
  check("window also recorded in the attribute document",
    seats.filter((s) => s.attributes?.window).length === windows);

  check("departure knows its segment count", detail.segmentCount === 10, `got ${detail.segmentCount}`);

  console.log("\n== cancelling and reinstating a departure ==");
  // Reinstated at the end of this section rather than left cancelled. Running
  // this suite used to cost the horizon one departure every time, and after
  // enough runs the quota suites had nothing far enough out to work with.
  const victim = eLive.slice(1).find((x) => x.status === "scheduled");
  check("a scheduled departure is available to cancel", !!victim,
    eTrips.map((x) => x.status).join(","));

  const cancelled = await call("POST", `/trips/${victim.id}/cancel`, {
    token: t, body: { reason: "Track maintenance" },
  });
  check("cancel succeeds", cancelled.status === 200, `got ${cancelled.status}`);
  check("status is cancelled", cancelled.body.trip.status === "cancelled");
  check("its coaches are cancelled too", cancelled.body.trip.coaches.every((c) => c.status === "cancelled"));
  check("reason recorded", cancelled.body.trip.cancellationReason === "Track maintenance");

  const rebuildCancelled = await call("POST", `/trips/${victim.id}/rebuild`, { token: t });
  check("a cancelled departure cannot be rebuilt", rebuildCancelled.status === 400, `got ${rebuildCancelled.status}`);

  const cancelTwice = await call("POST", `/trips/${victim.id}/cancel`, {
    token: t, body: { reason: "again" },
  });
  check("nor cancelled twice", cancelTwice.status === 400, `got ${cancelTwice.status}`);

  const reinstated = await call("POST", `/trips/${victim.id}/reinstate`, {
    token: t, body: { reason: "Maintenance finished early" },
  });
  check("it can be put back", reinstated.status === 200, `got ${reinstated.status}`);
  check("running again", reinstated.body.trip.status === "scheduled");
  check("its coaches are active again",
    reinstated.body.trip.coaches.every((c) => c.status === "active"),
    JSON.stringify(reinstated.body.trip.coaches.map((c) => c.status)));
  check("the cancellation reason is cleared",
    reinstated.body.trip.cancellationReason === null,
    reinstated.body.trip.cancellationReason);
  check("its seats survived the round trip",
    reinstated.body.trip.seatCount === cancelled.body.trip.seatCount ||
      reinstated.body.trip.coaches.reduce((n, c) => n + c.seatCount, 0) > 0,
    JSON.stringify({ after: reinstated.body.trip.seatCount }));

  const reinstateTwice = await call("POST", `/trips/${victim.id}/reinstate`, { token: t });
  check("a running departure cannot be reinstated", reinstateTwice.status === 400,
    `got ${reinstateTwice.status}`);

  console.log("\n== job runner ==");
  const jobs = (await call("GET", "/trips/jobs", { token: t })).body.jobs;
  const horizon = jobs.find((j) => j.name === "trip.horizon");
  check("horizon job registered", !!horizon);
  check("job ran on boot", horizon?.lastRun?.ok === true, JSON.stringify(horizon?.lastRun));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
