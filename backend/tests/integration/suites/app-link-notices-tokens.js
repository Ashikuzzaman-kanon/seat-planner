// A subscription's app: the link subscribers get it from, notices about its
// versions (in the app, and by email when asked), and the token an app signs
// in with after its first check — used in place of the password on the check
// and on seat plans, and ended by time, a new password, a restriction, or the
// device being blocked or removed.
const fs = require("fs");
const BACKEND = require("path").resolve(__dirname, "../../..");
const { sequelize, User, AppToken, Job, SeatPlan, TrainName } = require(`${BACKEND}/src/models`);

const BASE = process.env.API_BASE;
const LOG = process.env.EMAIL_OUTBOX;
const PASSWORD = "UnitTest123!";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

async function call(method, path, { token, bearer, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(bearer ? { Authorization: bearer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json, headers: res.headers };
}

const say = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (email, password = PASSWORD) => (await call("POST", "/auth/login", { body: { email, password } })).body?.accessToken;
const message = (r) => r.body?.error?.message || "";

const USER = "unittest-user@example.com";
const OTHER = "unittest-target@example.com";
const W1 = "app-windows-01";
const W2 = "app-windows-02";

const mark = () => { try { return fs.statSync(LOG).size; } catch { return 0; } };
const mailSince = (offset) => {
  try {
    // By bytes: the mark is a size in bytes, and earlier messages hold "—" and "৳".
    return fs.readFileSync(LOG).subarray(offset).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
};

(async () => {
  const st = await login("unittest-super1@example.com");
  const ut = await login(USER);
  const ot = await login(OTHER);
  const user = await User.findOne({ where: { email: USER } });

  // A running subscription that includes seat plans, two Windows places.
  const made = (await call("POST", "/subscriptions", { token: st, body: { name: "App Gold", includesSeatPlans: true } })).body.subscription;
  const asked = (await call("POST", `/subscriptions/${made.id}/requests`, { token: ut, body: { devices: { windows: 2, android: 1 } } })).body.subscription;
  await call("POST", `/subscriptions/members/${asked.id}/approve`, { token: st, body: { days: 30 } });

  console.log("== the app link ==");
  const linkUrl = `/subscriptions/${made.id}/app-link`;
  check("an ordinary account cannot set it", (await call("PATCH", linkUrl, { token: ut, body: { appUrl: "https://example.com/app" } })).status === 403);
  for (const bad of ["http://example.com/app", "javascript:alert(1)", "not a link", "https://localhost"]) {
    const r = await call("PATCH", linkUrl, { token: st, body: { appUrl: bad } });
    check(`"${bad}" is refused`, r.status === 400 && /https:\/\//.test(message(r)), say(r));
  }
  const set = await call("PATCH", linkUrl, { token: st, body: { appUrl: "https://apps.example.com/gold" } });
  check("staff set an https link", set.status === 200 && set.body.appUrl === "https://apps.example.com/gold", say(set));
  check("setting it to the same is refused", (await call("PATCH", linkUrl, { token: st, body: { appUrl: "https://apps.example.com/gold" } })).status === 400);
  const seenBy = async (token) => (await call("GET", "/subscriptions", { token })).body.subscriptions.find((s) => s.id === made.id)?.appUrl;
  check("a subscriber whose subscription runs sees it", (await seenBy(ut)) === "https://apps.example.com/gold");
  check("someone not subscribed does not", (await seenBy(ot)) === null);
  check("staff do", (await seenBy(st)) === "https://apps.example.com/gold");
  check("the Versions tab has it", (await call("GET", `/subscriptions/${made.id}/versions`, { token: st })).body.subscription.appUrl === "https://apps.example.com/gold");

  console.log("\n== signing in: a token from the check ==");
  const first = await call("POST", "/subscriptions/check", { body: { email: USER, password: PASSWORD, deviceId: W1, platform: "windows", version: "1.0" } });
  const token = first.body?.token;
  const hours = (new Date(first.body?.tokenExpiresAt) - Date.now()) / 3_600_000;
  check("the check answers with a token", first.status === 200 && /^spa_/.test(token || ""), say(first));
  check("good for a week by default", hours > 167.9 && hours <= 168, `${hours}`);
  check("the answer is otherwise as before", first.body.subscriptions.some((s) => s.code === made.code && s.valid === true));
  const noDevice = await call("POST", "/subscriptions/check", { body: { email: USER, password: PASSWORD } });
  check("no device named, no token", noDevice.status === 200 && !("token" in noDevice.body), say(noDevice));
  check("only its hash is kept", !(await AppToken.findOne({ where: { tokenHash: token } })) && (await AppToken.count({ where: { userId: user.id, revokedAt: null } })) === 1);

  const viaToken = await call("POST", "/subscriptions/check", { token, body: { version: "1.0" } });
  check("the check takes the token in place of the email and password", viaToken.status === 200 && viaToken.body.user.email === USER, say(viaToken));
  check("and gives no new token for it", !("token" in viaToken.body));
  check("the device is the token's, whatever the body says",
    (await call("POST", "/subscriptions/check", { token, body: { deviceId: "someone-else-01", platform: "android", version: "1.0" } })).body.subscriptions.find((s) => s.code === made.code)?.valid === true);

  const train = await TrainName.findOne({ include: [{ model: SeatPlan, as: "seatPlans", required: true, where: { status: "approved", revisionOfId: null } }] }).catch(() => null);
  const anyPlan = await SeatPlan.findOne({ where: { status: "approved", revisionOfId: null }, include: [{ model: TrainName, as: "trainName", required: true }] });
  const trainName = train?.name || anyPlan.trainName.name;
  const plans = await call("POST", "/subscriptions/seat-plans", { token, body: { version: "1.0", train: trainName } });
  check("seat plans take the token too", plans.status === 200 && plans.body.coaches.length > 0, say(plans));
  check("or the email and password, as before",
    (await call("POST", "/subscriptions/seat-plans", { body: { email: USER, password: PASSWORD, deviceId: W1, platform: "windows", train: trainName } })).status === 200);

  const junk = await call("POST", "/subscriptions/check", { token: "spa_not-a-real-token", body: {} });
  check("a token that is not one is told to sign in again", junk.status === 401 && message(junk) === "Sign in again", say(junk));
  check("so is one of another kind", (await call("POST", "/subscriptions/seat-plans", { token: "eyJhbGciOi.not.ours", body: { train: trainName } })).status === 401);
  const plain = await call("POST", "/subscriptions/check", { bearer: "Basic abc", body: {} });
  check("without a token or a password, the email and password are asked for", plain.status === 400 && /email/i.test(JSON.stringify(plain.body)), say(plain));

  const again = (await call("POST", "/subscriptions/check", { body: { email: USER, password: PASSWORD, deviceId: W1, platform: "windows" } })).body.token;
  check("signing in again from the device replaces its token",
    again !== token && (await call("POST", "/subscriptions/check", { token, body: {} })).status === 401 &&
      (await call("POST", "/subscriptions/check", { token: again, body: {} })).status === 200);
  const second = (await call("POST", "/subscriptions/check", { body: { email: USER, password: PASSWORD, deviceId: W2, platform: "windows" } })).body.token;
  check("another device's token stands beside it", (await call("POST", "/subscriptions/check", { token: again, body: {} })).status === 200 && Boolean(second));

  await call("PUT", "/settings/subscription.app_token_hours", { token: st, body: { value: 2 } });
  const short = await call("POST", "/subscriptions/check", { body: { email: USER, password: PASSWORD, deviceId: W2, platform: "windows" } });
  const shortHours = (new Date(short.body.tokenExpiresAt) - Date.now()) / 3_600_000;
  check("how long a token lasts is a setting", shortHours > 1.9 && shortHours <= 2, `${shortHours}`);
  await AppToken.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { userId: user.id, deviceId: W2, revokedAt: null } });
  check("and when it is up, the app signs in again", (await call("POST", "/subscriptions/check", { token: short.body.token, body: {} })).status === 401);

  console.log("\n== what ends a token ==");
  const devicesOf = async () => (await call("GET", `/subscriptions/users/${user.id}/devices`, { token: st })).body.devices;
  const w1 = (await devicesOf()).find((d) => d.deviceId === W1);
  await call("PATCH", `/subscriptions/devices/${w1.id}`, { token: st, body: { isBlocked: true } });
  check("staff blocking the device", (await call("POST", "/subscriptions/check", { token: again, body: {} })).status === 401);
  await call("PATCH", `/subscriptions/devices/${w1.id}`, { token: st, body: { isBlocked: false } });
  const back = (await call("POST", "/subscriptions/check", { body: { email: USER, password: PASSWORD, deviceId: W1, platform: "windows" } })).body.token;
  await call("DELETE", `/subscriptions/devices/${w1.id}`, { token: st });
  check("staff removing it", (await call("POST", "/subscriptions/check", { token: back, body: {} })).status === 401);

  const onceMore = (await call("POST", "/subscriptions/check", { body: { email: USER, password: PASSWORD, deviceId: W1, platform: "windows" } })).body.token;
  await call("POST", `/users/${user.id}/restrict`, { token: st, body: { reason: "Testing app tokens" } });
  check("a restriction", (await call("POST", "/subscriptions/check", { token: onceMore, body: {} })).status === 401);
  await call("POST", `/users/${user.id}/lift-restriction`, { token: st, body: {} });

  const beforeReset = (await call("POST", "/subscriptions/check", { body: { email: USER, password: PASSWORD, deviceId: W1, platform: "windows" } })).body.token;
  await call("POST", "/auth/forgot-password", { body: { email: USER } });
  const code = (await User.findOne({ where: { email: USER } })).verificationCode;
  await call("POST", "/auth/reset-password", { body: { email: USER, code, newPassword: PASSWORD } });
  check("a new password", (await call("POST", "/subscriptions/check", { token: beforeReset, body: {} })).status === 401);
  const fresh = (await call("POST", "/subscriptions/check", { body: { email: USER, password: PASSWORD, deviceId: W1, platform: "windows" } })).body.token;
  check("after which the password signs the app in again", Boolean(fresh) && (await call("POST", "/subscriptions/check", { token: fresh, body: {} })).status === 200);

  console.log("\n== notices about a version ==");
  const versions = (await call("GET", `/subscriptions/${made.id}/versions`, { token: st })).body;
  const windows = versions.platforms.find((p) => p.value === "windows");
  const android = versions.platforms.find((p) => p.value === "android");
  check("the tab says how many a notice would reach on each platform", windows.reach === 1 && android.reach === 0, JSON.stringify([windows.reach, android.reach]));
  check("and the words one starts from", /\{version\}/.test(windows.noticeTemplates.released) && /going away/.test(windows.noticeTemplates.retiring));
  const noticeUrl = (platform) => `/subscriptions/${made.id}/versions/${platform.id}/notices`;
  check("an ordinary account cannot send one", (await call("POST", noticeUrl(windows), { token: ut, body: { kind: "released", version: "2.0", message: "Hi" } })).status === 403);
  check("a kind that is not one is refused", (await call("POST", noticeUrl(windows), { token: st, body: { kind: "soon", version: "2.0", message: "Hi" } })).status === 400);
  check("so is a version that is not one", (await call("POST", noticeUrl(windows), { token: st, body: { kind: "released", version: "two", message: "Hi" } })).status === 400);
  check("and an empty message", (await call("POST", noticeUrl(windows), { token: st, body: { kind: "released", version: "2.0", message: "  " } })).status === 400);
  const nobody = await call("POST", noticeUrl(android), { token: st, body: { kind: "released", version: "2.0", message: "Out now" } });
  check("a platform nobody uses has nobody to tell", nobody.status === 400 && /Nobody to tell/.test(message(nobody)), say(nobody));

  const jobsBefore = await Job.count({ where: { type: "notify.app_notice" } });
  const inApp = await call("POST", noticeUrl(windows), {
    token: st,
    body: { kind: "released", version: "v2.0", message: "Version 2.0 of the App Gold app for Windows is out. Update to get the latest." },
  });
  check("a release notice goes to the subscribers on the platform", inApp.status === 201 && inApp.body.notice.recipients === 1 && inApp.body.notice.version === "2.0" && !inApp.body.notice.emailed, say(inApp));
  const inbox = async () => (await call("GET", "/notifications?limit=20", { token: await login(USER) })).body.notifications;
  const told = (await inbox()).find((n) => /version 2\.0 is out/.test(n.title));
  check("who see it in the app at once", told && told.body.includes("Update to get the latest") && told.link === "/dashboard/subscriptions", JSON.stringify(told));
  check("and nobody is emailed when email was not asked for", (await Job.count({ where: { type: "notify.app_notice" } })) === jobsBefore);

  const outbox = mark();
  const emailed = await call("POST", noticeUrl(windows), {
    token: st,
    body: { kind: "retiring", version: "1.0", message: "Version 1.0 of the App Gold app for Windows is going away. Please update.", email: true },
  });
  check("a retirement notice, by email too", emailed.status === 201 && emailed.body.notice.emailed === true, say(emailed));
  // The worker picks queued jobs up every few seconds: wait for it to finish this one.
  let job = (await Job.findAll({ where: { type: "notify.app_notice" } })).find((j) => j.payload?.noticeId === emailed.body?.notice?.id);
  check("the email is queued as a job of its own", Boolean(job));
  for (let i = 0; job && i < 60 && !["succeeded", "failed"].includes(job.status); i++) {
    await pause(300);
    job = await Job.findByPk(job.id);
  }
  check("which the worker sends", job?.status === "succeeded", `${job?.status} ${job?.lastError || ""}`);
  const mail = mailSince(outbox).filter((m) => /going away/.test(m.subject || ""));
  check("to the subscriber", mail.length === 1 && mail[0].to === USER, JSON.stringify(mail.map((m) => [m.to, m.subject])));
  check("with a button to the app's link", /apps\.example\.com\/gold/.test(mail[0]?.text || ""), String(mail[0]?.text).slice(0, 300));
  check("and is in the app as well", (await inbox()).some((n) => /version 1\.0 is going away/.test(n.title) && n.tone === "warning"));
  const history = (await call("GET", `/subscriptions/${made.id}/versions`, { token: st })).body.notices;
  check("both are on record, newest first, with who sent them",
    history.length === 2 && history[0].kind === "retiring" && history[1].kind === "released" && history[0].sentBy?.id && history[0].recipients === 1,
    JSON.stringify(history.map((n) => [n.kind, n.version, n.recipients])));

  console.log("\n== from any origin, with a token ==");
  const preflight = await fetch(BASE + "/subscriptions/check", {
    method: "OPTIONS",
    headers: { Origin: "https://example.org", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" },
  });
  check("another site may send the token", /authorization/i.test(preflight.headers.get("access-control-allow-headers") || ""), preflight.headers.get("access-control-allow-headers"));

  console.log("\n== the audit log, when there is one ==");
  const logged = async (action) => (await call("GET", `/audit?action=${action}&limit=100`, { token: st })).body;
  if ((await logged("subscription.check")).available === false) {
    console.log("  (no document store here — skipped)");
  } else {
    await pause(300);
    const checks = (await logged("subscription.check")).events;
    check("checks say how they signed in", checks.some((e) => e.after?.via === "token") && checks.some((e) => e.after?.via === "password"));
    check("a dead token is on record too", checks.some((e) => e.after?.reason === "token_not_valid" && e.outcome === "failure"));
    check("the link change is recorded", (await logged("subscription.app_link")).events.some((e) => e.after?.appUrl === "https://apps.example.com/gold"));
    check("and each notice", (await logged("subscription.app_notice")).events.filter((e) => e.entity?.id == made.id).length === 2);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await sequelize.close();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
