// App versions on the subscription check, each subscription with rules of its
// own for each platform: a version that must be sent, the oldest one
// accepted, single versions blocked. A subscription that turns the version
// away says so on its own entry; the others are answered as if it had not.
const BACKEND = require("path").resolve(__dirname, "../../..");
const { sequelize, User, UserDevice, SubscriptionVersionRule } = require(`${BACKEND}/src/models`);

const BASE = process.env.API_BASE;
const PASSWORD = "UnitTest123!";

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

const say = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: PASSWORD } })).body;

const USER = "unittest-user@example.com";
const W1 = "versioned-windows-01";
const W2 = "versioned-windows-02";
const W3 = "versioned-windows-03";
const A1 = "versioned-android-01";
const UPDATE = "This version is no longer supported. Please update.";
const REQUIRED = "A version is required";

/** The check API, as an outside caller makes it. */
const ask = (fields, password = PASSWORD) => call("POST", "/subscriptions/check", { body: { email: USER, password, ...fields } });
const keysOf = (entry) => (entry ? Object.keys(entry).sort().join() : "missing");

(async () => {
  const st = (await login("unittest-super1@example.com")).accessToken;
  const ut = (await login(USER)).accessToken;
  const userId = (await User.findOne({ where: { email: USER } })).id;

  // Two running subscriptions on the same account, and one it never asked for.
  const subscribe = async (name) => {
    const made = (await call("POST", "/subscriptions", { token: st, body: { name } })).body.subscription;
    const asked = (await call("POST", `/subscriptions/${made.id}/requests`, { token: ut, body: { devices: { windows: 2, android: 1 } } })).body.subscription;
    await call("POST", `/subscriptions/members/${asked.id}/approve`, { token: st, body: { days: 30 } });
    return { ...made, memberId: asked.id };
  };
  const gold = await subscribe("Versioned Gold");
  const silver = await subscribe("Versioned Silver");
  const bronze = (await call("POST", "/subscriptions", { token: st, body: { name: "Versioned Bronze" } })).body.subscription;
  const entry = (r, sub) => r.body?.subscriptions?.find((s) => s.code === sub.code);
  const validFor = (r, sub) => entry(r, sub)?.valid;

  console.log("== the rules, as staff see them ==");
  const rulesUrl = (sub) => `/subscriptions/${sub.id}/versions`;
  check("an ordinary account cannot see them", (await call("GET", rulesUrl(gold), { token: ut })).status === 403);
  const start = await call("GET", rulesUrl(gold), { token: st });
  const windows = start.body.platforms.find((p) => p.value === "windows");
  const android = start.body.platforms.find((p) => p.value === "android");
  check("a subscription's rules are listed platform by platform",
    start.status === 200 && start.body.subscription.code === gold.code && windows && android, say(start));
  check("and every platform starts with none",
    start.body.platforms.every((p) => !p.versionRequired && !p.minVersion && p.blocked.length === 0), say(start));
  check("an unknown subscription is a 404", (await call("GET", "/subscriptions/999999/versions", { token: st })).status === 404);

  console.log("\n== with no rules ==");
  let r = await ask({ deviceId: W1, platform: "windows" });
  check("a check without a version goes through, as before", validFor(r, gold) === true && validFor(r, silver) === true, say(r));
  check("and says nothing more", keysOf(entry(r, gold)) === "code,valid" && keysOf(entry(r, silver)) === "code,valid", say(r));
  check("so does one with a version", validFor(await ask({ deviceId: W1, platform: "windows", version: "1.0" }), gold) === true);
  const junk = await ask({ deviceId: W1, platform: "windows", version: "latest" });
  check("a version that is not one is refused for the whole call, saying so", junk.status === 400 && /not valid/.test(junk.body.error.message), say(junk));
  const before = (await User.findOne({ where: { email: USER } })).failedSignIns;
  const junkWrong = await ask({ deviceId: W1, platform: "windows", version: "latest" }, "not-the-password");
  check("before the password is looked at", junkWrong.status === 400 && (await User.findOne({ where: { email: USER } })).failedSignIns === before, say(junkWrong));
  const mine = async () => (await call("GET", "/subscriptions/devices/mine", { token: ut })).body.devices;
  check("the device remembers the version it checked in with", (await mine()).find((d) => d.deviceId === W1)?.appVersion === "1.0", JSON.stringify(await mine()));
  await ask({ deviceId: W1, platform: "windows" });
  check("and keeps it when a check does not say", (await mine()).find((d) => d.deviceId === W1)?.appVersion === "1.0");

  console.log("\n== a version required, by one subscription ==");
  const policyUrl = (sub, platform) => `/subscriptions/${sub.id}/versions/${platform.id}`;
  check("an ordinary account cannot change the rules", (await call("PATCH", policyUrl(gold, windows), { token: ut, body: { versionRequired: true } })).status === 403);
  const required = await call("PATCH", policyUrl(gold, windows), { token: st, body: { versionRequired: true } });
  check("staff can require a version for one subscription on one platform", required.status === 200 && required.body.policy.versionRequired === true, say(required));
  r = await ask({ deviceId: W1, platform: "windows" });
  check("then a check without one is answered, not refused", r.status === 200, say(r));
  check("that subscription says \"A version is required\"", entry(r, gold)?.valid === false && entry(r, gold)?.message === REQUIRED, say(r));
  check("while the other is still valid, and says nothing more", validFor(r, silver) === true && keysOf(entry(r, silver)) === "code,valid", say(r));
  check("an empty version counts as none", entry(await ask({ deviceId: W1, platform: "windows", version: "" }), gold)?.message === REQUIRED);
  check("a wrong password is told only that", (await ask({ deviceId: W1, platform: "windows" }, "not-the-password")).status === 401);
  r = await ask({ deviceId: W1, platform: "windows", version: "1.0" });
  check("with one, both are valid", validFor(r, gold) === true && validFor(r, silver) === true, say(r));
  check("and the other platform keeps its own rules", validFor(await ask({ deviceId: A1, platform: "android" }), gold) === true);

  console.log("\n== the oldest version accepted ==");
  check("a minimum must be a version", (await call("PATCH", policyUrl(gold, windows), { token: st, body: { minVersion: "two" } })).status === 400);
  const minimum = await call("PATCH", policyUrl(gold, windows), { token: st, body: { minVersion: "v2.0" } });
  check("staff can set one, tidied", minimum.status === 200 && minimum.body.policy.minVersion === "2.0", say(minimum));
  r = await ask({ deviceId: W1, platform: "windows", version: "1.9.9" });
  check("an older version is told to update, by that subscription", entry(r, gold)?.valid === false && entry(r, gold)?.message === UPDATE, say(r));
  check("and only by that one", validFor(r, silver) === true && !entry(r, silver)?.message, say(r));
  check("the minimum itself is valid", validFor(await ask({ deviceId: W1, platform: "windows", version: "2.0.0" }), gold) === true);
  check("and anything newer", validFor(await ask({ deviceId: W1, platform: "windows", version: "2.10" }), gold) === true);
  check("a change that changes nothing is refused", (await call("PATCH", policyUrl(gold, windows), { token: st, body: { minVersion: "2" } })).status === 400);
  check("a change that names nothing is refused", (await call("PATCH", policyUrl(gold, windows), { token: st, body: {} })).status === 400);
  check("an unknown platform is a 404", (await call("PATCH", `/subscriptions/${gold.id}/versions/999999`, { token: st, body: { versionRequired: true } })).status === 404);

  console.log("\n== single versions blocked ==");
  const blockUrl = (sub, platform) => `${policyUrl(sub, platform)}/blocked`;
  check("an ordinary account cannot block one", (await call("POST", blockUrl(silver, windows), { token: ut, body: { version: "2.1" } })).status === 403);
  const blocked = await call("POST", blockUrl(silver, windows), { token: st, body: { version: "2.1", note: "Crashes on start" } });
  check("staff can block a version for one subscription, with a note",
    blocked.status === 201 && blocked.body.blocked.version === "2.1" && blocked.body.blocked.note === "Crashes on start", say(blocked));
  r = await ask({ deviceId: W1, platform: "windows", version: "2.1.0" });
  check("however the caller writes it, that subscription says to update", entry(r, silver)?.valid === false && entry(r, silver)?.message === UPDATE, say(r));
  check("while the other, which does not block it, is valid", validFor(r, gold) === true, say(r));
  r = await ask({ deviceId: W1, platform: "windows", version: "2.1.1" });
  check("the versions either side still go through",
    validFor(await ask({ deviceId: W1, platform: "windows", version: "2.0.9" }), silver) === true && validFor(r, silver) === true);
  check("a version is blocked once", (await call("POST", blockUrl(silver, windows), { token: st, body: { version: "2.1.0" } })).status === 409);
  check("a block must name a version", (await call("POST", blockUrl(silver, windows), { token: st, body: { version: "soon" } })).status === 400);
  check("a block on one platform leaves the other alone", validFor(await ask({ deviceId: A1, platform: "android", version: "2.1" }), silver) === true);

  console.log("\n== told only when the version is all that stands in the way ==");
  await call("PATCH", policyUrl(bronze, windows), { token: st, body: { versionRequired: true } });
  r = await ask({ deviceId: W1, platform: "windows" });
  check("a subscription the account does not hold says nothing, whatever its rules",
    entry(r, bronze)?.valid === false && keysOf(entry(r, bronze)) === "code,valid", say(r));
  await ask({ deviceId: W2, platform: "windows", version: "2.1.1" });
  r = await ask({ deviceId: W3, platform: "windows", version: "1.0" });
  check("nor does one on a device with no place, though its rules would refuse the version",
    [gold, silver].every((s) => entry(r, s)?.valid === false && keysOf(entry(r, s)) === "code,valid"), say(r));

  console.log("\n== when every subscription the device may use refuses ==");
  await call("POST", blockUrl(silver, windows), { token: st, body: { version: "1.5" } });
  r = await ask({ deviceId: W1, platform: "windows", version: "1.5" });
  check("each says so, for its own reason",
    entry(r, gold)?.message === UPDATE && entry(r, silver)?.message === UPDATE && !validFor(r, gold) && !validFor(r, silver), say(r));
  const staffView = (await call("GET", `/subscriptions/users/${userId}/devices`, { token: st })).body;
  check("and staff see the device turned away for its app's version",
    staffView.refusals.some((x) => x.reason === "app_version" && x.deviceId === W1), JSON.stringify(staffView.refusals));
  check("but it keeps its place", staffView.devices.some((d) => d.deviceId === W1 && !d.isBlocked));

  console.log("\n== the rules, read back ==");
  const goldRules = (await call("GET", rulesUrl(gold), { token: st })).body.platforms.find((p) => p.value === "windows");
  check("each subscription's rules read back as they were set",
    goldRules.versionRequired && goldRules.minVersion === "2.0" && goldRules.blocked.length === 0, JSON.stringify(goldRules));
  const silverRules = (await call("GET", rulesUrl(silver), { token: st })).body.platforms.find((p) => p.value === "windows");
  check("with their own blocked versions, and who blocked them",
    !silverRules.versionRequired && !silverRules.minVersion && silverRules.blocked.map((b) => b.version).join() === "2.1,1.5" && silverRules.blocked[0].createdBy?.id,
    JSON.stringify(silverRules));
  check("and the versions its subscribers' devices last checked in with, newest first",
    silverRules.inUse.length >= 1 && silverRules.inUse[0].version === "2.1.1" && silverRules.inUse.reduce((n, v) => n + v.devices, 0) === 2,
    JSON.stringify(silverRules.inUse));

  console.log("\n== unblocking, and clearing ==");
  const unblockUrl = `${blockUrl(silver, windows)}/${blocked.body.blocked.id}`;
  check("a block cannot be lifted through another subscription",
    (await call("DELETE", `${blockUrl(gold, windows)}/${blocked.body.blocked.id}`, { token: st })).status === 404);
  const unblocked = await call("DELETE", unblockUrl, { token: st });
  check("a blocked version can be let through again",
    unblocked.status === 200 && validFor(await ask({ deviceId: W1, platform: "windows", version: "2.1" }), silver) === true, say(unblocked));
  check("unblocking one that is not blocked is a 404", (await call("DELETE", unblockUrl, { token: st })).status === 404);
  const cleared = await call("PATCH", policyUrl(gold, windows), { token: st, body: { versionRequired: false, minVersion: "" } });
  check("and the rules can be cleared", cleared.status === 200 && cleared.body.policy.minVersion === null && cleared.body.policy.versionRequired === false, say(cleared));
  r = await ask({ deviceId: W1, platform: "windows" });
  check("after which no version goes through again", validFor(r, gold) === true, say(r));
  check("the device has the version it last said", (await UserDevice.findOne({ where: { deviceId: W1 } })).appVersion === "2.1");

  console.log("\n== who counts as in use, and what goes with a subscription ==");
  await call("POST", `/subscriptions/members/${gold.memberId}/cancel`, { token: st, body: { reason: "Test over" } });
  const goldAfter = (await call("GET", rulesUrl(gold), { token: st })).body.platforms.find((p) => p.value === "windows");
  check("once nobody is subscribed, no version is in use for it", goldAfter.inUse.length === 0, JSON.stringify(goldAfter.inUse));
  check("a subscription nobody asked for can still be deleted with rules on it",
    (await call("DELETE", `/subscriptions/${bronze.id}`, { token: st })).status === 200);
  check("and its rules go with it", (await SubscriptionVersionRule.count({ where: { subscriptionId: bronze.id } })) === 0);

  console.log("\n== the audit log, when there is one ==");
  const logged = async (action) => (await call("GET", `/audit?action=${action}&limit=100`, { token: st })).body;
  if ((await logged("subscription.check")).available === false) {
    console.log("  (no document store here — skipped)");
  } else {
    await pause(300);
    const checks = (await logged("subscription.check")).events;
    const refusedWith = (why) => checks.some((e) => Object.values(e.after?.refusedOnVersion || {}).includes(why));
    check("a check is recorded with which subscriptions refused the version, and why",
      refusedWith("version_required") && refusedWith("version_too_old") && refusedWith("version_blocked"),
      JSON.stringify(checks.slice(0, 5).map((e) => e.after)));
    check("one refused by them all, as that", checks.some((e) => e.after?.reason === "app_version" && e.outcome === "failure"));
    check("and one that is not a version, before the password", checks.some((e) => e.after?.reason === "version_invalid" && e.actor?.id == null));
    const policy = (await logged("subscription.version_policy")).events;
    check("every change to the rules is recorded, with its platform",
      policy.length >= 3 && policy.some((e) => e.after?.minVersion === "2.0" && e.after?.platform === "windows" && e.entity?.id == gold.id),
      JSON.stringify(policy.slice(0, 3).map((e) => [e.entity, e.after])));
    check("and every block and unblock",
      (await logged("subscription.version_block")).events.some((e) => e.after?.version === "2.1") &&
        (await logged("subscription.version_unblock")).events.some((e) => e.before?.version === "2.1"));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await sequelize.close();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
