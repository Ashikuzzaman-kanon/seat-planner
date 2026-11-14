// Feature switches: any tab of the app turned off — for everyone, for chosen
// people, for chosen roles — and the super admin included. The tab's own API
// calls are refused; calls another tab still needs keep working; Settings, the
// switches themselves and the outside APIs are never switched. Every route
// the API serves to a signed-in caller is placed under a switch or left open
// on purpose, and the web app's menu names the same features as the server.
const fs = require("fs");
const path = require("path");
const BACKEND = path.resolve(__dirname, "../../..");
const ROOT = path.resolve(BACKEND, "..");
const { FeatureSwitch, FeatureSwitchTarget, Role } = require(`${BACKEND}/src/models`);
const { FEATURES, FEATURE_KEYS, FEATURE_ROUTES, compilePath, featuresFor, isAlwaysOpen } = require(
  `${BACKEND}/src/constants/features`
);

const BASE = process.env.API_BASE;
const PASSWORD = "UnitTest123!";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

async function call(method, url, { token, body } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}
const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: PASSWORD } })).body;
const say = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 220)}`;
const switchedOff = (r) => r.status === 403 && r.body?.error?.code === "FEATURE_UNAVAILABLE";

(async () => {
  console.log("\n== the web app's menu names the same features ==");
  const nav = fs.readFileSync(path.join(ROOT, "frontend/src/components/layout/nav.js"), "utf8");
  const items = [...nav.matchAll(/href: "([^"]+)",\s*feature: "([^"]+)"/g)].map((m) => ({ href: m[1], key: m[2] }));
  check("every feature has its tab in the menu, at the same address",
    FEATURES.every((f) => items.some((i) => i.key === f.key && i.href === f.path)),
    FEATURES.filter((f) => !items.some((i) => i.key === f.key && i.href === f.path)).map((f) => f.key).join(", "));
  check("and the menu names no feature the server does not know",
    items.every((i) => FEATURE_KEYS.includes(i.key)), items.filter((i) => !FEATURE_KEYS.includes(i.key)).map((i) => i.key).join(", "));
  const tabs = [...nav.matchAll(/href: "(\/dashboard[^"]*)"/g)].map((m) => m[1]);
  check("every tab but Settings has a switch", tabs.filter((h) => !items.some((i) => i.href === h)).join() === "/dashboard/settings",
    tabs.filter((h) => !items.some((i) => i.href === h)).join(", "));

  console.log("\n== every signed-in route is placed ==");
  const app = require(`${BACKEND}/src/app`);
  const authenticate = require(`${BACKEND}/src/middleware/auth`);
  const { listRoutes } = require(`${BACKEND}/src/utils/listRoutes`);
  const routes = listRoutes(app, authenticate).filter((r) => r.path.startsWith("/api/v1/"));
  const below = (p) => p.slice("/api/v1".length).replace(/:\w+/g, "X");
  const signedIn = routes.filter((r) => r.signedIn);
  check(`the API serves signed-in routes to place (${signedIn.length})`, signedIn.length > 150);
  const unplaced = signedIn.filter((r) => !featuresFor(r.method, below(r.path)) && !isAlwaysOpen(r.method, below(r.path)));
  check("each one serves a feature or is left open on purpose", unplaced.length === 0,
    unplaced.map((r) => `${r.method} ${r.path}`).join(", "));
  const dead = FEATURE_ROUTES.filter(([method, pattern]) => {
    const regex = compilePath(pattern);
    return !routes.some((r) => (method === "*" || method.split(",").includes(r.method)) && regex.test(below(r.path)));
  });
  check("and no rule describes a route that does not exist", dead.length === 0, dead.map((d) => `${d[0]} ${d[1]}`).join(", "));
  const unknown = FEATURE_ROUTES.flatMap(([, , keys]) => keys || []).filter((k) => !FEATURE_KEYS.includes(k));
  check("rules name only features that exist", unknown.length === 0, unknown.join(", "));
  check("the outside APIs are not signed-in routes, so no switch reaches them",
    ["/api/v1/subscriptions/check", "/api/v1/subscriptions/seat-plans"].every((p) =>
      routes.some((r) => r.path === p && !r.signedIn)));

  const su = await login("unittest-super1@example.com");
  const su2 = await login("unittest-super2@example.com");
  const admin = await login("unittest-admin@example.com");
  const user = await login("unittest-user@example.com");
  const target = await login("unittest-target@example.com");
  const S = su.accessToken, U = user.accessToken, T = target.accessToken;

  const put = (key, body, token = S) => call("PUT", `/features/${key}`, { token, body });

  try {
    console.log("\n== only the super admin switches ==");
    const listed = await call("GET", "/features", { token: S });
    check("the super admin sees every feature, all on", listed.status === 200 &&
      listed.body.features.length === FEATURES.length && listed.body.features.every((f) => f.state === "on"), say(listed));
    check("and the roles to switch one off for", listed.body.roles?.some((r) => r.name === "user"));
    check("an admin who may change settings may not see the switches", (await call("GET", "/features", { token: admin.accessToken })).status === 403);
    check("nor change one", (await put("wallet", { state: "off_all" }, admin.accessToken)).status === 403);
    check("a session starts with nothing switched off", Array.isArray(user.unavailableFeatures) && user.unavailableFeatures.length === 0,
      JSON.stringify(user.unavailableFeatures));

    console.log("\n== off for everyone ==");
    const off = await put("wallet", { state: "off_all", message: "Back on Friday" });
    check("Wallet switched off for everyone, with a message", off.status === 200 && off.body.feature.state === "off_all" &&
      off.body.feature.message === "Back on Friday" && off.body.feature.updatedBy?.id === su.user.id, say(off));
    const refused = await call("GET", "/wallet", { token: U });
    check("a passenger's wallet is refused as switched off", switchedOff(refused), say(refused));
    check("saying so, with the message and nothing about who it is off for",
      refused.body?.error?.message === "This is temporarily unavailable: Back on Friday" &&
      JSON.stringify(refused.body.error.details) === JSON.stringify({ features: ["wallet"], note: "Back on Friday" }), say(refused));
    check("topping up too", switchedOff(await call("POST", "/wallet/topup", { token: U, body: { amount: 100 } })));
    check("the super admin is refused just the same", switchedOff(await call("GET", "/wallet", { token: S })));
    const me = await call("GET", "/auth/me", { token: U });
    check("/auth/me lists it, with the message", JSON.stringify(me.body.unavailableFeatures) ===
      JSON.stringify([{ key: "wallet", message: "Back on Friday" }]), JSON.stringify(me.body.unavailableFeatures));
    const again = await login("unittest-user@example.com");
    check("and so does a new session", again.unavailableFeatures?.[0]?.key === "wallet");
    check("everything else carries on", (await call("GET", "/bookings", { token: U })).status === 200);

    console.log("\n== a call another tab still needs keeps working ==");
    await put("network", { state: "off_all" });
    check("Network off: its stations are refused", switchedOff(await call("GET", "/stations", { token: S })));
    check("its trains stay readable, which Departures lists", (await call("GET", "/trains", { token: S })).status === 200);
    check("as do seat plans, listed wherever coaches are chosen", (await call("GET", "/plans", { token: S })).status === 200);
    await put("departures", { state: "off_all" });
    check("with Departures off as well, the trains go too", switchedOff(await call("GET", "/trains", { token: S })));
    check("but seat plans stay, while Seat Plans and Approvals are on", (await call("GET", "/plans", { token: S })).status === 200);
    await put("jobs", { state: "off_all" });
    check("Background Jobs off: the list of jobs is refused", switchedOff(await call("GET", "/jobs", { token: S })));
    const followed = await call("GET", "/jobs/999999", { token: S });
    check("following one job is not, while Railway Data and Demo Data still show their progress",
      !switchedOff(followed) && followed.status === 404, say(followed));
    for (const key of ["network", "departures", "jobs"]) await put(key, { state: "on" });
    check("switched back on, they answer again", (await call("GET", "/stations", { token: S })).status === 200 &&
      (await call("GET", "/jobs", { token: S })).status === 200);

    console.log("\n== off for chosen people ==");
    const some = await put("book", { state: "off_some", userIds: [user.user.id] });
    check("Book a Ticket off for one passenger", some.status === 200 && some.body.feature.state === "off_some" &&
      some.body.feature.users.map((u) => u.id).join() === String(user.user.id), say(some));
    const held = await call("POST", "/holds/preview", { token: U, body: {} });
    check("that passenger's checkout is refused — before anything else is looked at", switchedOff(held), say(held));
    const other = await call("POST", "/holds/preview", { token: T, body: {} });
    check("another passenger's goes on (here, to say what is missing)", other.status === 400, say(other));
    check("their own bookings stay theirs", (await call("GET", "/bookings", { token: U })).status === 200);
    check("search is refused for them too", switchedOff(await call("GET", "/search/departures?from=1&to=2&date=2030-01-01", { token: U })));
    check("but the station list stays, which Check Tickets also uses — when they may use it",
      !switchedOff(await call("GET", "/search/stations", { token: U })));

    console.log("\n== off for chosen roles ==");
    const userRole = listed.body.roles.find((r) => r.name === "user");
    const byRole = await put("refunds", { state: "off_some", roleIds: [userRole.id], message: "Being reworked" });
    check("My Returns off for the passenger role", byRole.status === 200 && byRole.body.feature.roles[0]?.name === "user", say(byRole));
    check("every passenger is refused", switchedOff(await call("GET", "/refunds", { token: U })) &&
      switchedOff(await call("GET", "/refunds", { token: T })));
    check("the super admin, without that role, is not", (await call("GET", "/refunds", { token: S })).status === 200);
    const both = await put("refunds", { state: "off_some", roleIds: [userRole.id], userIds: [su2.user.id] });
    check("people and roles together", both.status === 200 && both.body.feature.users.length === 1 && both.body.feature.roles.length === 1);
    check("the second super admin is now refused, the first still not",
      switchedOff(await call("GET", "/refunds", { token: su2.accessToken })) && (await call("GET", "/refunds", { token: S })).status === 200);

    console.log("\n== what is stored ==");
    const row = await FeatureSwitch.findByPk("refunds", { include: [{ model: FeatureSwitchTarget, as: "targets" }] });
    check("one switch row, its targets one per person or role", row?.state === "off_some" && row.targets.length === 2 &&
      row.targets.filter((t) => t.roleId === userRole.id && !t.userId).length === 1 &&
      row.targets.filter((t) => t.userId === su2.user.id && !t.roleId).length === 1, JSON.stringify(row?.targets));
    const back = await put("refunds", { state: "on" });
    check("switching it on clears its people, roles and message", back.body.feature.state === "on" &&
      !back.body.feature.users.length && !back.body.feature.roles.length && back.body.feature.message === null, say(back));
    check("so passengers have it again", (await call("GET", "/refunds", { token: U })).status === 200);
    check("its targets are gone from the database", (await FeatureSwitchTarget.count({ where: { featureKey: "refunds" } })) === 0);

    console.log("\n== what cannot be switched ==");
    check("Settings has no switch", (await put("settings", { state: "off_all" })).status === 404);
    check("nor does anything made up", (await put("nonsense", { state: "off_all" })).status === 404);
    check("off for some, with nobody chosen, is refused", (await put("audit", { state: "off_some" })).status === 400);
    check("as is somebody who does not exist", (await put("audit", { state: "off_some", userIds: [99999999] })).status === 400);
    check("and a role that does not exist", (await put("audit", { state: "off_some", roleIds: [99999999] })).status === 400);
    check("and a state that is not one", (await put("audit", { state: "maybe" })).status === 400);
    check("and a message over 300 characters", (await put("audit", { state: "off_all", message: "x".repeat(301) })).status === 400);

    console.log("\n== everything off at once ==");
    for (const key of FEATURE_KEYS) await put(key, { state: "off_all" });
    const all = await call("GET", "/auth/me", { token: S });
    check("every feature is off for the super admin too", all.body.unavailableFeatures?.length === FEATURES.length,
      `${all.body.unavailableFeatures?.length}`);
    check("Settings still answers", (await call("GET", "/settings", { token: S })).status === 200);
    check("so do the switches, to turn things back on", (await call("GET", "/features", { token: S })).status === 200);
    check("and a person's profile, which a name anywhere opens",
      !switchedOff(await call("GET", `/users/${user.user.id}/profile`, { token: S })));
    const outside = await call("POST", "/subscriptions/check", {
      body: { email: "unittest-user@example.com", password: PASSWORD, deviceId: "feature-switch-0001", platform: "windows" },
    });
    check("the subscription check from outside the app still answers", outside.status === 200 && !switchedOff(outside), say(outside));
    check("signing in still works, and says what is off", (await login("unittest-target@example.com")).unavailableFeatures?.length === FEATURES.length);

    console.log("\n== the audit log, when there is one ==");
    for (const key of FEATURE_KEYS) await put(key, { state: "on" });
    await new Promise((r) => setTimeout(r, 300));
    const logged =(await call("GET", "/audit?action=feature.switch&limit=5", { token: S })).body;
    if (logged?.available === false) {
      console.log("  (no document store here — skipped)");
    } else {
      const last = logged?.events?.[0];
      check("every switch is recorded, before and after", last?.action === "feature.switch" && last.before?.state === "off_all" &&
        last.after?.state === "on", JSON.stringify(last));
    }
  } finally {
    // Leave the API as the next suite expects it: everything on.
    for (const key of FEATURE_KEYS) await put(key, { state: "on" });
    await Role.sequelize.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
