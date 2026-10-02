// Confirms the imported seat plans are queryable and pending, and exercises the
// exact global-search algorithm the plans page uses.
const BASE = process.env.API_BASE;

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} ${ok ? "" : detail}`);
};

const LABELS = { draft: "Draft", pending: "Pending", approved: "Approved", rejected: "Rejected" };

// Mirrors frontend/src/app/dashboard/plans/page.js
const searchIndex = (row) =>
  [
    row.coachNo, row.trainName?.name, row.coachType?.name, row.coachClass?.name,
    row.status, LABELS[row.status], row.createdBy?.fullName, row.createdBy?.email,
    row.approvedBy?.fullName, row.rejectionReason,
    new Date(row.updatedAt).toLocaleString(), new Date(row.createdAt).toLocaleDateString(),
  ].filter(Boolean).join(" ").toLowerCase();

function filter(rows, search) {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return rows;
  return rows.filter((r) => terms.every((t) => searchIndex(r).includes(t)));
}

(async () => {
  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin1@example.com", password: "Admin123!" }),
  });
  const { accessToken } = await login.json();

  const res = await fetch(`${BASE}/plans`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const { plans } = await res.json();

  console.log("\n== imported data ==");
  check("plans are readable", Array.isArray(plans) && plans.length >= 18, `got ${plans?.length}`);
  // The fixture approves the four plans the departures are built from.
  check("the 14 plans not yet approved are pending",
    plans.filter((p) => p.status === "pending").length === 14,
    `got ${plans.filter((p) => p.status === "pending").length}`);
  check("reference data is joined", !!plans[0]?.trainName?.name && !!plans[0]?.coachClass?.name);
  check("author recorded", plans.every((p) => p.createdBy?.email === "planner1@example.com"));

  const trains = [...new Set(plans.map((p) => p.trainName?.name))].sort();
  console.log(`  trains: ${trains.join(", ")}`);

  console.log("\n== global search ==");
  const cases = [
    ["ekota", 3],
    ["snigdha", 3],
    ["sundarban", 2],
    // 4, not 3: "Vacuum Coach" contains "ac", and that coach is a Shovon Chair.
    ["ac chair", 4],
    ["pending", 14],
    ["105", 1],
    ["cabin", 3],
    // 2, not 1: "Non-AC Cabin" also contains "ac".
    ["ekota ac", 2],          // two terms, different columns
    ["AC EKOTA", 2],          // order and case independent
    ["planner", 18],          // matches the author field
    ["zzzz", 0],
  ];

  for (const [term, expected] of cases) {
    const got = filter(plans, term).length;
    check(`"${term}" → ${expected}`, got === expected, `got ${got}`);
  }

  console.log("\n  sample — \"ekota ac\":");
  for (const p of filter(plans, "ekota ac")) {
    console.log(`    ${p.trainName.name} · ${p.coachClass.name} · ${p.coachNo}`);
  }

  check("empty search returns everything", filter(plans, "   ").length === plans.length);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
