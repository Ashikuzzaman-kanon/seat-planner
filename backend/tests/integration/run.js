/**
 * The integration tests.
 *
 *   npm run test:integration                 every suite
 *   npm run test:integration -- waitlist     only suites whose name contains "waitlist"
 *   npm run test:integration -- --reuse      skip rebuilding the database (faster reruns)
 *
 * What it does:
 *
 *   1. Builds a fresh test database — never the development one: the name must
 *      end in `_test`, or nothing runs. Migrations, then the same seeding a
 *      developer does by hand (README → Running it locally): the super admin,
 *      the demo and unit-test accounts, seat plans (approved), the network, and
 *      a rolling horizon of departures.
 *   2. Starts the API inside this process, on a free port, exactly as the
 *      server does (src/boot.js), job worker included.
 *   3. Runs every suite in tests/integration/suites, one after another, each in
 *      its own process talking HTTP to that API, and reports.
 *
 * Every suite starts from the same data. The fixture is copied once into a
 * snapshot database, and before each suite the test database is restored from
 * it (and the app's in-memory caches reloaded) — so a suite never sees what an
 * earlier one sold, blocked or changed, and the order they run in does not
 * matter.
 *
 * Each suite is a plain script that prints PASS/FAIL lines and exits non-zero
 * on failure; this file is what turns them into one verdict.
 *
 * Settings come from the environment, and from backend/.env for the database
 * login when run locally. TEST_DB_NAME (default seat_planner_test) and
 * TEST_MONGO_URI (no default: without it, the audit-log suites skip) pick
 * where the tests run.
 */
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const BACKEND = path.resolve(__dirname, "../..");
require(path.join(BACKEND, "node_modules/dotenv")).config({ path: path.join(BACKEND, ".env") });

const args = process.argv.slice(2);
const reuse = args.includes("--reuse");
const filters = args.filter((a) => !a.startsWith("--"));

const WORK = path.join(BACKEND, "tests/integration/.work");
fs.mkdirSync(WORK, { recursive: true });

/* ------------------------------------------------------------------ *
 * Test configuration — set before any application module is loaded,
 * because config/env.js reads the environment once, at require time.
 * ------------------------------------------------------------------ */

const testEnv = {
  NODE_ENV: "test",
  DB_NAME: process.env.TEST_DB_NAME || "seat_planner_test",
  MONGO_URI: process.env.TEST_MONGO_URI || "",
  JWT_SECRET: process.env.JWT_SECRET || "integration-test-jwt-secret",
  SUPER_ADMIN_NAME: "Test Super Admin",
  SUPER_ADMIN_EMAIL: "super@example.com",
  SUPER_ADMIN_PASSWORD: "SuperTest123!",
  // No mail leaves a test run. What would have been sent is written here.
  EMAIL_HOST: "",
  BREVO_API_KEY: "",
  GMAIL_CLIENT_ID: "",
  GMAIL_CLIENT_SECRET: "",
  GMAIL_REFRESH_TOKEN: "",
  EMAIL_OUTBOX: path.join(WORK, "outbox.jsonl"),
};

if (!/_test$/.test(testEnv.DB_NAME)) {
  console.error(`Refusing to run: the test database must be named *_test, not "${testEnv.DB_NAME}".`);
  process.exit(2);
}
if (testEnv.MONGO_URI && !/_test(\?|$)/.test(new URL(testEnv.MONGO_URI).pathname + "")) {
  console.error(`Refusing to run: the test Mongo database must be named *_test (${testEnv.MONGO_URI}).`);
  process.exit(2);
}
Object.assign(process.env, testEnv);

const SNAPSHOT_DB = `${testEnv.DB_NAME}_snapshot`;

/* ------------------------------------------------------------------ */

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;

/** Run a script to completion without blocking this process (the API lives here). */
function runScript(file, { args: scriptArgs = [], quiet = true, timeoutMs = 300_000, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...scriptArgs], {
      cwd: BACKEND,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      if (!quiet) process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      out += d;
      if (!quiet) process.stderr.write(d);
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

async function step(label, file, opts) {
  const { code, out } = await runScript(file, opts);
  if (code !== 0) {
    console.error(`\n✗ ${label} failed:\n${out.split("\n").slice(-25).join("\n")}`);
    process.exit(1);
  }
  console.log(`  ✓ ${label}`);
}

const connect = () =>
  require(path.join(BACKEND, "node_modules/mysql2/promise")).createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
  });

async function tablesOf(conn, db) {
  const [rows] = await conn.query(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
    [db]
  );
  return rows.map((r) => r.t);
}

/** Copy the freshly built fixture aside, to restore before every suite. */
async function snapshot() {
  const conn = await connect();
  await conn.query(`DROP DATABASE IF EXISTS \`${SNAPSHOT_DB}\``);
  await conn.query(`CREATE DATABASE \`${SNAPSHOT_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  for (const t of await tablesOf(conn, testEnv.DB_NAME)) {
    await conn.query(`CREATE TABLE \`${SNAPSHOT_DB}\`.\`${t}\` LIKE \`${testEnv.DB_NAME}\`.\`${t}\``);
    await conn.query(`INSERT INTO \`${SNAPSHOT_DB}\`.\`${t}\` SELECT * FROM \`${testEnv.DB_NAME}\`.\`${t}\``);
  }
  await conn.end();
  console.log(`  ✓ fixture snapshot taken (${SNAPSHOT_DB})`);
}

/**
 * Put the test database back to the snapshot, in place — the API's open
 * connections stay valid — then let the app forget what it had cached.
 */
