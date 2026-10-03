// Demo data on a database that already has data: everything that exists is
// adopted and left exactly as it is; only what is missing is created; and
// deleting takes away only that.
//
// The empty-database case (production's) is `demo-rehearsal.js`, against a
// separate database. This one runs on the development database, so it steps
// aside if somebody has populated demo data here on purpose.
const BACKEND = require("path").resolve(__dirname, "../../..");
require(`${BACKEND}/node_modules/dotenv`).config({ path: `${BACKEND}/.env` });
const mysql = require(`${BACKEND}/node_modules/mysql2/promise`);

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
const login = async (email, password = "UnitTest123!") => (await call("POST", "/auth/login", { body: { email, password } })).body;

async function runJob(token, action) {
  const started = await call("POST", `/demo-data/${action}`, { token });
  if (started.status !== 202) return { started };
  for (let i = 0; i < 600; i++) {
    const { body } = await call("GET", `/jobs/${started.body.job.id}`, { token });
    if (body?.job && ["succeeded", "failed"].includes(body.job.status)) return { started, job: body.job };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { started, job: null };
}

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME,
  });
  const counts = async () => {
    const [tables] = await db.query("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [process.env.DB_NAME]);
    const out = {};
    for (const { t } of tables) out[t] = Number((await db.query(`SELECT COUNT(*) n FROM \`${t}\``))[0][0].n);
    return out;
  };

  const su = (await login("unittest-super1@example.com")).accessToken;
  const admin = (await login("unittest-admin@example.com")).accessToken;

  console.log("== access ==");
  const forbidden = await call("GET", "/demo-data", { token: admin });
  check("an admin without demo:manage is refused", forbidden.status === 403, `${forbidden.status}`);
  const forbiddenPost = await call("POST", "/demo-data/populate", { token: admin });
  check("and cannot populate either", forbiddenPost.status === 403, `${forbiddenPost.status}`);

  {
    const { User, Role } = require("../../../src/models");
    await User.destroy({ where: { email: ["checker1@example.com", "checker2@example.com"] } });
    await Role.destroy({ where: { name: "checker" } });
  }

  const before = await call("GET", "/demo-data", { token: su });
  check("the super admin can read the status", before.status === 200, JSON.stringify(before.body).slice(0, 200));
  if (before.body.populated) {
    console.log("\n  (demo data is populated on this database on purpose — not touching it)");
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
  }

  const baseline = await counts();
  const [[plansBefore]] = await db.query("SELECT COUNT(*) n, SUM(status = 'pending') pending, MAX(updated_at) touched FROM seat_plans");
  const [[adminRoleBefore]] = await db.query(
    "SELECT COUNT(*) n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.name = 'admin'");
  const [[planner1Before]] = await db.query("SELECT password_hash h, updated_at u FROM users WHERE email = 'planner1@example.com'");

  console.log("\n== populate over existing data ==");
  const run = await runJob(su, "populate");
  check("it succeeds", run.job?.status === "succeeded", JSON.stringify(run.job?.lastError || run.started.body));
  const r = run.job?.result || {};
  console.log(`      created: ${JSON.stringify(r.created)}`);
  const notes = (r.notes || []).join("\n");
  check("the only new rows are the checker role and its two accounts",
    JSON.stringify(Object.keys(r.created || {}).sort()) === JSON.stringify(["Role", "RolePermission", "User", "UserRole"]) &&
      r.created.Role === 1 && r.created.User === 2,
    JSON.stringify(r.created));
  check("no departures, seats or bookings were made", !r.created?.Trip && !r.seats && !r.created?.Booking, JSON.stringify(r));
  check("it says the existing demo accounts kept their passwords", /already existed and were left alone, passwords unchanged/.test(notes), notes);
  check("it says the seat plans were used as they are", /seat plans with the same coach numbers already existed/.test(notes), notes);
  check("and that the existing trains were left alone", /Ekota Express already existed/.test(notes) && /Madhumati Express already existed/.test(notes), notes);
  check("and why there are no sample bookings", /No sample bookings were made/.test(notes), notes);
  check("with no warnings", (r.warnings || []).length === 0, JSON.stringify(r.warnings));

  const [[plansAfter]] = await db.query("SELECT COUNT(*) n, SUM(status = 'pending') pending, MAX(updated_at) touched FROM seat_plans");
  check("existing seat plans are untouched — not re-approved, not reset",
    plansAfter.n === plansBefore.n && Number(plansAfter.pending) === Number(plansBefore.pending) && String(plansAfter.touched) === String(plansBefore.touched),
    `${JSON.stringify(plansBefore)} -> ${JSON.stringify(plansAfter)}`);
  const [[adminRoleAfter]] = await db.query(
    "SELECT COUNT(*) n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.name = 'admin'");
  check("the existing admin role keeps exactly its permissions", adminRoleAfter.n === adminRoleBefore.n, `${adminRoleBefore.n} -> ${adminRoleAfter.n}`);
  const [[planner1After]] = await db.query("SELECT password_hash h, updated_at u FROM users WHERE email = 'planner1@example.com'");
  check("and planner1's password is unchanged", planner1After.h === planner1Before.h && String(planner1After.u) === String(planner1Before.u));

  const status = (await call("GET", "/demo-data", { token: su })).body;
  const byEmail = Object.fromEntries(status.accounts.map((a) => [a.email, a]));
  check("status marks the pre-existing accounts as existing, without a password",
    byEmail["planner1@example.com"]?.state === "existing" && byEmail["planner1@example.com"]?.password === null,
    JSON.stringify(byEmail["planner1@example.com"]));
  check("and the new checker accounts as the demo's, with theirs",
    byEmail["checker1@example.com"]?.state === "demo" && byEmail["checker1@example.com"]?.password === "Checker123!",
    JSON.stringify(byEmail["checker1@example.com"]));
  check("counts only what the demo made", status.counts.accounts === 2 && status.counts.roles === 1 && status.counts.departures === 0,
    JSON.stringify(status.counts));

  const checker = await login("checker1@example.com", "Checker123!");
  check("checker1 signs in", Boolean(checker?.accessToken), JSON.stringify(checker).slice(0, 200));
  const perms = checker?.permissions || checker?.user?.permissions || [];
  check("and can check and scan tickets", perms.includes("ticket:verify") && perms.includes("ticket:scan"), JSON.stringify(perms));

  console.log("\n== one demo job at a time ==");
  const first = await call("POST", "/demo-data/clear", { token: su });
  const second = await call("POST", "/demo-data/populate", { token: su });
  check("populating while a delete is queued is refused", first.status === 202 && second.status === 409,
    `${first.status} / ${second.status} ${JSON.stringify(second.body)}`);
  const repeat = await call("POST", "/demo-data/clear", { token: su });
  check("asking for the same delete again returns the same job",
    repeat.status === 202 && (repeat.body.job.id === first.body.job.id || repeat.body.job.status === "succeeded"),
    JSON.stringify(repeat.body));

  console.log("\n== delete ==");
  let job = null;
  for (let i = 0; i < 120 && !job; i++) {
    const { body } = await call("GET", `/jobs/${first.body.job.id}`, { token: su });
    if (["succeeded", "failed"].includes(body?.job?.status)) job = body.job;
    else await new Promise((res) => setTimeout(res, 500));
  }
  check("the delete succeeds", job?.status === "succeeded", JSON.stringify(job?.lastError));
  const after = await counts();
  // Jobs and sessions are the record of having run it. So are the notifications
  // telling the super admin each job finished — about the demo, not part of it.
  const drift = Object.keys(baseline).filter(
    (t) => !["jobs", "refresh_tokens", "notifications"].includes(t) && baseline[t] !== after[t]
  );
  check("every table is back to exactly what it held before", drift.length === 0,
    drift.map((t) => `${t}: ${baseline[t]} -> ${after[t]}`).join(", "));
  const told = (await call("GET", "/notifications?category=system&limit=50", { token: su })).body.notifications
    .filter((n) => n.type.startsWith("job.demo."));
  check("the only notifications left are the super admin's job announcements",
    after.notifications - baseline.notifications === told.length && told.length >= 2,
    `${baseline.notifications} -> ${after.notifications}, announcements ${told.length}`);
  const gone = await call("POST", "/auth/login", { body: { email: "checker1@example.com", password: "Checker123!" } });
  check("checker1 is gone", gone.status === 401, `${gone.status}`);
  const stillHere = await login("planner1@example.com", "Planner123!");
  check("planner1, which the demo only adopted, is still here", Boolean(stillHere?.accessToken) || stillHere?.error?.message !== undefined,
    JSON.stringify(stillHere).slice(0, 200));
  const [[p1]] = await db.query("SELECT COUNT(*) n FROM users WHERE email = 'planner1@example.com'");
  check("(its row is intact)", p1.n === 1);

  await db.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
