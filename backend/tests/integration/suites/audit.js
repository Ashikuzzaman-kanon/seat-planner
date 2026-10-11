// The audit happy path: events actually written to MongoDB and readable back.
// Outstanding since Phase 1 — only the degraded path had ever been exercised.
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

(async () => {
  const t = (await call("POST", "/auth/login", {
    body: { email: "superadmin1@example.com", password: "SuperAdmin123!" },
  })).body.accessToken;

  console.log("\n== the store is reachable now ==");
  const before = await call("GET", "/audit?limit=100", { token: t });
  check("audit endpoint reports the store available", before.body?.available === true,
    JSON.stringify(before.body?.available));
  const startCount = before.body.pagination.total;
  console.log(`  (${startCount} events already stored)`);

  console.log("\n== a privileged write is recorded ==");
  const stamp = Date.now();
  const station = await call("POST", "/stations", {
    token: t, body: { code: `A${String(stamp).slice(-4)}`, name: `Audit Probe ${stamp}`, district: "Test" },
  });
  check("station created", station.status === 201, JSON.stringify(station.body));

  await new Promise((r) => setTimeout(r, 400));

  const after = await call("GET", "/audit?limit=25", { token: t });
  check("event count went up", after.body.pagination.total > startCount,
    `${startCount} -> ${after.body.pagination.total}`);

  const event = after.body.events.find(
    (e) => e.action === "station.create" && e.entity?.label === `Audit Probe ${stamp}`
  );
  check("the exact event is readable back", !!event,
    after.body.events.slice(0, 3).map((e) => e.action).join(","));

  if (event) {
    check("actor attributed", event.actor?.email === "superadmin1@example.com", JSON.stringify(event.actor));
    check("actor roles captured", Array.isArray(event.actor?.roles) && event.actor.roles.includes("super_admin"));
    check("after-state captured", event.after?.name === `Audit Probe ${stamp}`);
    check("request correlated", typeof event.context?.requestId === "string" && event.context.requestId.length > 10);
    check("request path recorded", event.context?.method === "POST" && event.context?.path.includes("/stations"));
    check("timestamped", !!event.at);
  }

  console.log("\n== before/after on an update ==");
  const id = station.body.station.id;
  await call("PATCH", `/stations/${id}`, { token: t, body: { district: "Changed District" } });
  await new Promise((r) => setTimeout(r, 400));

  const upd = await call("GET", "/audit?action=station.update&limit=5", { token: t });
  const updEvent = upd.body.events.find((e) => e.entity?.id === String(id));
  check("update recorded with both states",
    updEvent?.before?.district === "Test" && updEvent?.after?.district === "Changed District",
    JSON.stringify({ before: updEvent?.before?.district, after: updEvent?.after?.district }));

  console.log("\n== filtering works ==");
  const filtered = await call("GET", "/audit?action=station.create&limit=50", { token: t });
  check("action filter returns only that action",
    filtered.body.events.length > 0 && filtered.body.events.every((e) => e.action === "station.create"),
    `${filtered.body.events.length} events`);

  console.log("\n== cleanup ==");
  const del = await call("DELETE", `/stations/${id}`, { token: t });
  check("probe station removed", del.status === 200, `got ${del.status}`);

  await new Promise((r) => setTimeout(r, 400));
  const final = await call("GET", "/audit?action=station.delete&limit=5", { token: t });
  check("deletion recorded too",
    final.body.events.some((e) => e.entity?.id === String(id)), "no station.delete event");

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
