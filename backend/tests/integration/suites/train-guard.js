// Verifies trains are one shared record, and that deleting one can no longer
// silently destroy its route, composition, schedule and departures.
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
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }

  const t = (await call("POST", "/auth/login", {
    body: { email: "superadmin1@example.com", password: "SuperAdmin123!" },
  })).body.accessToken;

  console.log("\n== they really are the same records ==");
  const refList = (await call("GET", "/reference/train-names", { token: t })).body.items;
  const netList = (await call("GET", "/trains", { token: t })).body.trains;
  check("both endpoints return the same train ids",
    JSON.stringify(refList.map((x) => x.id).sort((a, b) => a - b)) ===
      JSON.stringify(netList.map((x) => x.id).sort((a, b) => a - b)),
    `ref ${refList.length} vs net ${netList.length}`);

  console.log("\n== writes are gone from the reference path ==");
  const created = await call("POST", "/reference/train-names", { token: t, body: { name: "Ghost Express" } });
  check("cannot create a train via reference", created.status === 404, `got ${created.status}`);

  const ekota = netList.find((x) => x.name === "Ekota Express");
  const renamed = await call("PUT", `/reference/train-names/${ekota.id}`, { token: t, body: { name: "Nope" } });
  check("cannot rename a train via reference", renamed.status === 404, `got ${renamed.status}`);

  const deleted = await call("DELETE", `/reference/train-names/${ekota.id}`, { token: t });
  check("cannot delete a train via reference", deleted.status === 404, `got ${deleted.status}`);

  console.log("\n== the reference list still works for the plan editor ==");
  const planner = (await call("POST", "/auth/login", {
    body: { email: "planner1@example.com", password: "Planner123!" },
  })).body.accessToken;
  const plannerList = await call("GET", "/reference/train-names", { token: planner });
  check("a planner can still read the dropdown", plannerList.status === 200 && plannerList.body.items.length > 0,
    `got ${plannerList.status}`);
  const plannerNetwork = await call("GET", "/trains", { token: planner });
  check("but still cannot reach the network screen", plannerNetwork.status === 403, `got ${plannerNetwork.status}`);

  console.log("\n== delete guard now names everything at risk ==");
  const blocked = await call("DELETE", `/trains/${ekota.id}`, { token: t });
  check("deleting a fully configured train is refused", blocked.status === 409, `got ${blocked.status}`);
  const msg = blocked.body?.message || blocked.body?.error?.message || "";
  for (const term of ["seat plan", "route", "coach", "schedule", "departure"]) {
    check(`message names ${term}s at risk`, msg.toLowerCase().includes(term), msg);
  }
  check("offers deactivate instead", msg.toLowerCase().includes("deactivate"), msg);

  console.log("\n== a bare train is still deletable ==");
  const bare = await call("POST", "/trains", { token: t, body: { name: "Scratch Express" } });
  check("created a bare train", bare.status === 201, `got ${bare.status}`);
  const gone = await call("DELETE", `/trains/${bare.body.train.id}`, { token: t });
  check("bare train deletes cleanly", gone.status === 200, `got ${gone.status}: ${gone.body?.message}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
