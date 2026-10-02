// Verifies the frontend proxies /api/v1 through to the backend, and that the
// pages the new nav links to are served.
const config = require("./config");
const FE = config.WEB;

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} ${ok ? "" : detail}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Give `next start` a moment to bind.
  for (let i = 0; i < 20; i++) {
    try { await fetch(`${FE}/login`); break; } catch { await wait(500); }
  }

  console.log("\n== API proxy ==");
  const health = await fetch(`${FE}/api/v1/health`);
  const healthBody = await health.json();
  check("/api/v1/health proxies to the backend", health.status === 200 && healthBody.status === "ok");

  const meta = await fetch(`${FE}/api/v1/meta/permissions`);
  const metaBody = await meta.json();
  check("permission catalogue reachable through the proxy",
    meta.status === 200 && metaBody.permissions?.length === 15,
    `got ${metaBody.permissions?.length}`);

  const login = await fetch(`${FE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "superadmin1@example.com", password: "SuperAdmin123!" }),
  });
  const session = await login.json();
  check("login works through the proxy", login.status === 200 && !!session.accessToken);
  check("session carries roles and permissions",
    Array.isArray(session.roles) && Array.isArray(session.permissions));

  console.log("\n== pages served ==");
  for (const path of [
    "/login",
    "/dashboard",
    "/dashboard/roles",
    "/dashboard/settings",
    "/dashboard/audit",
    "/dashboard/users",
  ]) {
    const res = await fetch(`${FE}${path}`);
    check(`${path} responds`, res.status === 200, `got ${res.status}`);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
