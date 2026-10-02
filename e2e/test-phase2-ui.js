// Confirms the Phase 2 screens are served and the admin demo account can use them.
const config = require("./config");
const FE = config.WEB;
const API = `${FE}/api/v1`;

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} ${ok ? "" : detail}`);
};

const call = async (method, url, { token, body } = {}) => {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
};

(async () => {
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`${FE}/login`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\n== pages ==");
  for (const path of ["/dashboard/network", "/dashboard/plans", "/dashboard/roles"]) {
    const res = await fetch(`${FE}${path}`);
    check(`${path} served`, res.status === 200, `got ${res.status}`);
  }

  console.log("\n== admin demo account can operate the network ==");
  const admin = (await call("POST", `${API}/auth/login`, {
    body: { email: "admin1@example.com", password: "Admin123!" },
  })).body;
  const t = admin.accessToken;

  check("admin now holds network:view", admin.permissions.includes("network:view"));
  check("admin holds route:manage", admin.permissions.includes("route:manage"));
  check("admin holds fare:manage", admin.permissions.includes("fare:manage"));
  check("admin deliberately lacks seat_attribute:manage",
    !admin.permissions.includes("seat_attribute:manage"));

  const stations = await call("GET", `${API}/stations`, { token: t });
  check("admin can read stations through the proxy", stations.status === 200 && stations.body.stations.length >= 36);

  const trains = await call("GET", `${API}/trains`, { token: t });
  check("admin can read trains", trains.status === 200);

  const attrWrite = await call("POST", `${API}/seat-attributes`, {
    token: t, body: { key: "nope", label: "Nope" },
  });
  check("admin blocked from writing seat attributes", attrWrite.status === 403, `got ${attrWrite.status}`);

  // The escalation guard should stop admin handing itself the missing permission.
  const escalate = await call("POST", `${API}/roles`, {
    token: t,
    body: { name: "attr-grab", permissions: ["seat_attribute:manage"] },
  });
  check("admin cannot grant itself seat_attribute:manage", escalate.status === 403, `got ${escalate.status}`);

  console.log("\n== openapi ==");
  const spec = (await call("GET", `${API}/openapi.json`)).body;
  const networkPaths = Object.entries(spec.paths).filter(([, v]) =>
    Object.values(v).some((op) => op.tags?.includes("Network"))
  );
  check("network endpoints documented", networkPaths.length === 11, `got ${networkPaths.length}`);
  check("route endpoint documents its permission",
    spec.paths["/trains/{id}/route"].put["x-required-permissions"][0] === "route:manage");

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
