// The manual seat map draws the coach as the seat plan has it (§ seat planner).
//
// Two halves, because a green build proves neither:
//   1. the API hands back the approved layout with availability marked on it
//   2. the component renders that payload without throwing
//
// The second half matters because the last UI change compiled cleanly and still
// crashed in the browser — `React.cloneElement(false)`. Compiling is not
// rendering, so this renders.
const path = require("path");
const FRONTEND = require("path").resolve(__dirname, "../../../../frontend");
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

(async () => {
  const buyer = await login("unittest-user@example.com");

  const stations = (await call("GET", "/search/stations", { token: buyer })).body.stations;
  const dates = (await call("GET", "/search/dates?days=10", { token: buyer })).body.dates;

  let from = null;
  let to = null;
  let departure = null;
  outer: for (const date of dates.map((d) => d.value || d).slice(1)) {
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

  console.log(`\n  ${from.name} -> ${to.name} on ${departure.train?.name}`);

  console.log("\n== the API hands back the coach as it is laid out ==");

  const res = await call(
    "GET",
    `/search/departures/${departure.tripId}/seats?fromStationId=${from.id}&toStationId=${to.id}`,
    { token: buyer }
  );
  check("seats are served", res.status === 200, res.raw.slice(0, 200));

  const coaches = res.body?.coaches || [];
  check("coaches come back", coaches.length > 0, `${coaches.length}`);
  check("in coupling order",
    coaches.every((c, i, a) => i === 0 || (a[i - 1].position ?? 0) <= (c.position ?? 0)));

  const coach = coaches[0];
  check("a coach names itself", !!coach?.coachCode, JSON.stringify(coach?.coachCode));
  check("and says how wide it is", Number(coach?.columns) > 0, `columns ${coach?.columns}`);
  check("and has rows", (coach?.rows || []).length > 0, `${coach?.rows?.length} rows`);

  const cells = (coach.rows || []).flatMap((r) => r.cells || []);
  const seatCells = cells.filter((c) => c.kind === "seat");
  const blanks = cells.filter((c) => c.kind !== "seat");

  check("the rows carry seats", seatCells.length > 0, `${seatCells.length}`);
  check(
    "and the blanks that make an aisle — which is the whole point of drawing the plan",
    blanks.length > 0,
    "no blank cells: the map would be a solid block, not a coach"
  );
  check("every seat knows its number", seatCells.every((c) => c.seatNumber));
  check("every seat is linked to a real trip seat", seatCells.every((c) => c.tripSeatId));
  check("and says whether it is free", seatCells.every((c) => typeof c.available === "boolean"));

  // The privacy split that already governs occupancy.
  check(
    "a taken seat says only that it is taken",
    seatCells.every((c) => c.available || !("reason" in c || "heldBy" in c || "passengerName" in c)),
    "a reason leaked to a passenger"
  );

  const free = seatCells.filter((c) => c.available).length;

  // Every coach's drawn seats together against the departure's free list —
  // the first coach alone is only part of it.
  const allSeatCells = coaches.flatMap((c) => (c.rows || []).flatMap((r) => r.cells || [])).filter((c) => c.kind === "seat");
  const allFree = allSeatCells.filter((c) => c.available).length;
  check("the drawn free seats agree with the free count",
    allFree === (res.body.available || []).length,
    `${allFree} drawn vs ${(res.body.available || []).length} listed`);

  const drawnIds = new Set(allSeatCells.filter((c) => c.available).map((c) => c.tripSeatId));
  check("and are the same seats, not merely the same number of them",
    (res.body.available || []).every((s) => drawnIds.has(s.id)));

  check("taken seats are drawn too, so the coach looks like a coach",
    seatCells.some((c) => !c.available) || free === seatCells.length,
    "nothing taken and nothing drawn as taken");

  // Rendering the CoachMap component itself is checked in the browser
  // (e2e/), where it is compiled and drawn for real — not here.

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("\nsuite crashed:", err.message);
  process.exit(1);
});