async function restore() {
  const { Job } = require(path.join(BACKEND, "src/models"));
  const jobService = require(path.join(BACKEND, "src/services/jobService"));

  // Let background work the last suite started finish first: restoring under
  // a running refund would leave nonsense behind for the next suite.
  for (let waited = 0; waited < 30_000; waited += 250) {
    const live = await Job.count({ where: { status: ["queued", "running"] } });
    if (!live) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  jobService.stopWorker();

  const conn = await connect();
  await conn.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const t of await tablesOf(conn, SNAPSHOT_DB)) {
    await conn.query(`TRUNCATE TABLE \`${testEnv.DB_NAME}\`.\`${t}\``);
    await conn.query(`INSERT INTO \`${testEnv.DB_NAME}\`.\`${t}\` SELECT * FROM \`${SNAPSHOT_DB}\`.\`${t}\``);
  }
  await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  await conn.end();

  await require(path.join(BACKEND, "src/services/settingService")).loadSettings();
  require(path.join(BACKEND, "src/services/permissionService")).invalidateAll();
  await jobService.startWorker();
}

async function resetDatabases() {
  const conn = await connect();
  await conn.query(`DROP DATABASE IF EXISTS \`${testEnv.DB_NAME}\``);
  await conn.query(`CREATE DATABASE \`${testEnv.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();
  console.log(`  ✓ MySQL database ${testEnv.DB_NAME} recreated`);

  if (testEnv.MONGO_URI) {
    const mongoose = require(path.join(BACKEND, "node_modules/mongoose"));
    const m = await mongoose.createConnection(testEnv.MONGO_URI, { serverSelectionTimeoutMS: 5000 }).asPromise();
    await m.dropDatabase();
    await m.close();
    console.log("  ✓ Mongo test database cleared");
  } else {
    console.log("  - no TEST_MONGO_URI: audit-log checks will skip");
  }
}

async function buildFixture() {
  const seeders = path.join(BACKEND, "src/seeders");
  await step("migrations", path.join(BACKEND, "node_modules/sequelize-cli/lib/sequelize"), { args: ["db:migrate"] });
  await step("super admin and default role", path.join(seeders, "createSuperAdmin.js"));
  await step("demo roles and accounts", path.join(seeders, "createTestUsers.js"));
  await step("unit-test accounts", path.join(seeders, "createUnitTestUsers.js"));
  await step("seat plans", path.join(seeders, "importSeatPlans.js"));
  await step("network", path.join(seeders, "seedNetwork.js"));
  await step("seat plans approved", path.join(__dirname, "fixture/approvePlans.js"));
  await step("departures", path.join(seeders, "seedDepartures.js"));
  await step("operator settings, profiles, a booking", path.join(__dirname, "fixture/configure.js"));
}

/** Start the API in this process, the way src/server.js does. */
async function startApi() {
  const { boot } = require(path.join(BACKEND, "src/boot"));
  await boot({ log: () => {} });
  const app = require(path.join(BACKEND, "src/app"));
  const jobs = require(path.join(BACKEND, "src/jobs"));
  const quietLog = console.log;
  console.log = () => {};
  jobs.start();
  console.log = quietLog;
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const stop = async () => {
    jobs.stop();
    await new Promise((r) => server.close(r));
    await require(path.join(BACKEND, "src/models")).sequelize.close();
    await require(path.join(BACKEND, "src/config/mongo")).mongoose.disconnect();
  };
  return { base, stop };
}

/** Lines worth showing from a failed suite: the failures, not the noise. */
const signal = (out) =>
  out
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() && !/^\[audit\] skipped/.test(l.trim()));

(async () => {
  console.log(`Integration tests — database ${testEnv.DB_NAME}${testEnv.MONGO_URI ? ", with MongoDB" : ""}\n`);

  if (reuse) {
    console.log("  - reusing the existing test database (--reuse)");
  } else {
    await resetDatabases();
    await buildFixture();
    await snapshot();
  }
  fs.writeFileSync(testEnv.EMAIL_OUTBOX, "");

  const api = await startApi();
  console.log(`  ✓ API running at ${api.base}  (${elapsed()})\n`);

  const dir = path.join(__dirname, "suites");
  const suites = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .filter((f) => !filters.length || filters.some((x) => f.includes(x)))
    .sort();

  const results = [];
  for (const [i, suite] of suites.entries()) {
    if (i > 0 || reuse) await restore();
    const t0 = Date.now();
    const { code, out } = await runScript(path.join(dir, suite), { env: { API_BASE: api.base } });
    const lines = signal(out);
    const ok = code === 0;
    const tail = lines.filter((l) => /passed, \d+ failed/.test(l)).slice(-1)[0] || lines.slice(-1)[0] || "";
    results.push({ suite, ok, ms: Date.now() - t0, tail, lines });
    console.log(`${ok ? "PASS" : "FAIL"}  ${suite.padEnd(26)} ${String(Date.now() - t0).padStart(6)}ms  ${tail.trim()}`);
    if (!ok) {
      const failures = lines.filter((l) => /\bFAIL\b|Error|crashed/.test(l));
      // Long details (a whole JSON response) are cut: the line says what failed.
      const cut = (l) => (l.length > 240 ? `${l.slice(0, 240)}…` : l);
      console.log((failures.length ? failures : lines).slice(-15).map((l) => `        ${cut(l)}`).join("\n"));
    }
  }

  await api.stop();

  const failed = results.filter((r) => !r.ok);
  const checks = results.reduce(
    (n, r) => {
      const m = /(\d+) passed, (\d+) failed/.exec(r.tail);
      return m ? { pass: n.pass + Number(m[1]), fail: n.fail + Number(m[2]) } : n;
    },
    { pass: 0, fail: 0 }
  );
  console.log(
    `\n${results.length - failed.length}/${results.length} suites passed · ` +
      `${checks.pass} checks passed, ${checks.fail} failed · ${elapsed()}`
  );
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
