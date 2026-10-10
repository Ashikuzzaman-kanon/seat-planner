// Device limits on a subscription: the platforms there are, the counts asked
// for and granted, which device is let in by the check API — and that a device
// turned away is told nothing but "not valid", while staff can read why.
const BACKEND = require("path").resolve(__dirname, "../../..");
const { sequelize, UserDevice, UserDeviceRefusal, UserSubscription } = require(`${BACKEND}/src/models`);
const settings = require(`${BACKEND}/src/services/settingService`);
const subscriptions = require(`${BACKEND}/src/services/subscriptionService`);

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

const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: PASSWORD } })).body;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 240)}`;

const USER = "unittest-user@example.com";
const OTHER = "unittest-planner@example.com";

/** The check API, as an outside caller makes it. */
const ask = (email, device, password = PASSWORD) =>
  call("POST", "/subscriptions/check", { body: { email, password, ...device } });
/** Whether one subscription came back valid. */
const valid = async (email, device, code = "gold-plan") =>
  (await ask(email, device)).body?.subscriptions?.find((s) => s.code === code)?.valid;

const W1 = { deviceId: "458c70e0bd45dc3676dc6d83c5ccec4e", platform: "windows" };
const W2 = { deviceId: "second-windows-machine-0002", platform: "windows" };
const A1 = { deviceId: "android-phone-0001", platform: "android" };

(async () => {
  await settings.loadSettings();

  const su = await login("unittest-super1@example.com");
  const user = await login(USER);
  const other = await login(OTHER);
  const admin = await login("unittest-admin@example.com");
  const [st, ut, ot, at] = [su, user, other, admin].map((x) => x.accessToken);

  const staffView = async (account = user) => (await call("GET", `/subscriptions/users/${account.user.id}/devices`, { token: st })).body;
  const refusal = async (reason, account = user) => (await staffView(account)).refusals.find((r) => r.reason === reason);
  const limitsOf = (subscription) => Object.fromEntries((subscription?.devices || []).map((d) => [d.value, d.limit]));

  console.log("== the platforms there are ==");
  const offered = await call("GET", "/subscriptions/platforms", { token: ut });
  check("everyone signed in can see them", offered.status === 200, say(offered));
  check("it starts with Windows and Android",
    offered.body.platforms.map((p) => `${p.value}:${p.name}`).join() === "windows:Windows,android:Android", JSON.stringify(offered.body.platforms));
  check("and says the most that can be asked for", offered.body.maxDevices === 10);
  check("nobody signed out sees them", (await call("GET", "/subscriptions/platforms")).status === 401);
  check("an ordinary account cannot add one",
    (await call("POST", "/subscriptions/platforms", { token: ut, body: { value: "ios", name: "iPhone" } })).status === 403);

  const tv = await call("POST", "/subscriptions/platforms", { token: st, body: { value: " Smart-TV ", name: "Television" } });
  check("whoever manages subscriptions can", tv.status === 201 && tv.body.platform.value === "smart-tv" && tv.body.platform.isActive, say(tv));
  check("a value is taken once",
    (await call("POST", "/subscriptions/platforms", { token: st, body: { value: "smart-tv", name: "Again" } })).status === 409);
  check("and must be a tidy word",
    (await call("POST", "/subscriptions/platforms", { token: st, body: { value: "smart tv!", name: "Bad" } })).status === 400);
  check("a platform needs a name",
    (await call("POST", "/subscriptions/platforms", { token: st, body: { value: "console" } })).status === 400);
  const renamed = await call("PATCH", `/subscriptions/platforms/${tv.body.platform.id}`, { token: st, body: { name: "TV" } });
  check("renaming keeps the value", renamed.body.platform?.name === "TV" && renamed.body.platform.value === "smart-tv", say(renamed));
  check("a change needs something to change",
    (await call("PATCH", `/subscriptions/platforms/${tv.body.platform.id}`, { token: st, body: {} })).status === 400);
  const off = await call("PATCH", `/subscriptions/platforms/${tv.body.platform.id}`, { token: st, body: { isActive: false } });
  check("it can be switched off", off.body.platform?.isActive === false, say(off));
  check("then it is not offered",
    !(await call("GET", "/subscriptions/platforms", { token: ut })).body.platforms.some((p) => p.value === "smart-tv"));
  check("though staff still see it",
    (await call("GET", "/subscriptions/platforms", { token: st })).body.platforms.some((p) => p.value === "smart-tv" && !p.isActive));
  check("one nothing uses can be deleted",
    (await call("DELETE", `/subscriptions/platforms/${tv.body.platform.id}`, { token: st })).status === 200);
  check("and a platform that is not there is a 404",
    (await call("DELETE", `/subscriptions/platforms/${tv.body.platform.id}`, { token: st })).status === 404);

  console.log("\n== asking, with how many devices ==");
  const made = (await call("POST", "/subscriptions", { token: st, body: { name: "Gold plan" } })).body.subscription;
  const url = `/subscriptions/${made.id}/requests`;
  const tooMany = await call("POST", url, { token: ut, body: { devices: { windows: 11 } } });
  check("more than ten of one platform is refused, naming it", tooMany.status === 400 && /^Windows: choose 0 to 10/.test(tooMany.body.error.message), say(tooMany));
  const unknown = await call("POST", url, { token: ut, body: { devices: { ps5: 1 } } });
  check("so is a platform that does not exist", unknown.status === 400 && /no platform called "ps5"/.test(unknown.body.error.message), say(unknown));
  const none = await call("POST", url, { token: ut, body: { devices: { windows: 0, android: 0 } } });
  check("and no devices at all", none.status === 400 && /at least one/.test(none.body.error.message), say(none));
  check("and counts that are not a list by platform", (await call("POST", url, { token: ut, body: { devices: [2, 1] } })).status === 400);

  const asked = await call("POST", url, { token: ut, body: { devices: { windows: 2, android: 0 } } });
  check("a request carries the counts asked for", asked.status === 201 && JSON.stringify(limitsOf(asked.body.subscription)) === '{"windows":2,"android":0}',
    say(asked));
  const plain = await call("POST", url, { token: ot });
  check("asking without counts means one of each", JSON.stringify(limitsOf(plain.body.subscription)) === '{"windows":1,"android":1}', say(plain));
  const queue = (await call("GET", "/subscriptions/members?status=pending", { token: st })).body.members;
  const queued = queue.find((m) => m.id === asked.body.subscription.id);
  check("the reviewer sees them on the request", JSON.stringify(limitsOf(queued)) === '{"windows":2,"android":0}', JSON.stringify(queued?.devices));
  await pause(200);
  const told = (await call("GET", "/notifications?limit=50", { token: st })).body.notifications.find((n) => n.type === "subscription.requested" && /unittest-user/.test(n.body));
  check("and in the notification", /for 2 Windows/.test(told?.body || ""), told?.body);

  console.log("\n== approving, and changing the counts ==");
  const approveUrl = (id) => `/subscriptions/members/${id}/approve`;
  check("the counts an approver sets are checked the same way",
    (await call("POST", approveUrl(asked.body.subscription.id), { token: st, body: { days: 30, devices: { windows: 99 } } })).status === 400);
  const granted = await call("POST", approveUrl(asked.body.subscription.id), {
    token: st, body: { days: 30, devices: { windows: 1, android: 1 } },
  });
  check("an approver can change them while approving",
    granted.status === 200 && granted.body.subscription.status === "active" && JSON.stringify(limitsOf(granted.body.subscription)) === '{"windows":1,"android":1}',
    say(granted));
  const mine = (await call("GET", "/subscriptions", { token: ut })).body.subscriptions.find((s) => s.id === made.id);
  check("the subscriber sees what they were given", JSON.stringify(limitsOf(mine.mine)) === '{"windows":1,"android":1}', JSON.stringify(mine.mine?.devices));
  await pause(300);
  const welcome = (await call("GET", "/notifications?limit=50", { token: ut })).body.notifications.find((n) => n.type === "subscription.approved");
  check("and is told so", /On 1 Windows, 1 Android/.test(welcome?.body || ""), welcome?.body);
  const asIs = await call("POST", approveUrl(plain.body.subscription.id), { token: st, body: { days: 30 } });
  check("approving without counts keeps what was asked for", JSON.stringify(limitsOf(asIs.body.subscription)) === '{"windows":1,"android":1}', say(asIs));
  const memberId = granted.body.subscription.id;

  console.log("\n== the check, with a device ==");
  const noDevice = await ask(USER, {});
  check("a check that names no device is answered, not refused", noDevice.status === 200, say(noDevice));
  check("with nothing valid", noDevice.body.subscriptions.length > 0 && noDevice.body.subscriptions.every((s) => s.valid === false), JSON.stringify(noDevice.body));
  check("in the same shape as ever — a code and a yes or no",
    Object.keys(noDevice.body).sort().join() === "subscriptions,user" && noDevice.body.subscriptions.every((s) => Object.keys(s).sort().join() === "code,valid"),
    JSON.stringify(noDevice.body));
  check("and why is written down for staff", (await refusal("no_device"))?.attempts === 1, JSON.stringify((await staffView()).refusals));
  const stamped = new Date((await refusal("no_device")).lastAt).getTime();
  check("at the time it happened, whatever timezone the server keeps", Math.abs(Date.now() - stamped) < 60_000,
    `${Math.round((stamped - Date.now()) / 60_000)} min from now`);

  check("a device id that is not one is not valid", (await valid(USER, { deviceId: "has spaces!", platform: "windows" })) === false);
  check("recorded as that", (await refusal("bad_device"))?.deviceId === "has spaces!", JSON.stringify(await refusal("bad_device")));
  check("nor is a platform nobody created", (await valid(USER, { deviceId: W1.deviceId, platform: "ps5" })) === false);
  check("recorded with what was sent", (await refusal("unknown_platform"))?.platform === "ps5", JSON.stringify(await refusal("unknown_platform")));
  check("nor a platform left out", (await valid(USER, { deviceId: W1.deviceId })) === false);
  check("none of which put a device on the account", (await UserDevice.count({ where: { userId: user.user.id } })) === 0);

  check("the first Windows device is let in", (await valid(USER, W1)) === true);
  check("and stays in", (await valid(USER, W1)) === true);
  check("whatever case its id is sent in", (await valid(USER, { ...W1, deviceId: W1.deviceId.toUpperCase() })) === true);
  const rows = await UserDevice.findAll({ where: { userId: user.user.id } });
  check("it is on the account once, counting its checks", rows.length === 1 && rows[0].deviceId === W1.deviceId && rows[0].checks === 3,
    JSON.stringify(rows.map((r) => [r.deviceId, r.checks])));

  const second = await ask(USER, W2);
  check("a second Windows device is one too many", second.status === 200 && second.body.subscriptions.find((s) => s.code === "gold-plan").valid === false, say(second));
  check("and is told nothing about why",
    !/limit|reason|device|blocked|place|platform/i.test(JSON.stringify(second.body)), JSON.stringify(second.body));
  await ask(USER, W2);
  const turned = await refusal("limit_reached");
  check("staff can read why, with how often it tried",
    turned?.deviceId === W2.deviceId && turned.platform === "windows" && turned.attempts === 2, JSON.stringify(turned));
  check("it took no place", (await UserDevice.count({ where: { userId: user.user.id } })) === 1);

  check("an Android device has its own count", (await valid(USER, A1)) === true);
  check("and the same id on another platform is another device",
    (await valid(USER, { deviceId: W1.deviceId, platform: "android" })) === false);
  check("another account's devices are its own", (await valid(OTHER, W2)) === true);
  const wrong = await ask(USER, W2, "not-the-password");
  check("a wrong password is still a 401, whatever the device", wrong.status === 401, say(wrong));
  await ask(USER, W1);

  console.log("\n== what each side can see ==");
  const own = await call("GET", "/subscriptions/devices/mine", { token: ut });
  check("the subscriber sees their devices", own.status === 200 && own.body.devices.map((d) => d.platform.value).join() === "windows,android", say(own));
  check("and how many places are used",
    own.body.usage.map((u) => `${u.value}:${u.used}/${u.allowed}`).join() === "windows:1/1,android:1/1", JSON.stringify(own.body.usage));
  check("but not the refusals, nor staff's notes", own.body.refusals === undefined && own.body.devices.every((d) => d.note === undefined), JSON.stringify(own.body));
  check("and cannot look at anyone else's", (await call("GET", `/subscriptions/users/${other.user.id}/devices`, { token: ut })).status === 403);

  const seen = await staffView();
  check("staff see the account, its devices and every refusal",
    seen.user.email === USER && seen.devices.length === 2 &&
      seen.refusals.map((r) => r.reason).sort().join() === "bad_device,limit_reached,limit_reached,no_device,unknown_platform,unknown_platform",
    JSON.stringify(seen.refusals.map((r) => [r.reason, r.platform, r.deviceId, r.attempts])));
  check("an account that does not exist is a 404", (await call("GET", "/subscriptions/users/999999/devices", { token: st })).status === 404);

  const windowsDevice = seen.devices.find((d) => d.platform.value === "windows");
  const noted = await call("PATCH", `/subscriptions/devices/${windowsDevice.id}`, { token: st, body: { note: "Office laptop" } });
  check("staff can note what a device is", noted.status === 200 && noted.body.device.note === "Office laptop", say(noted));
  check("which the subscriber does not see",
    (await call("GET", "/subscriptions/devices/mine", { token: ut })).body.devices.every((d) => d.note === undefined));
  check("a subscriber cannot change a device", (await call("PATCH", `/subscriptions/devices/${windowsDevice.id}`, { token: ut, body: { note: "mine" } })).status === 403);
  check("nor remove one", (await call("DELETE", `/subscriptions/devices/${windowsDevice.id}`, { token: ut })).status === 403);
  check("a change needs something to change", (await call("PATCH", `/subscriptions/devices/${windowsDevice.id}`, { token: st, body: {} })).status === 400);
  check("a device that is not there is a 404", (await call("PATCH", "/subscriptions/devices/999999", { token: st, body: { note: "x" } })).status === 404);

  console.log("\n== changing the counts on a running subscription ==");
  const memberUrl = `/subscriptions/members/${memberId}`;
  check("a change needs a last day or counts", (await call("PATCH", memberUrl, { token: st, body: {} })).status === 400);
  check("and to change something", (await call("PATCH", memberUrl, { token: st, body: { devices: { windows: 1, android: 1 } } })).status === 400);
  check("a subscriber cannot raise their own", (await call("PATCH", memberUrl, { token: ut, body: { devices: { windows: 9 } } })).status === 403);
  const raised = await call("PATCH", memberUrl, { token: st, body: { devices: { windows: 2, android: 1 } } });
  check("a reviewer can raise them", raised.status === 200 && limitsOf(raised.body.subscription).windows === 2, say(raised));
  await pause(200);
  const news = (await call("GET", "/notifications?limit=50", { token: ut })).body.notifications.find((n) => n.type === "subscription.limits");
  check("and the subscriber is told", /now allows 2 Windows, 1 Android/.test(news?.title || "") && /It was 1 Windows, 1 Android/.test(news?.body || ""), JSON.stringify(news));
  check("then the second Windows device is let in", (await valid(USER, W2)) === true);

  const both = await call("PATCH", memberUrl, { token: st, body: { days: 60, devices: { windows: 1, android: 1 } } });
  check("the last day and the counts can change together", both.status === 200 && limitsOf(both.body.subscription).windows === 1 && both.body.subscription.lastDay !== raised.body.subscription.lastDay, say(both));
  check("lowered, the device that came first keeps its place", (await valid(USER, W1)) === true);
  check("and the later one is no longer valid", (await valid(USER, W2)) === false);
  check("recorded as beyond the limit, not as a new device", (await refusal("beyond_limit"))?.deviceId === W2.deviceId, JSON.stringify(await refusal("beyond_limit")));
  check("it stays on the account", (await UserDevice.count({ where: { userId: user.user.id, deviceId: W2.deviceId } })) === 1);

  console.log("\n== blocking and removing ==");
  const blocked = await call("PATCH", `/subscriptions/devices/${windowsDevice.id}`, { token: st, body: { isBlocked: true } });
  check("staff can block a device", blocked.status === 200 && blocked.body.device.isBlocked === true, say(blocked));
  check("which is then not valid", (await valid(USER, W1)) === false);
  check("recorded as blocked", (await refusal("blocked"))?.deviceId === W1.deviceId);
  check("and its place passes to the next device", (await valid(USER, W2)) === true);
  await call("PATCH", `/subscriptions/devices/${windowsDevice.id}`, { token: st, body: { isBlocked: false } });
  check("unblocked, it has its place back", (await valid(USER, W1)) === true && (await valid(USER, W2)) === false);

  const removed = await call("DELETE", `/subscriptions/devices/${windowsDevice.id}`, { token: st });
  check("staff can remove a device", removed.status === 200 && removed.body.deleted === true, say(removed));
  check("which frees its place for the next", (await valid(USER, W2)) === true);
  check("and it has to find room like any new device", (await valid(USER, W1)) === false);
  check("removing one that is gone is a 404", (await call("DELETE", `/subscriptions/devices/${windowsDevice.id}`, { token: st })).status === 404);

  console.log("\n== a platform made later, or switched off ==");
  const ios = (await call("POST", "/subscriptions/platforms", { token: st, body: { value: "ios", name: "iPhone" } })).body.platform;
  const I1 = { deviceId: "iphone-0001", platform: "ios" };
  const after = (await call("GET", "/subscriptions", { token: ut })).body.subscriptions.find((s) => s.id === made.id);
  check("a new platform starts at none on a subscription already running", limitsOf(after.mine).ios === 0, JSON.stringify(after.mine.devices));
  check("so a device on it is not valid", (await valid(USER, I1)) === false);
  await call("PATCH", memberUrl, { token: st, body: { devices: { windows: 1, android: 1, ios: 1 } } });
  check("until a reviewer allows one", (await valid(USER, I1)) === true);
  check("a new request can ask for it",
    (await call("POST", `/subscriptions/${made.id}/requests`, { token: at, body: { devices: { ios: 2 } } })).status === 201);

  await call("PATCH", `/subscriptions/platforms/${offered.body.platforms[1].id}`, { token: st, body: { isActive: false } });
  check("with a platform switched off, its devices are not valid", (await valid(USER, A1)) === false);
  check("recorded as that", (await refusal("platform_off"))?.platform === "android");
  check("nobody can ask for it", (await call("POST", `/subscriptions/${made.id}/requests`, { token: (await login("unittest-target@example.com")).accessToken, body: { devices: { android: 1 } } })).status === 400);
  check("it cannot be deleted while devices are on it",
    (await call("DELETE", `/subscriptions/platforms/${offered.body.platforms[1].id}`, { token: st })).status === 409);
  check("nor can one a subscription still allows",
    (await call("DELETE", `/subscriptions/platforms/${ios.id}`, { token: st })).status === 409);
  // The form only offers the platforms that are on, so a change made meanwhile
  // says nothing about Android — and must not take it away.
  const meanwhile = await call("PATCH", memberUrl, { token: st, body: { devices: { windows: 2, ios: 1 } } });
  check("counts changed meanwhile leave the switched-off platform's alone", meanwhile.status === 200, say(meanwhile));
  await call("PATCH", `/subscriptions/platforms/${offered.body.platforms[1].id}`, { token: st, body: { isActive: true } });
  check("switched back on, the device is valid again", (await valid(USER, A1)) === true);
  const restored = (await call("GET", "/subscriptions", { token: ut })).body.subscriptions.find((s) => s.id === made.id);
  check("with the count it had", JSON.stringify(limitsOf(restored.mine)) === '{"windows":2,"android":1,"ios":1}', JSON.stringify(restored.mine.devices));

  console.log("\n== only while the subscription runs ==");
  await UserSubscription.update({ expiresAt: new Date(Date.now() - 60_000) }, { where: { id: memberId } });
  const before = await UserDeviceRefusal.count({ where: { userId: user.user.id } });
  check("once it has run out, no device is valid", (await valid(USER, W2)) === false);
  check("and that is not a device being turned away", (await UserDeviceRefusal.count({ where: { userId: user.user.id } })) === before);
  check("a new device takes no place then either",
    (await valid(USER, { deviceId: "late-arrival-0009", platform: "windows" })) === false &&
      (await UserDevice.count({ where: { userId: user.user.id, deviceId: "late-arrival-0009" } })) === 0);

  console.log("\n== at once ==");
  const racer = await login("unittest-target@example.com");
  const run = (await call("POST", `/subscriptions/${made.id}/requests`, { token: racer.accessToken, body: { devices: { windows: 1 } } })).body.subscription;
  await call("POST", approveUrl(run.id), { token: st, body: { days: 30 } });
  const burst = await Promise.all(
    Array.from({ length: 6 }, (_, i) => valid("unittest-target@example.com", { deviceId: `racing-device-${i}`, platform: "windows" }))
  );
  check("six new devices arriving together: one place, one device let in",
    burst.filter((v) => v === true).length === 1 && burst.filter((v) => v === false).length === 5, burst.join());
  check("and one on the account", (await UserDevice.count({ where: { userId: racer.user.id } })) === 1);

  console.log("\n== keeping the record small ==");
  for (let i = 0; i < 6; i++) await ask("unittest-target@example.com", { deviceId: `flood-${i}-xxxx`, platform: "windows" });
  const flood = await UserDeviceRefusal.findAll({ where: { userId: racer.user.id } });
  check("a device that keeps trying is one row with a count",
    flood.filter((r) => r.deviceId.startsWith("racing-device-")).every((r) => r.attempts >= 1) && flood.length === 5 + 6, `${flood.length}`);
  await UserDeviceRefusal.update({ lastAt: new Date(Date.now() - 100 * 86_400_000) }, { where: { userId: racer.user.id } });
  const swept = await subscriptions.sweep();
  check("refusals too old to matter are dropped by the hourly sweep", swept.refusalsPruned === flood.length, JSON.stringify(swept));

  console.log("\n== the audit log, when there is one ==");
  const audit = await call("GET", "/audit?action=subscription.device_refuse&limit=50", { token: st });
  if (audit.body?.available === false) {
    console.log("  (no document store here — skipped)");
  } else {
    await pause(300);
    const events = (await call("GET", "/audit?action=subscription.device_refuse&limit=100", { token: st })).body.events || [];
    check("every refusal is recorded with its reason", events.some((e) => e.after?.reason === "limit_reached" && e.after?.deviceId === W2.deviceId),
      JSON.stringify(events.slice(0, 3).map((e) => e.after)));
    check("as a failure, in words", events.every((e) => e.outcome === "failure" && /not valid/.test(e.message)));
    const added = (await call("GET", "/audit?action=subscription.device_add&limit=100", { token: st })).body.events || [];
    check("and so is every device that took a place", added.some((e) => e.after?.deviceId === W1.deviceId && e.after?.place === 1),
      JSON.stringify(added.slice(0, 3).map((e) => e.after)));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await sequelize.close();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
