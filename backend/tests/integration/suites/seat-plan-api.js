// Seat plans for an app outside, signed in as a subscriber: only through a
// subscription that includes them, under the same device and version rules as
// the check, and saying nothing about why a device is not let in.
const BACKEND = require("path").resolve(__dirname, "../../..");
const { sequelize, SeatPlan, TrainName, CoachClass, User } = require(`${BACKEND}/src/models`);

const BASE = process.env.API_BASE;
const PASSWORD = "UnitTest123!";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json, headers: res.headers };
}

const say = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: PASSWORD } })).body.accessToken;
const message = (r) => r.body?.error?.message || "";

const USER = "unittest-user@example.com";
const NOT_VALID = "No subscription that includes seat plans is valid on this device";

(async () => {
  const st = await login("unittest-super1@example.com");
  const ut = await login(USER);

  // The train in the fixture with the most approved plans.
  const approved = await SeatPlan.findAll({
    where: { status: "approved", revisionOfId: null },
    include: [
      { model: TrainName, as: "trainName", required: true },
      { model: CoachClass, as: "coachClass" },
    ],
  });
  const byTrain = new Map();
  for (const p of approved) byTrain.set(p.trainNameId, [...(byTrain.get(p.trainNameId) || []), p]);
  const [trainId, plans] = [...byTrain].sort((a, b) => b[1].length - a[1].length)[0];
  const train = plans[0].trainName;
  const oneClass = plans[0].coachClass.name;
  console.log(`== ${train.name}: ${plans.length} approved plan(s) ==`);

  // Two running subscriptions for the account: one without seat plans, one with.
  const subscribe = async (name) => {
    const made = (await call("POST", "/subscriptions", { token: st, body: { name } })).body.subscription;
    const asked = (await call("POST", `/subscriptions/${made.id}/requests`, { token: ut, body: { devices: { windows: 2, android: 1 } } })).body.subscription;
    await call("POST", `/subscriptions/members/${asked.id}/approve`, { token: st, body: { days: 30 } });
    return made;
  };
  const plain = await subscribe("Plain plan");
  const feed = await subscribe("Seat feed");
  check("a subscription does not include seat plans to begin with", plain.includesSeatPlans === false && feed.includesSeatPlans === false);

  const ask = (fields = {}, password = PASSWORD) =>
    call("POST", "/subscriptions/seat-plans", {
      body: { email: USER, password, deviceId: "feed-windows-01", platform: "windows", version: "1.0", train: train.name, ...fields },
    });

  console.log("\n== without a subscription that includes them ==");
  let r = await ask();
  check("an account holding none is refused", r.status === 403 && message(r) === NOT_VALID, say(r));

  const turnedOn = await call("PATCH", `/subscriptions/${feed.id}`, { token: st, body: { includesSeatPlans: true } });
  check("staff can include seat plans in a subscription", turnedOn.status === 200 && turnedOn.body.subscription.includesSeatPlans === true, say(turnedOn));
  check("an ordinary account cannot", (await call("PATCH", `/subscriptions/${plain.id}`, { token: ut, body: { includesSeatPlans: true } })).status === 403);

  console.log("\n== a train's plans ==");
  r = await ask();
  check("then the train's plans come back", r.status === 200 && r.body.coaches.length === plans.length, say(r));
  const first = r.body.coaches[0];
  check("each coach with its letter, class, type, plan and layout",
    first && "coach" in first && "class" in first && "type" in first && first.planId && first.updatedAt && Array.isArray(first.layout?.rows), JSON.stringify(first).slice(0, 200));
  check("the train named as it is", r.body.train.name === train.name && r.body.train.number === train.code, JSON.stringify(r.body.train));
  check("by its number too", train.code ? (await ask({ train: train.code })).body?.coaches?.length === plans.length : true);
  check("whatever the case it is typed in", (await ask({ train: train.name.toLowerCase() })).status === 200);
  r = await ask({ class: oneClass });
  check("one class only", r.status === 200 && r.body.coaches.length === plans.filter((p) => p.coachClass.name === oneClass).length && r.body.coaches.every((c) => c.class === oneClass), say(r));
  r = await ask({ coach: plans[0].coachNo });
  check("or one coach", r.status === 200 && r.body.coaches.length === 1 && r.body.coaches[0].planId === plans[0].id, say(r));
  check("a class the train does not have finds nothing", (await ask({ class: "SHULOV" })).status === 404);
  const unknown = await ask({ train: "No Such Express (0)" });
  check("a train that does not exist is a 404", unknown.status === 404 && message(unknown) === "No such train", say(unknown));
  check("and naming no train is a 400", (await ask({ train: "" })).status === 400);
  const gzip = await call("POST", "/subscriptions/seat-plans", {
    headers: { "Accept-Encoding": "gzip" },
    body: { email: USER, password: PASSWORD, deviceId: "feed-windows-01", platform: "windows", train: train.name },
  });
  check("compressed on the way", gzip.status === 200 && gzip.headers.get("content-encoding") === "gzip", gzip.headers.get("content-encoding"));

  console.log("\n== only plans in service ==");
  const copy = (await call("POST", `/plans/${plans[0].id}/revise`, { token: st })).body.plan;
  r = await ask();
  check("an editable copy of a plan is never sent", r.body.coaches.length === plans.length && !r.body.coaches.some((c) => c.planId === copy.id), say(r));
  await call("DELETE", `/plans/${copy.id}`, { token: st });

  console.log("\n== the same rules as the check ==");
  check("a wrong password is told only that", (await ask({}, "not-the-password")).status === 401);
  const junk = await ask({ version: "latest" });
  check("a version that is not one is a 400", junk.status === 400 && /not valid/.test(message(junk)), say(junk));
  const windows = (await call("GET", `/subscriptions/${feed.id}/versions`, { token: st })).body.platforms.find((p) => p.value === "windows");
  await call("PATCH", `/subscriptions/${feed.id}/versions/${windows.id}`, { token: st, body: { minVersion: "2.0" } });
  const old = await ask({ version: "1.0" });
  check("a version the subscription no longer accepts is told to update", old.status === 426 && message(old) === "This version is no longer supported. Please update.", say(old));
  await call("PATCH", `/subscriptions/${feed.id}/versions/${windows.id}`, { token: st, body: { minVersion: "", versionRequired: true } });
  const none = await ask({ version: undefined });
  check("and one that requires a version, without one", none.status === 400 && message(none) === "A version is required", say(none));
  await call("PATCH", `/subscriptions/${feed.id}/versions/${windows.id}`, { token: st, body: { versionRequired: false } });
  check("with the rules cleared, it answers again", (await ask({ version: "1.0" })).status === 200);

  await ask({ deviceId: "feed-windows-02" });
  const third = await ask({ deviceId: "feed-windows-03" });
  check("a device with no place is refused, and told nothing more", third.status === 403 && message(third) === NOT_VALID, say(third));
  const userId = (await User.findOne({ where: { email: USER } })).id;
  const staffView = (await call("GET", `/subscriptions/users/${userId}/devices`, { token: st })).body;
  check("asking takes a device's place, like a check", staffView.devices.some((d) => d.deviceId === "feed-windows-01"));

  console.log("\n== from any origin ==");
  const preflight = await fetch(BASE + "/subscriptions/seat-plans", {
    method: "OPTIONS",
    headers: { Origin: "https://example.org", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
  });
  check("another site may call it", preflight.headers.get("access-control-allow-origin") === "*", preflight.headers.get("access-control-allow-origin"));

  console.log("\n== the audit log, when there is one ==");
  const logged = (await call("GET", "/audit?action=subscription.seat_plans&limit=100", { token: st })).body;
  if (logged.available === false) {
    console.log("  (no document store here — skipped)");
  } else {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const events = (await call("GET", "/audit?action=subscription.seat_plans&limit=100", { token: st })).body.events;
    check("every call is recorded", events.length >= 10, `${events.length}`);
    check("answered ones with how many plans went", events.some((e) => e.outcome === "success" && e.after?.plans === plans.length && e.after?.train === train.name));
    check("refused ones with why",
      ["no_seat_plan_subscription", "no_such_train", "no_matching_plan", "version_too_old", "version_required", "limit_reached", "version_invalid"].every((why) =>
        events.some((e) => e.outcome === "failure" && e.after?.reason === why)),
      JSON.stringify([...new Set(events.map((e) => e.after?.reason))]));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await sequelize.close();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
