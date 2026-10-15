// App versions on the subscription check: a version that must be sent, the
// oldest one let through, single versions blocked — each platform with rules
// of its own, and nothing about the account looked at before the version
// passes.
const BACKEND = require("path").resolve(__dirname, "../../..");
const { sequelize, User, UserDevice } = require(`${BACKEND}/src/models`);

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

const say = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 260)}`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: PASSWORD } })).body;

const USER = "unittest-user@example.com";
const W1 = "versioned-windows-01";
const A1 = "versioned-android-01";

/** The check API, as an outside caller makes it. */
const ask = (fields, password = PASSWORD) => call("POST", "/subscriptions/check", { body: { email: USER, password, ...fields } });
const valid = (r) => r.body?.subscriptions?.find((s) => s.code === "versioned")?.valid;
const UPDATE = "This version is no longer supported. Please update.";

(async () => {
  const st = (await login("unittest-super1@example.com")).accessToken;
  const ut = (await login(USER)).accessToken;

  // A running subscription, so a device let through is valid.
  const made = (await call("POST", "/subscriptions", { token: st, body: { name: "Versioned" } })).body.subscription;
  const asked = (await call("POST", `/subscriptions/${made.id}/requests`, { token: ut, body: { devices: { windows: 2, android: 1 } } })).body.subscription;
  await call("POST", `/subscriptions/members/${asked.id}/approve`, { token: st, body: { days: 30 } });

  console.log("== the rules, as staff see them ==");
  check("an ordinary account cannot see them", (await call("GET", "/subscriptions/versions", { token: ut })).status === 403);
  const start = await call("GET", "/subscriptions/versions", { token: st });
  const windows = start.body.platforms.find((p) => p.value === "windows");
  const android = start.body.platforms.find((p) => p.value === "android");
  check("every platform starts with none", start.status === 200 && start.body.platforms.every((p) => !p.versionRequired && !p.minVersion && p.blocked.length === 0), say(start));

  console.log("\n== with no rules ==");
  check("a check without a version goes through, as before", valid(await ask({ deviceId: W1, platform: "windows" })) === true);
  check("so does one with a version", valid(await ask({ deviceId: W1, platform: "windows", version: "1.0" })) === true);
  const junk = await ask({ deviceId: W1, platform: "windows", version: "latest" });
  check("a version that is not one is refused, saying so", junk.status === 400 && /not valid/.test(junk.body.error.message), say(junk));
  const mine = async () => (await call("GET", "/subscriptions/devices/mine", { token: ut })).body.devices;
  check("the device remembers the version it checked in with", (await mine()).find((d) => d.deviceId === W1)?.appVersion === "1.0", JSON.stringify(await mine()));
  await ask({ deviceId: W1, platform: "windows" });
  check("and keeps it when a check does not say", (await mine()).find((d) => d.deviceId === W1)?.appVersion === "1.0");

  console.log("\n== a version required ==");
  const policyUrl = (p) => `/subscriptions/platforms/${p.id}/versions`;
  check("an ordinary account cannot change the rules", (await call("PATCH", policyUrl(windows), { token: ut, body: { versionRequired: true } })).status === 403);
  const required = await call("PATCH", policyUrl(windows), { token: st, body: { versionRequired: true } });
  check("staff can require a version on one platform", required.status === 200 && required.body.policy.versionRequired === true, say(required));
  const missing = await ask({ deviceId: W1, platform: "windows" });
  check("then a check without one is refused: \"A version is required\"", missing.status === 400 && missing.body.error.message === "A version is required", say(missing));
  check("an empty version counts as none", (await ask({ deviceId: W1, platform: "windows", version: "" })).status === 400);
  const before = (await User.findOne({ where: { email: USER } })).failedSignIns;
  const wrongPassword = await ask({ deviceId: W1, platform: "windows" }, "not-the-password");
  check("before the password is looked at", wrongPassword.status === 400 && wrongPassword.body.error.message === "A version is required", say(wrongPassword));
  check("so a refused version is not a wrong password", (await User.findOne({ where: { email: USER } })).failedSignIns === before);
  check("with one, it goes through", valid(await ask({ deviceId: W1, platform: "windows", version: "1.0" })) === true);
  check("and the other platform keeps its own rules", (await ask({ deviceId: A1, platform: "android" })).status === 200);
  check("a platform nobody made has no rules to apply", (await ask({ deviceId: W1, platform: "ps5" })).status === 200);

  console.log("\n== the oldest version let through ==");
  check("a minimum must be a version", (await call("PATCH", policyUrl(windows), { token: st, body: { minVersion: "two" } })).status === 400);
  const minimum = await call("PATCH", policyUrl(windows), { token: st, body: { minVersion: "v2.0" } });
  check("staff can set one, tidied", minimum.status === 200 && minimum.body.policy.minVersion === "2.0", say(minimum));
  const old = await ask({ deviceId: W1, platform: "windows", version: "1.9.9" });
  check("an older version is told to update", old.status === 426 && old.body.error.message === UPDATE, say(old));
  check("the minimum itself goes through", valid(await ask({ deviceId: W1, platform: "windows", version: "2.0.0" })) === true);
  check("and anything newer", valid(await ask({ deviceId: W1, platform: "windows", version: "2.10" })) === true);
  check("a change that changes nothing is refused", (await call("PATCH", policyUrl(windows), { token: st, body: { minVersion: "2" } })).status === 400);
  check("a change that names nothing is refused", (await call("PATCH", policyUrl(windows), { token: st, body: {} })).status === 400);

  console.log("\n== single versions blocked ==");
  const blockUrl = (p) => `/subscriptions/platforms/${p.id}/blocked-versions`;
  check("an ordinary account cannot block one", (await call("POST", blockUrl(windows), { token: ut, body: { version: "2.1" } })).status === 403);
  const blocked = await call("POST", blockUrl(windows), { token: st, body: { version: "2.1", note: "Crashes on start" } });
  check("staff can block a version, with a note", blocked.status === 201 && blocked.body.blocked.version === "2.1" && blocked.body.blocked.note === "Crashes on start", say(blocked));
  const sameBlocked = await ask({ deviceId: W1, platform: "windows", version: "2.1.0" });
  check("however the caller writes it, it is told to update", sameBlocked.status === 426 && sameBlocked.body.error.message === UPDATE, say(sameBlocked));
  check("the versions either side still go through",
    valid(await ask({ deviceId: W1, platform: "windows", version: "2.0.9" })) === true && valid(await ask({ deviceId: W1, platform: "windows", version: "2.1.1" })) === true);
  check("a version is blocked once", (await call("POST", blockUrl(windows), { token: st, body: { version: "2.1.0" } })).status === 409);
  check("a block must name a version", (await call("POST", blockUrl(windows), { token: st, body: { version: "soon" } })).status === 400);
  check("a block on one platform leaves the other alone", (await ask({ deviceId: A1, platform: "android", version: "2.1" })).status === 200);

  const seen = await call("GET", "/subscriptions/versions", { token: st });
  const windowsNow = seen.body.platforms.find((p) => p.value === "windows");
  check("the rules read back as they were set",
    windowsNow.versionRequired && windowsNow.minVersion === "2.0" && windowsNow.blocked.map((b) => b.version).join() === "2.1" && windowsNow.blocked[0].createdBy?.id,
    JSON.stringify(windowsNow));
  check("with the versions devices last checked in with, newest first",
    windowsNow.inUse.length >= 1 && windowsNow.inUse[0].version === "2.1.1" && windowsNow.inUse[0].devices === 1, JSON.stringify(windowsNow.inUse));
  check("an unknown platform is a 404", (await call("PATCH", "/subscriptions/platforms/999999/versions", { token: st, body: { versionRequired: true } })).status === 404);

  const unblocked = await call("DELETE", `${blockUrl(windows)}/${blocked.body.blocked.id}`, { token: st });
  check("a blocked version can be let through again", unblocked.status === 200 && valid(await ask({ deviceId: W1, platform: "windows", version: "2.1" })) === true, say(unblocked));
  check("unblocking one that is not blocked is a 404", (await call("DELETE", `${blockUrl(windows)}/${blocked.body.blocked.id}`, { token: st })).status === 404);

  const cleared = await call("PATCH", policyUrl(windows), { token: st, body: { versionRequired: false, minVersion: "" } });
  check("and the rules can be cleared", cleared.status === 200 && cleared.body.policy.minVersion === null && cleared.body.policy.versionRequired === false, say(cleared));
  check("after which an old version, or none, goes through again",
    valid(await ask({ deviceId: W1, platform: "windows", version: "1.0" })) === true && valid(await ask({ deviceId: W1, platform: "windows" })) === true);
  check("the device has the version it last said", (await UserDevice.findOne({ where: { deviceId: W1 } })).appVersion === "1.0");

  console.log("\n== the audit log, when there is one ==");
  const logged = async (action) => (await call("GET", `/audit?action=${action}&limit=50`, { token: st })).body;
  if ((await logged("subscription.check")).available === false) {
    console.log("  (no document store here — skipped)");
  } else {
    await pause(300);
    const checks = (await logged("subscription.check")).events;
    check("a check refused on its version is recorded, with why",
      checks.some((e) => e.after?.reason === "version_required") && checks.some((e) => e.after?.reason === "version_too_old") && checks.some((e) => e.after?.reason === "version_blocked"),
      JSON.stringify(checks.slice(0, 5).map((e) => e.after)));
    check("and an answered one carries the version", checks.some((e) => e.after?.version === "2.1" && e.outcome === "success"));
    const policy = (await logged("subscription.version_policy")).events;
    check("every change to the rules is recorded", policy.length >= 3 && policy.some((e) => e.after?.minVersion === "2.0"), JSON.stringify(policy.slice(0, 3).map((e) => e.after)));
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
