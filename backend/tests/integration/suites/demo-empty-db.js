// Demo data, rehearsed on an empty database — production's situation.
//
// The fixture every other suite uses is full of data, so this suite brings up
// its own: a database holding nothing but the super admin (migrations plus
// seed:superadmin, as production had), and a separate API process serving it.
// Populates, checks every screen has something on it, populates again (nothing
// doubles), lives with it for a while — a later departure, a later purchase, a
// ticket check — then deletes and checks every table is back to where it
// started. Then the refusal: an outside account's valid ticket on a demo
// departure stops the delete until it is refunded.
const path = require("path");
const net = require("net");
const { spawn, spawnSync } = require("child_process");
const BACKEND = path.resolve(__dirname, "../../..");
require(`${BACKEND}/node_modules/dotenv`).config({ path: `${BACKEND}/.env` });
const mysql = require(`${BACKEND}/node_modules/mysql2/promise`);
const bcrypt = require(`${BACKEND}/node_modules/bcryptjs`);

const DB = `${process.env.DB_NAME}_empty`;
let BASE = null;

const server = { proc: null };

const admin = () =>
  mysql.createConnection({
    host: process.env.DB_HOST || "localhost", port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root", password: process.env.DB_PASS || "",
  });

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** An empty database, migrated, with only the super admin — and an API on it. */
async function startEmptyApi() {
  const c = await admin();
  await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await c.query(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await c.end();

  const env = { ...process.env, DB_NAME: DB, MONGO_URI: "", EMAIL_OUTBOX: "" };
  for (const args of [[path.join(BACKEND, "node_modules/sequelize-cli/lib/sequelize"), "db:migrate"], [path.join(BACKEND, "src/seeders/createSuperAdmin.js")]]) {
    const r = spawnSync(process.execPath, args, { cwd: BACKEND, env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${path.basename(args[0])} failed: ${r.stderr || r.stdout}`);
  }

  const port = await freePort();
  server.proc = spawn(process.execPath, [path.join(BACKEND, "src/server.js")], {
    cwd: BACKEND, env: { ...env, PORT: String(port) }, stdio: "ignore",
  });
  BASE = `http://127.0.0.1:${port}/api/v1`;
}

async function stopEmptyApi() {
  server.proc?.kill();
  const c = await admin();
  await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await c.end();
}

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
const login = async (email, password) => (await call("POST", "/auth/login", { body: { email, password } })).body;

let db;
async function tableCounts() {
  const [tables] = await db.query(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME", [DB]);
  const out = {};
  for (const { t } of tables) {
    const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    out[t] = Number(row.n);
  }
  return out;
}

async function runJob(token, action) {
  const started = await call("POST", `/demo-data/${action}`, { token });
  if (started.status !== 202) return { started };
  const id = started.body.job.id;
  const steps = new Set();
  for (let i = 0; i < 600; i++) {
    const { body } = await call("GET", `/jobs/${id}`, { token });
    if (body?.job?.progress?.step) steps.add(body.job.progress.step);
    if (body?.job && ["succeeded", "failed"].includes(body.job.status)) return { started, job: body.job, steps };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { started, job: null, steps };
}

(async () => {
  await startEmptyApi();
  db = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASS, database: DB,
  });

  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  const su = await login(process.env.SUPER_ADMIN_EMAIL, process.env.SUPER_ADMIN_PASSWORD);
  const st = su.accessToken;
  check("the super admin signs in to the empty system", Boolean(st), JSON.stringify(su));

  console.log("\n== before ==");
  const empty = await call("GET", "/demo-data", { token: st });
  check("status says nothing is populated", empty.status === 200 && empty.body.populated === false, JSON.stringify(empty.body));
  check("it lists the 8 demo accounts it would create, none yet",
    empty.body.accounts?.length === 8 && empty.body.accounts.every((a) => a.state === "missing"),
    JSON.stringify(empty.body.accounts));
  check("no super admin among them", !empty.body.accounts?.some((a) => /super/i.test(a.role + a.email)));
  const nothing = await call("POST", "/demo-data/clear", { token: st });
  check("deleting before populating is refused plainly", nothing.status === 400, JSON.stringify(nothing));
  const baseline = await tableCounts();

  const noAccess = await call("GET", "/demo-data");
  check("the endpoint needs a signed-in caller", noAccess.status === 401, `${noAccess.status}`);

  console.log("\n== populate ==");
  const t0 = Date.now();
  const run = await runJob(st, "populate");
  check("populating is accepted as a job (202)", run.started.status === 202, JSON.stringify(run.started));
  check("and succeeds", run.job?.status === "succeeded", JSON.stringify(run.job?.lastError || run.job));
  console.log(`      took ${((Date.now() - t0) / 1000).toFixed(1)}s; steps seen: ${[...run.steps].join(" > ")}`);
  const result = run.job?.result || {};
  check("with no warnings", (result.warnings || []).length === 0, JSON.stringify(result.warnings));
  check("and nothing adopted — the database was empty", (result.notes || []).length === 0, JSON.stringify(result.notes));
  console.log(`      created: ${JSON.stringify(result.created)}; seats ${result.seats}`);

  const full = (await call("GET", "/demo-data", { token: st })).body;
  const c = full.counts || {};
  check("8 accounts", c.accounts === 8, JSON.stringify(c));
  check("3 roles (planner, admin, checker)", c.roles === 3, JSON.stringify(c));
  check("18 seat plans", c.seatPlans === 18, JSON.stringify(c));
  check("36 stations", c.stations === 36, JSON.stringify(c));
  check("departures were generated", c.departures >= 10, JSON.stringify(c));
  check("6 sample bookings, 13 tickets", c.bookings === 6 && c.tickets === 13, JSON.stringify(c));
  check("every account is marked as the demo's, with its password",
    full.accounts.every((a) => a.state === "demo" && a.password), JSON.stringify(full.accounts));
  check("nothing blocks a delete", full.blockers.length === 0, JSON.stringify(full.blockers));
  check("fare rules belong to the demo trains, not the whole network",
    (await db.query("SELECT COUNT(*) n FROM fare_rules WHERE train_id IS NULL"))[0][0].n === 0);

  console.log("\n== every demo account works ==");
  const tokens = {};
  for (const a of full.accounts) {
    const s = await login(a.email, a.password);
    tokens[a.email] = s?.accessToken;
    check(`${a.email} signs in with ${a.password}`, Boolean(s?.accessToken), JSON.stringify(s?.error || s));
  }

  const admin = tokens["admin1@example.com"];
  const trips = (await call("GET", "/trips?limit=500", { token: admin })).body?.trips || [];
  check("admin1 sees the departures", trips.length === c.departures, `${trips.length} vs ${c.departures}`);
  check("and they have seats (plans were approved)", trips.every((t) => t.seatCount > 0),
    JSON.stringify(trips.filter((t) => !(t.seatCount > 0)).slice(0, 2)));
  const approvals = (await call("GET", "/approvals?status=pending", { token: admin })).body;
  check("a transfer waits in admin1's approval queue",
    JSON.stringify(approvals).includes("ticket_transfer") || JSON.stringify(approvals).includes("Sabbir"),
    JSON.stringify(approvals).slice(0, 300));
  const reports = (await call("GET", "/abuse/reports", { token: admin })).body;
  check("and the checker's report is in the review queue", JSON.stringify(reports).includes("identity_mismatch"),
    JSON.stringify(reports).slice(0, 300));

  const u1 = tokens["user1@example.com"], u2 = tokens["user2@example.com"];
  const b1 = (await call("GET", "/bookings", { token: u1 })).body;
  const b2 = (await call("GET", "/bookings", { token: u2 })).body;
  const n1 = (b1.bookings || b1.items || []).length, n2 = (b2.bookings || b2.items || []).length;
  check("user1 has 3 bookings and user2 has 3", n1 === 3 && n2 === 3, `${n1} / ${n2}`);
  const refunds = (await call("GET", "/refunds", { token: u1 })).body;
  const rs = refunds.refunds || refunds.items || [];
  check("user1 has one settled return and one waiting on resale",
    rs.some((r) => r.type === "convenient") && rs.some((r) => r.type === "demand"), JSON.stringify(rs).slice(0, 300));
  const wallet = (await call("GET", "/wallet", { token: u1 })).body.wallet;
  check("and a wallet with money left in it", wallet?.balanceMinor > 0, JSON.stringify(wallet));
  const planner = tokens["planner1@example.com"];
  const plans = (await call("GET", "/plans?limit=100", { token: planner })).body;
  check("planner1 sees the approved seat plans", JSON.stringify(plans).includes("EKOTA-CABIN-48"), JSON.stringify(plans).slice(0, 200));

  console.log("\n== populate again ==");
  const again = await runJob(st, "populate");
  check("a second run succeeds", again.job?.status === "succeeded", JSON.stringify(again.job?.lastError));
  check("and creates nothing new", Object.keys(again.job?.result?.created || {}).length === 0,
    JSON.stringify(again.job?.result?.created));
  const after2 = (await call("GET", "/demo-data", { token: st })).body.counts;
  check("counts are unchanged", JSON.stringify(after2) === JSON.stringify(c), `${JSON.stringify(after2)} vs ${JSON.stringify(c)}`);

  console.log("\n== life goes on after populating, outside the demo's record ==");
  // The daily job extends the horizon for the demo trains: departures the demo
  // never noted, but which are demo departures all the same.
  const extended = await call("POST", "/trips/generate", { token: admin, body: { days: 20 } });
  check("the horizon is extended for the demo trains", extended.status === 200 && extended.body.report.created > 0,
    JSON.stringify(extended.body).slice(0, 200));
  const grown = (await call("GET", "/demo-data", { token: st })).body.counts;
  check("and status counts those departures as the demo's too", grown.departures === c.departures + extended.body.report.created,
    `${grown.departures} vs ${c.departures} + ${extended.body.report.created}`);

  // A demo passenger buys another ticket, on one of those new departures.
  const later = (await call("GET", "/trips?limit=500", { token: admin })).body.trips
    .filter((t) => t.status === "scheduled" && t.seatCount > 100)
    .sort((x, y) => y.departureDate.localeCompare(x.departureDate))[0];
  const laterTrain = (await call("GET", `/trains/${later.trainId}`, { token: admin })).body.train;
  const [LA, LB] = [laterTrain.stops[0].stationId, laterTrain.stops[1].stationId];
  const laterAvail = (await call("GET", `/trips/${later.id}/availability?fromStationId=${LA}&toStationId=${LB}`, { token: admin })).body;
  const laterHold = (await call("POST", "/holds", { token: u2, body: { tripId: later.id, seatIds: [laterAvail.available[0].id], fromStationId: LA, toStationId: LB } })).body;
  const laterBuy = await call("POST", "/bookings", {
    token: u2, body: { holdReference: laterHold.hold.reference, passengers: [{ name: "Late Traveller", nid: "1991222233334", dob: "1991-02-02" }], method: "wallet" },
  });
  check("user2 buys a ticket on a departure generated after populating", laterBuy.status === 201, JSON.stringify(laterBuy.body).slice(0, 200));

  // A demo checker looks a ticket up: a scan row the demo never noted.
  const looked = await call("POST", "/verify/check", { token: tokens["checker2@example.com"], body: { ticketNumber: laterBuy.body.booking.tickets[0].ticketNumber } });
  check("checker2 checks it", looked.status === 200, JSON.stringify(looked.body).slice(0, 200));

  const still = (await call("GET", "/demo-data", { token: st })).body;
  check("none of that blocks a delete — it is all the demo's", still.blockers.length === 0, JSON.stringify(still.blockers));

  console.log("\n== someone outside the demo buys a ticket on a demo departure ==");
  const hash = await bcrypt.hash("Outsider123!", 10);
  await db.query(
    "INSERT INTO users (full_name, email, password_hash, is_verified, nid, date_of_birth, created_at, updated_at) VALUES (?,?,?,?,?,?,NOW(),NOW())",
    ["Real Person", "unittest-outsider@example.com", hash, 1, "1980111122223", "1980-01-01"]);
  const [[outsiderRow]] = await db.query("SELECT id FROM users WHERE email = 'unittest-outsider@example.com'");
  const [[userRole]] = await db.query("SELECT id FROM roles WHERE name = 'user'");
  await db.query("INSERT INTO user_roles (user_id, role_id, created_at, updated_at) VALUES (?,?,NOW(),NOW())", [outsiderRow.id, userRole.id]);
  const out = (await login("unittest-outsider@example.com", "Outsider123!")).accessToken;
  await call("POST", `/wallet/user/${outsiderRow.id}/adjust`, { token: st, body: { amount: 5000, direction: "credit", description: "rehearsal" } });

  const daysAhead = (d) => Math.round((new Date(`${d}T00:00:00Z`) - Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())) / 86400000);
  const trip = trips.find((t) => t.seatCount > 100 && t.status === "scheduled" && daysAhead(t.departureDate) >= 2);
  const train = (await call("GET", `/trains/${trip.trainId}`, { token: admin })).body.train;
  const A = train.stops[0].stationId, B = train.stops[1].stationId;
  const avail = (await call("GET", `/trips/${trip.id}/availability?fromStationId=${A}&toStationId=${B}`, { token: admin })).body;
  const hold = (await call("POST", "/holds", { token: out, body: { tripId: trip.id, seatIds: [avail.available[0].id], fromStationId: A, toStationId: B } })).body;
  const bought = await call("POST", "/bookings", {
    token: out, body: { holdReference: hold.hold.reference, passengers: [{ name: "Real Person", nid: "1980111122223", dob: "1980-01-01" }], method: "wallet" },
  });
  check("the outsider's purchase goes through", bought.status === 201, JSON.stringify(bought.body).slice(0, 300));

  const blocked = (await call("GET", "/demo-data", { token: st })).body;
  check("status now shows a blocker naming the booking",
    blocked.blockers.length === 1 && JSON.stringify(blocked.blockers).includes(bought.body.booking?.reference || "@@"),
    JSON.stringify(blocked.blockers));
  const refused = await call("POST", "/demo-data/clear", { token: st });
  check("and deleting is refused with 409, before any job is queued", refused.status === 409, JSON.stringify(refused));
  check("saying how to fix it", /Refund them first/.test(refused.body?.error?.message || ""), refused.body?.error?.message);
  check("with the details for the screen", Array.isArray(refused.body?.error?.details?.blockers), JSON.stringify(refused.body));

  const ticketId = bought.body.booking.tickets[0].id;
  const refund = await call("POST", `/tickets/${ticketId}/refund`, { token: out, body: { type: "convenient" } });
  check("the outsider returns the ticket", refund.status === 201 || refund.status === 200, JSON.stringify(refund.body).slice(0, 300));
  const clearNow = (await call("GET", "/demo-data", { token: st })).body;
  check("and the blocker is gone", clearNow.blockers.length === 0, JSON.stringify(clearNow.blockers));

  console.log("\n== delete ==");
  const del = await runJob(st, "clear");
  check("deleting is accepted (202) and succeeds", del.started.status === 202 && del.job?.status === "succeeded",
    JSON.stringify(del.job?.lastError || del.started.body));
  const gone = (await call("GET", "/demo-data", { token: st })).body;
  check("status is back to not populated", gone.populated === false, JSON.stringify(gone));
  check("with every count at zero", Object.values(gone.counts).every((n) => n === 0), JSON.stringify(gone.counts));
  check("and every account missing again", gone.accounts.every((a) => a.state === "missing"));
  const u1after = await call("POST", "/auth/login", { body: { email: "user1@example.com", password: "User123!" } });
  check("user1 can no longer sign in", u1after.status === 401, `${u1after.status}`);

  const outsiderStill = await login("unittest-outsider@example.com", "Outsider123!");
  check("the outsider's account is untouched", Boolean(outsiderStill?.accessToken));
  const outWallet = (await call("GET", "/wallet", { token: outsiderStill.accessToken })).body.wallet;
  check("and so is their wallet, refund included", outWallet?.balanceMinor > 0, JSON.stringify(outWallet));

  const end = await tableCounts();
  // What legitimately differs from the empty start: the jobs that ran, the
  // sessions signed in, and the outsider this rehearsal added with their wallet.
  const expectedToDiffer = new Set(["jobs", "refresh_tokens", "users", "user_roles", "wallets", "wallet_transactions"]);
  const drift = Object.keys(baseline).filter((t) => !expectedToDiffer.has(t) && baseline[t] !== end[t]);
  check("every other table is exactly as it was before populating", drift.length === 0,
    drift.map((t) => `${t}: ${baseline[t]} -> ${end[t]}`).join(", "));
  check("users: only the outsider added", end.users === baseline.users + 1, `${baseline.users} -> ${end.users}`);
  check("demo_records is empty", end.demo_records === 0, `${end.demo_records}`);

  await db.end();
  await stopEmptyApi();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  await stopEmptyApi().catch(() => {});
  console.error(err);
  process.exit(1);
});
