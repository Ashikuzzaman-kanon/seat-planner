// Checks the settings store, audit endpoint, API versioning and OpenAPI document.
const { PERMISSION_CATALOGUE } = require("../../../src/constants/permissions");
const { SETTING_DEFINITIONS } = require("../../../src/constants/settingDefinitions");
const MONGO = Boolean(process.env.MONGO_URI);
const V1 = process.env.API_BASE;
const LEGACY = process.env.API_BASE.replace(/\/v1$/, "");

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} ${ok ? "" : detail}`);
};

async function call(method, url, { token, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json, headers: res.headers };
}

const login = (base, email, password) =>
  call("POST", `${base}/auth/login`, { body: { email, password } });

const decodeJwt = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64").toString());

(async () => {
  console.log("\n== API versioning ==");
  const v1 = await call("GET", `${V1}/health`);
  check("/api/v1/health responds", v1.status === 200 && v1.body?.status === "ok");
  const legacy = await call("GET", `${LEGACY}/health`);
  check("/api/health still responds (alias)", legacy.status === 200);
  check("request id header is set", !!v1.headers.get("x-request-id"));

  console.log("\n== OpenAPI document ==");
  const spec = await call("GET", `${V1}/openapi.json`);
  check("openapi.json served", spec.status === 200);
  check("declares openapi version", !!spec.body?.openapi);
  const pathCount = Object.keys(spec.body?.paths || {}).length;
  check("documents the endpoints", pathCount >= 18, `got ${pathCount} paths`);
  check("permission enum generated from the catalogue",
    spec.body?.components?.schemas?.Permission?.properties?.key?.enum?.length === PERMISSION_CATALOGUE.length,
    `${spec.body?.components?.schemas?.Permission?.properties?.key?.enum?.length}`);
  check("roles POST declares its required permission",
    spec.body?.paths?.["/roles"]?.post?.["x-required-permissions"]?.[0] === "role:create");

  const su = await login(V1, "superadmin1@example.com", "SuperAdmin123!");
  const admin = await login(V1, "admin1@example.com", "Admin123!");
  const suToken = su.body.accessToken;
  const adminToken = admin.body.accessToken;

  console.log("\n== settings: read ==");
  const denied = await call("GET", `${V1}/settings`, {
    token: (await login(V1, "planner1@example.com", "Planner123!")).body.accessToken,
  });
  check("planner blocked from settings (no setting:view)", denied.status === 403);

  const list = await call("GET", `${V1}/settings`, { token: adminToken });
  check("admin can read settings (has setting:view)", list.status === 200);
  check(`catalogue has all ${SETTING_DEFINITIONS.length} settings`, list.body?.settings?.length === SETTING_DEFINITIONS.length,
    `got ${list.body?.settings?.length}`);
  const accessTtl = list.body.settings.find((s) => s.key === "auth.access_token_ttl_minutes");
  check("values start as declared defaults", accessTtl?.isDefault === true && accessTtl?.value === 15,
    JSON.stringify(accessTtl));
  check("definition carries type and bounds",
    accessTtl?.type === "integer" && accessTtl?.min === 1 && accessTtl?.max === 1440);

  console.log("\n== settings: write ==");
  const adminWrite = await call("PUT", `${V1}/settings/auth.access_token_ttl_minutes`, {
    token: adminToken, body: { value: 30 },
  });
  check("admin blocked from writing (no setting:manage)", adminWrite.status === 403,
    `got ${adminWrite.status}`);

  const tooBig = await call("PUT", `${V1}/settings/auth.access_token_ttl_minutes`, {
    token: suToken, body: { value: 99999 },
  });
  check("value above max rejected", tooBig.status === 400, `got ${tooBig.status}: ${tooBig.body?.message}`);

  const notNumber = await call("PUT", `${V1}/settings/auth.access_token_ttl_minutes`, {
    token: suToken, body: { value: "abc" },
  });
  check("non-numeric value rejected", notNumber.status === 400, `got ${notNumber.status}`);

  const unknown = await call("PUT", `${V1}/settings/not.a.real.setting`, {
    token: suToken, body: { value: 1 },
  });
  check("unknown setting key rejected", unknown.status === 400, `got ${unknown.status}`);

  console.log("\n== a setting change actually takes effect ==");
  const before = decodeJwt(suToken);
  const beforeTtl = before.exp - before.iat;
  check("default access token lasts 15 minutes", beforeTtl === 900, `got ${beforeTtl}s`);

  const ok = await call("PUT", `${V1}/settings/auth.access_token_ttl_minutes`, {
    token: suToken, body: { value: 45 },
  });
  check("super admin can write the setting", ok.status === 200, `got ${ok.status}`);
  check("response marks it as no longer default", ok.body?.setting?.isDefault === false);

  const after = decodeJwt((await login(V1, "admin1@example.com", "Admin123!")).body.accessToken);
  const afterTtl = after.exp - after.iat;
  check("newly issued token honours the new value", afterTtl === 2700, `got ${afterTtl}s`);

  // Put it back.
  await call("PUT", `${V1}/settings/auth.access_token_ttl_minutes`, {
    token: suToken, body: { value: 15 },
  });
  const restored = decodeJwt((await login(V1, "admin1@example.com", "Admin123!")).body.accessToken);
  check("restoring the value takes effect too", restored.exp - restored.iat === 900);

  console.log(`\n== audit log (document store ${MONGO ? "online" : "offline"}) ==`);
  const auditDenied = await call("GET", `${V1}/audit`, { token: adminToken });
  check("admin can read audit (has audit:view)", auditDenied.status === 200, `got ${auditDenied.status}`);
  if (MONGO) {
    check("serves the recorded events when MongoDB is up",
      auditDenied.body?.available === true && auditDenied.body?.events?.length > 0,
      JSON.stringify(auditDenied.body).slice(0, 200));
  } else {
    check("degrades gracefully when Mongo is down",
      auditDenied.body?.available === false && Array.isArray(auditDenied.body?.events),
      JSON.stringify(auditDenied.body));
  }
  check("still advertises known action keys",
    auditDenied.body?.actions?.includes("role.create"));

  const auditBlocked = await call("GET", `${V1}/audit`, {
    token: (await login(V1, "user1@example.com", "User123!")).body.accessToken,
  });
  check("plain user blocked from audit", auditBlocked.status === 403);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
