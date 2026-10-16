// Subscriptions: created by one role, asked for by anyone, approved for a
// period by another, ended by the subscriber, a reviewer or the calendar — and
// the check API an outside caller uses, with the pause after wrong passwords.
const fs = require("fs");
const BACKEND = require("path").resolve(__dirname, "../../..");
const { sequelize, User, UserSubscription } = require(`${BACKEND}/src/models`);
const settings = require(`${BACKEND}/src/services/settingService`);
const subscriptions = require(`${BACKEND}/src/services/subscriptionService`);
const { todayInDhaka, addDays } = require(`${BACKEND}/src/utils/dhakaTime`);

const BASE = process.env.API_BASE;
const OUTBOX = process.env.EMAIL_OUTBOX;
const PASSWORD = "UnitTest123!";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json, headers: res.headers };
}

const login = async (email, password = PASSWORD) =>
  (await call("POST", "/auth/login", { body: { email, password } })).body;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 220)}`;

async function inboxOf(token, type) {
  const list = (await call("GET", "/notifications?limit=50", { token })).body.notifications;
  return type ? list.filter((n) => n.type === type) : list;
}

const emailsTo = (address) => {
  try {
    return fs.readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.to === address);
  } catch {
    return [];
  }
};

// Every check names the device it came from; without one nothing is valid
// (subscription-devices.js is where the device rules themselves are tested).
const DEVICE = { deviceId: "suite-device-0001", platform: "windows" };
const checkApi = (email, password = PASSWORD, headers) =>
  call("POST", "/subscriptions/check", { body: { email, password, ...DEVICE }, headers });
const validOf = (response, code) => response.body?.subscriptions?.find((s) => s.code === code)?.valid;

(async () => {
  await settings.loadSettings();

  const su = await login("unittest-super1@example.com");
  const admin = await login("unittest-admin@example.com");
  const user = await login("unittest-user@example.com");
  const desk = await login("unittest-target@example.com");
  const other = await login("unittest-planner@example.com");
  const [st, at, ut, ot] = [su, admin, user, other].map((x) => x.accessToken);
  let dt = desk.accessToken;
  const USER = "unittest-user@example.com";

  console.log("== creating what can be subscribed to ==");
  check("nobody signed out sees the list", (await call("GET", "/subscriptions")).status === 401);
  const denied = await call("POST", "/subscriptions", { token: ut, body: { name: "Sneaky" } });
  check("an ordinary account cannot create one", denied.status === 403, say(denied));

  const made = await call("POST", "/subscriptions", {
    token: st,
    body: { name: "Premium", description: "Everything, for a while." },
  });
  check("the super admin can", made.status === 201, say(made));
  const premium = made.body.subscription;
  check("its code is made from its name", premium?.code === "premium" && premium.isOpen === true, JSON.stringify(premium));

  const twice = await call("POST", "/subscriptions", { token: st, body: { name: "Premium" } });
  check("a second with the same name is refused", twice.status === 409, say(twice));
  const plus = (await call("POST", "/subscriptions", { token: st, body: { name: "Premium  Plus!" } })).body.subscription;
  check("punctuation and spaces become hyphens", plus?.code === "premium-plus", plus?.code);
  const bangla = (await call("POST", "/subscriptions", { token: st, body: { name: "প্রিমিয়াম" } })).body.subscription;
  check("a name with no Latin letters still gets a code", bangla?.code === "subscription", bangla?.code);
  const gold = (await call("POST", "/subscriptions", { token: st, body: { name: "Gold", code: "gold-tier" } })).body.subscription;
  check("a code can be chosen", gold?.code === "gold-tier", JSON.stringify(gold));
  const badCode = await call("POST", "/subscriptions", { token: st, body: { name: "Bad", code: "Not A Code" } });
  check("but only a tidy one", badCode.status === 400, say(badCode));
  const sameCode = await call("POST", "/subscriptions", { token: st, body: { name: "Other gold", code: "gold-tier" } });
  check("and not one already taken", sameCode.status === 409, say(sameCode));
  check("a name is required", (await call("POST", "/subscriptions", { token: st, body: { name: "  " } })).status === 400);

  const renamed = await call("PATCH", `/subscriptions/${plus.id}`, { token: st, body: { name: "Premium Extra" } });
  check("renaming keeps the code", renamed.body.subscription?.name === "Premium Extra" && renamed.body.subscription.code === "premium-plus", say(renamed));
  check("renaming onto another's name is refused",
    (await call("PATCH", `/subscriptions/${plus.id}`, { token: st, body: { name: "Gold" } })).status === 409);
  check("an empty change is refused",
    (await call("PATCH", `/subscriptions/${plus.id}`, { token: st, body: {} })).status === 400);

  console.log("\n== the designated role ==");
  const role = await call("POST", "/roles", {
    token: st,
    body: { name: "subscription-desk", description: "Approves subscriptions.", permissions: ["subscription:approve"] },
  });
  check("a role can be given the approve permission", role.status === 201, say(role));
  const roles = (await call("GET", "/roles", { token: st })).body.roles;
  const roleId = (name) => roles.find((r) => r.name === name).id;
  await call("PUT", `/users/${desk.user.id}/roles`, { token: st, body: { roleIds: [roleId("user"), roleId("subscription-desk")] } });
  dt = (await login("unittest-target@example.com")).accessToken;
  check("its holder sees the request queue", (await call("GET", "/subscriptions/members", { token: dt })).status === 200);
  check("but cannot create subscriptions — that is the other permission",
    (await call("POST", "/subscriptions", { token: dt, body: { name: "Desk made" } })).status === 403);
  check("and an ordinary account sees no queue", (await call("GET", "/subscriptions/members", { token: ut })).status === 403);

  console.log("\n== asking ==");
  const seen = await call("GET", "/subscriptions", { token: ut });
  check("everyone signed in sees the subscriptions", seen.status === 200 && seen.body.subscriptions.length === 4, say(seen));
  check("with no standing yet, and no counts",
    seen.body.subscriptions.every((s) => s.mine === null && s.counts === undefined), JSON.stringify(seen.body.subscriptions[0]));

  const asked = await call("POST", `/subscriptions/${premium.id}/requests`, { token: ut });
  check("asking makes a pending request", asked.status === 201 && asked.body.subscription.status === "pending", say(asked));
  const request1 = asked.body.subscription;
  const again = await call("POST", `/subscriptions/${premium.id}/requests`, { token: ut });
  check("asking twice is refused", again.status === 409 && /already asked/.test(again.body.error.message), say(again));
  check("asking for one that does not exist is a 404",
    (await call("POST", "/subscriptions/99999/requests", { token: ut })).status === 404);

  const mineNow = (await call("GET", "/subscriptions", { token: ut })).body.subscriptions.find((s) => s.id === premium.id);
  check("the list shows it waiting", mineNow.mine?.status === "pending" && mineNow.mine.valid === false, JSON.stringify(mineNow.mine));
  await pause(200);
  const [told] = await inboxOf(dt, "subscription.requested");
  check("the reviewer is told", !!told && /asked to subscribe to Premium/.test(told.title) && told.link === "/dashboard/subscriptions?tab=requests",
    JSON.stringify(told));
  check("and the count of waiting requests is 1",
    (await call("GET", "/subscriptions/members/pending-count", { token: dt })).body.pending === 1);
  const staffView = (await call("GET", "/subscriptions", { token: dt })).body.subscriptions.find((s) => s.id === premium.id);
  check("a reviewer's list carries the numbers", staffView.counts?.pending === 1 && staffView.counts.active === 0, JSON.stringify(staffView.counts));

  console.log("\n== the check API, before anything is approved ==");
  const before = await checkApi(USER);
  check("it answers an email and password", before.status === 200, say(before));
  check("naming the account", before.body.user?.email === USER && typeof before.body.user.name === "string" &&
    Object.keys(before.body.user).sort().join() === "email,name", JSON.stringify(before.body.user));
  check("with every subscription, each only a code and a yes or no",
    before.body.subscriptions.length === 4 && before.body.subscriptions.every((s) => Object.keys(s).sort().join() === "code,valid"),
    JSON.stringify(before.body.subscriptions));
  // The one date is when the app's own sign-in token runs out — nothing about a subscription.
  const { tokenExpiresAt, ...rest } = before.body;
  check("no dates or times about any subscription", !/\d{4}-\d{2}-\d{2}/.test(JSON.stringify(rest)), JSON.stringify(rest));
  check("only when the app's sign-in token runs out, if one was given", !tokenExpiresAt || "token" in before.body);
  check("a pending request is not valid", validOf(before, "premium") === false);
  check("and nothing is cached", before.headers.get("cache-control") === "no-store");

  console.log("\n== approving for a period ==");
  const queue = (await call("GET", "/subscriptions/members?status=pending", { token: dt })).body;
  check("the queue shows who asked for what",
    queue.members.length === 1 && queue.members[0].user.email === USER && queue.members[0].subscription.code === "premium",
    JSON.stringify(queue.members[0]));
  const noPeriod = await call("POST", `/subscriptions/members/${request1.id}/approve`, { token: dt, body: {} });
  check("approving needs a period", noPeriod.status === 400, say(noPeriod));
  const pastDay = await call("POST", `/subscriptions/members/${request1.id}/approve`, {
    token: dt, body: { lastDay: addDays(todayInDhaka(), -1) },
  });
  check("not one in the past", pastDay.status === 400 && /past/.test(pastDay.body.error.message), say(pastDay));
  check("and not by somebody without the permission",
    (await call("POST", `/subscriptions/members/${request1.id}/approve`, { token: at, body: { days: 30 } })).status === 403);

  const approved = await call("POST", `/subscriptions/members/${request1.id}/approve`, {
    token: dt, body: { days: 30, note: "Welcome aboard." },
  });
  const expectLast = addDays(todayInDhaka(), 30);
  check("thirty days from today is the last day",
    approved.status === 200 && approved.body.subscription.status === "active" && approved.body.subscription.lastDay === expectLast,
    say(approved));
  check("valid through the end of that day in Dhaka",
    new Date(approved.body.subscription.expiresAt).toISOString() === new Date(`${addDays(expectLast, 1)}T00:00:00+06:00`).toISOString(),
    approved.body.subscription.expiresAt);
  const twiceApproved = await call("POST", `/subscriptions/members/${request1.id}/approve`, { token: dt, body: { days: 7 } });
  check("a request is decided once", twiceApproved.status === 409 && /already been approved/.test(twiceApproved.body.error.message), say(twiceApproved));
  check("and cannot be declined afterwards",
    (await call("POST", `/subscriptions/members/${request1.id}/decline`, { token: dt, body: {} })).status === 409);

  await pause(300);
  const [welcome] = await inboxOf(ut, "subscription.approved");
  check("the subscriber is told, with the last day and the note",
    !!welcome && /subscribed to Premium until/.test(welcome.title) && /Welcome aboard/.test(welcome.body), JSON.stringify(welcome));
  const mail = emailsTo(USER).filter((m) => /Premium subscription approved/.test(m.subject));
  check("and emailed", mail.length === 1 && /Valid through/.test(mail[0].text), `${mail.length} ${mail[0]?.text?.slice(0, 200)}`);

  const afterApprove = await checkApi(USER);
  check("the check API now says yes for it", validOf(afterApprove, "premium") === true, JSON.stringify(afterApprove.body));
  check("and no for the rest", afterApprove.body.subscriptions.filter((s) => s.valid).length === 1);
  check("another account's answer is its own", validOf(await checkApi("unittest-planner@example.com"), "premium") === false);

  console.log("\n== changing when it ends ==");
  const later = addDays(todayInDhaka(), 60);
  const extended = await call("PATCH", `/subscriptions/members/${request1.id}`, { token: dt, body: { lastDay: later } });
  check("a reviewer can move the last day", extended.status === 200 && extended.body.subscription.lastDay === later, say(extended));
  const sameDay = await call("PATCH", `/subscriptions/members/${request1.id}`, { token: dt, body: { lastDay: later } });
  check("moving it to where it already is does nothing", sameDay.status === 400, say(sameDay));
  check("the subscriber cannot extend their own",
    (await call("PATCH", `/subscriptions/members/${request1.id}`, { token: ut, body: { days: 900 } })).status === 403);
  await pause(200);
  const [moved] = await inboxOf(ut, "subscription.extended");
  check("the subscriber is told the new last day", !!moved && /now runs until/.test(moved.title), JSON.stringify(moved));

  console.log("\n== ending it ==");
  const strangers = await call("POST", `/subscriptions/members/${request1.id}/cancel`, { token: ot, body: {} });
  check("somebody else's subscription does not exist to an ordinary account", strangers.status === 404, say(strangers));

  const g1 = (await call("POST", `/subscriptions/${gold.id}/requests`, { token: ut })).body.subscription;
  const withdrawn = await call("POST", `/subscriptions/members/${g1.id}/cancel`, { token: ut, body: {} });
  check("a request can be withdrawn while it waits", withdrawn.status === 200 && withdrawn.body.subscription.status === "cancelled", say(withdrawn));
  check("a withdrawn request cannot then be approved",
    (await call("POST", `/subscriptions/members/${g1.id}/approve`, { token: dt, body: { days: 7 } })).status === 409);

  const g2 = (await call("POST", `/subscriptions/${gold.id}/requests`, { token: ut })).body.subscription;
  check("and asked for again", g2?.status === "pending" && g2.id !== g1.id, JSON.stringify(g2));
  const declined = await call("POST", `/subscriptions/members/${g2.id}/decline`, { token: dt, body: { note: "Not this month." } });
  check("a reviewer can decline, with a note", declined.status === 200 && declined.body.subscription.status === "declined", say(declined));
  await pause(300);
  const [no] = await inboxOf(ut, "subscription.declined");
  check("the note reaches the person", !!no && /not approved/.test(no.title) && /Not this month/.test(no.body), JSON.stringify(no));
  check("with an email", emailsTo(USER).some((m) => /Gold subscription not approved/.test(m.subject)));

  const g3 = (await call("POST", `/subscriptions/${gold.id}/requests`, { token: ut })).body.subscription;
  await call("POST", `/subscriptions/members/${g3.id}/approve`, { token: dt, body: { days: 7 } });
  check("approved, the check API says yes", validOf(await checkApi(USER), "gold-tier") === true);
  const ownCancel = await call("POST", `/subscriptions/members/${g3.id}/cancel`, { token: ut, body: { reason: "No longer needed" } });
  check("the subscriber can cancel their own at any time", ownCancel.status === 200 && ownCancel.body.subscription.status === "cancelled", say(ownCancel));
  check("and the check API says no at once", validOf(await checkApi(USER), "gold-tier") === false);
  check("cancelling twice is refused",
    (await call("POST", `/subscriptions/members/${g3.id}/cancel`, { token: ut, body: {} })).status === 409);

  const staffCancel = await call("POST", `/subscriptions/members/${request1.id}/cancel`, { token: dt, body: { reason: "Payment bounced" } });
  check("a reviewer can cancel anyone's", staffCancel.status === 200 && staffCancel.body.subscription.status === "cancelled", say(staffCancel));
  await pause(200);
  const [gone] = await inboxOf(ut, "subscription.cancelled");
  check("the subscriber is told why and by whom", !!gone && /Payment bounced/.test(gone.body) && /By /.test(gone.body), JSON.stringify(gone));
  check("the check API says no", validOf(await checkApi(USER), "premium") === false);
  check("an ended subscription cannot be extended",
    (await call("PATCH", `/subscriptions/members/${request1.id}`, { token: dt, body: { days: 30 } })).status === 409);

  const history = (await call("GET", "/subscriptions/mine", { token: ut })).body.subscriptions;
  check("every request stays in the subscriber's history", history.length === 4 &&
    history.filter((h) => h.status === "cancelled").length === 3 && history.some((h) => h.status === "declined"),
    JSON.stringify(history.map((h) => `${h.subscription.code}:${h.status}`)));
  const all = (await call("GET", "/subscriptions/members?search=unittest-user", { token: dt })).body;
  check("and in the reviewer's list, searchable by email", all.pagination.total === 4 && all.members[0].endedBy !== undefined, JSON.stringify(all.pagination));
  check("filtered by subscription",
    (await call("GET", `/subscriptions/members?subscriptionId=${gold.id}`, { token: dt })).body.pagination.total === 3);

  console.log("\n== running out ==");
  const p2 = (await call("POST", `/subscriptions/${premium.id}/requests`, { token: ut })).body.subscription;
  await call("POST", `/subscriptions/members/${p2.id}/approve`, { token: dt, body: { days: 1 } });
  check("subscribed again, valid", validOf(await checkApi(USER), "premium") === true);
  await UserSubscription.update({ expiresAt: new Date(Date.now() - 60_000) }, { where: { id: p2.id } });
  check("the moment its time is up the check API says no — before any sweep", validOf(await checkApi(USER), "premium") === false);
  const lapsed = (await call("GET", "/subscriptions", { token: ut })).body.subscriptions.find((s) => s.id === premium.id);
  check("and the page reads it as expired", lapsed.mine.status === "expired" && lapsed.mine.valid === false, JSON.stringify(lapsed.mine));
  check("so does the reviewer's expired filter",
    (await call("GET", "/subscriptions/members?status=expired", { token: dt })).body.members.some((m) => m.id === p2.id));
  check("and the running filter leaves it out",
    !(await call("GET", "/subscriptions/members?status=active", { token: dt })).body.members.some((m) => m.id === p2.id));
  check("it cannot be cancelled now",
    (await call("POST", `/subscriptions/members/${p2.id}/cancel`, { token: ut, body: {} })).status === 409);

  const p3 = await call("POST", `/subscriptions/${premium.id}/requests`, { token: ut });
  check("the person can ask again without waiting for the sweep", p3.status === 201, say(p3));
  check("which marks the old one expired", (await UserSubscription.findByPk(p2.id)).status === "expired");

  await call("POST", `/subscriptions/members/${p3.body.subscription.id}/approve`, { token: dt, body: { days: 30 } });
  await UserSubscription.update({ expiresAt: new Date(Date.now() - 60_000) }, { where: { id: p3.body.subscription.id } });
  const swept = await subscriptions.sweep();
  check("the sweep marks what has run out", swept.expired === 1, JSON.stringify(swept));
  check("once", (await subscriptions.sweep()).expired === 0);
  const ended = await inboxOf(ut, "subscription.expired");
  check("and each ending is told to the subscriber", ended.length === 2 && /has ended/.test(ended[0].title), JSON.stringify(ended.map((n) => n.title)));

  console.log("\n== the reminder ==");
  const p4 = (await call("POST", `/subscriptions/${premium.id}/requests`, { token: ut })).body.subscription;
  await call("POST", `/subscriptions/members/${p4.id}/approve`, { token: dt, body: { days: 30 } });
  check("nothing is said while the end is far off", (await subscriptions.sweep()).reminded === 0);
  await UserSubscription.update(
    { startsAt: new Date(Date.now() - 20 * 86_400_000), expiresAt: new Date(Date.now() + 2 * 86_400_000) },
    { where: { id: p4.id } }
  );
  check("three days before the end, the subscriber is reminded", (await subscriptions.sweep()).reminded === 1);
  check("once", (await subscriptions.sweep()).reminded === 0);
  const [ending] = await inboxOf(ut, "subscription.ending");
  check("with the last day", !!ending && /ends on/.test(ending.title), JSON.stringify(ending));
  await call("PATCH", `/subscriptions/members/${p4.id}`, { token: dt, body: { days: 90 } });
  check("extending clears the reminder for the new end", (await UserSubscription.findByPk(p4.id)).remindedAt === null);

  console.log("\n== closing and deleting ==");
  const g4 = (await call("POST", `/subscriptions/${gold.id}/requests`, { token: ut })).body.subscription;
  await call("POST", `/subscriptions/members/${g4.id}/approve`, { token: dt, body: { days: 14 } });
  const waiting = (await call("POST", `/subscriptions/${gold.id}/requests`, { token: ot })).body.subscription;
  const closed = await call("PATCH", `/subscriptions/${gold.id}`, { token: st, body: { isOpen: false } });
  check("a subscription can be closed", closed.status === 200 && closed.body.subscription.isOpen === false, say(closed));
  check("which declines whatever was waiting", (await UserSubscription.findByPk(waiting.id)).status === "declined");
  await pause(200);
  check("and tells them", (await inboxOf(ot, "subscription.declined")).some((n) => /no longer offered/.test(n.title)));
  const shut = await call("POST", `/subscriptions/${gold.id}/requests`, { token: at });
  check("a closed one takes no new requests", shut.status === 409 && /not taking new requests/.test(shut.body.error.message), say(shut));
  check("someone with no history with it no longer sees it",
    !(await call("GET", "/subscriptions", { token: at })).body.subscriptions.some((s) => s.id === gold.id));
  check("someone with history still does",
    (await call("GET", "/subscriptions", { token: ut })).body.subscriptions.some((s) => s.id === gold.id));
  check("and so do reviewers", (await call("GET", "/subscriptions", { token: dt })).body.subscriptions.some((s) => s.id === gold.id));
  check("a subscription already running is untouched by closing — the check API still says yes",
    validOf(await checkApi(USER), "gold-tier") === true);
  check("and its holder can still cancel it",
    (await call("POST", `/subscriptions/members/${g4.id}/cancel`, { token: ut, body: {} })).status === 200);
  await call("PATCH", `/subscriptions/${gold.id}`, { token: st, body: { isOpen: true } });
  check("reopened, it can be asked for again", (await call("POST", `/subscriptions/${gold.id}/requests`, { token: at })).status === 201);

  const hasHistory = await call("DELETE", `/subscriptions/${gold.id}`, { token: st });
  check("one people have asked for cannot be deleted", hasHistory.status === 409 && /close it/.test(hasHistory.body.error.message), say(hasHistory));
  check("one nobody asked for can", (await call("DELETE", `/subscriptions/${bangla.id}`, { token: st })).status === 200);
  check("and is gone from the check API", !(await checkApi(USER)).body.subscriptions.some((s) => s.code === "subscription"));
  check("deleting needs the manage permission", (await call("DELETE", `/subscriptions/${plus.id}`, { token: dt })).status === 403);

  console.log("\n== the check API from anywhere ==");
  const origin = { Origin: "https://elsewhere.example" };
  const preflight = await call("OPTIONS", "/subscriptions/check", {
    headers: { ...origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
  });
  check("a browser on any site may ask first", preflight.status === 204 && preflight.headers.get("access-control-allow-origin") === "*",
    `${preflight.status} ${preflight.headers.get("access-control-allow-origin")}`);
  check("and send JSON", /content-type/i.test(preflight.headers.get("access-control-allow-headers") || ""));
  const cross = await checkApi(USER, PASSWORD, origin);
  check("and gets its answer", cross.status === 200 && cross.headers.get("access-control-allow-origin") === "*", say(cross));
  check("without the browser's own credentials being involved", cross.headers.get("access-control-allow-credentials") === null);
  const refusedCross = await checkApi(USER, "wrong-password-1", origin);
  check("a refusal reaches that site too", refusedCross.status === 401 && refusedCross.headers.get("access-control-allow-origin") === "*", say(refusedCross));
  const elsewhere = await call("POST", "/auth/login", { body: { email: USER, password: PASSWORD }, headers: origin });
  check("the rest of the API stays closed to other sites",
    elsewhere.status !== 200 && elsewhere.headers.get("access-control-allow-origin") === null, `${elsewhere.status}`);
  // The wrong password above started a run for this account; a right one ends it.
  await checkApi(USER);

  console.log("\n== refusing ==");
  const wrong = await checkApi(USER, "not-the-password");
  const nobody = await checkApi("nobody-here@example.com", "whatever-1");
  check("a wrong password is a 401", wrong.status === 401 && wrong.body.error.message === "Invalid credentials", say(wrong));
  check("and so is an unknown email — with the same words", nobody.status === 401 && JSON.stringify(nobody.body) === JSON.stringify(wrong.body), say(nobody));
  check("neither names anybody", !wrong.body.user && !nobody.body.user && !wrong.body.subscriptions);
  check("a missing password is a 400", (await call("POST", "/subscriptions/check", { body: { email: USER } })).status === 400);
  check("so is something that is not an email", (await checkApi("not-an-email", "x")).status === 400);
  await checkApi(USER);

  console.log("\n== the pause after wrong passwords ==");
  const ADMIN = "unittest-admin@example.com";
  const limit = settings.get("auth.max_failed_sign_ins");
  check("five wrong passwords in a row is the limit", limit === 5, `${limit}`);
  const tries = [];
  for (let i = 0; i < limit; i++) tries.push(await call("POST", "/auth/login", { body: { email: ADMIN, password: `wrong-${i}` } }));
  check("the first four are plain refusals", tries.slice(0, 4).every((t) => t.status === 401), tries.map((t) => t.status).join());
  const fifth = tries[4];
  check("the fifth pauses the account", fifth.status === 429 && /Too many wrong passwords/.test(fifth.body.error.message), say(fifth));
  const retry = Number(fifth.headers.get("retry-after"));
  check("saying how long to wait", retry > 14 * 60 && retry <= 15 * 60, fifth.headers.get("retry-after"));
  const right = await call("POST", "/auth/login", { body: { email: ADMIN, password: PASSWORD } });
  check("the right password is not taken either while paused", right.status === 429, say(right));
  const viaCheck = await checkApi(ADMIN, PASSWORD, origin);
  check("the check API is the same door", viaCheck.status === 429, say(viaCheck));
  check("and a page elsewhere can read the wait", /retry-after/i.test(viaCheck.headers.get("access-control-expose-headers") || ""));
  check("a session already open carries on", (await call("GET", "/auth/me", { token: at })).status === 200);
  check("other accounts are not affected", (await call("POST", "/auth/login", { body: { email: USER, password: PASSWORD } })).status === 200);
  const [warned] = await inboxOf(at, "account.sign_in_paused");
  check("the account's owner is told in the app", !!warned && /Sign-in paused/.test(warned.title), JSON.stringify(warned));

  const ghosts = [];
  for (let i = 0; i < limit + 2; i++) ghosts.push((await checkApi("nobody-here@example.com", `guess-${i}`)).status);
  check("an email with no account is never paused — there is nothing to lock", ghosts.every((s) => s === 401), ghosts.join());

  await User.update({ lockedUntil: new Date(Date.now() - 1000) }, { where: { email: ADMIN } });
  check("once the pause is over the right password works", (await call("POST", "/auth/login", { body: { email: ADMIN, password: PASSWORD } })).status === 200);
  const cleared = await User.findOne({ where: { email: ADMIN } });
  check("and the count starts again", cleared.failedSignIns === 0 && cleared.lockedUntil === null, `${cleared.failedSignIns} ${cleared.lockedUntil}`);

  await User.update(
    { failedSignIns: limit - 1, lastFailedSignInAt: new Date(Date.now() - 3600_000) },
    { where: { email: ADMIN } }
  );
  const stale = await checkApi(ADMIN, "wrong-again");
  check("old mistakes do not count towards a new run", stale.status === 401 && (await User.findOne({ where: { email: ADMIN } })).failedSignIns === 1, say(stale));

  for (let i = 0; i < limit; i++) await checkApi(ADMIN, `wrong-${i}`);
  check("wrong passwords at the check API pause the account too",
    (await call("POST", "/auth/login", { body: { email: ADMIN, password: PASSWORD } })).status === 429);
  await call("POST", "/auth/forgot-password", { body: { email: ADMIN } });
  const code = (await User.findOne({ where: { email: ADMIN } })).verificationCode;
  const reset = await call("POST", "/auth/reset-password", { body: { email: ADMIN, code, newPassword: "BrandNew123!" } });
  check("resetting the password ends the pause", reset.status === 200 &&
    (await call("POST", "/auth/login", { body: { email: ADMIN, password: "BrandNew123!" } })).status === 200, say(reset));

  console.log("\n== at once ==");
  const burst = await Promise.all(
    Array.from({ length: 12 }, (_, i) => call("POST", "/auth/login", { body: { email: "unittest-planner@example.com", password: `burst-${i}` } }))
  );
  const counted = burst.map((b) => b.status);
  check("a burst of guesses is counted one at a time — only the limit get an answer about the password",
    counted.filter((s) => s === 401).length === limit - 1 && counted.filter((s) => s === 429).length === 12 - (limit - 1), counted.join());

  const fresh = (await call("POST", "/subscriptions", { token: st, body: { name: "Race" } })).body.subscription;
  const both = await Promise.all([1, 2, 3].map(() => call("POST", `/subscriptions/${fresh.id}/requests`, { token: at })));
  check("three requests at once make one", both.filter((b) => b.status === 201).length === 1 && both.filter((b) => b.status === 409).length === 2,
    both.map((b) => b.status).join());
  const racing = both.find((b) => b.status === 201).body.subscription;
  const decisions = await Promise.all([
    call("POST", `/subscriptions/members/${racing.id}/approve`, { token: dt, body: { days: 30 } }),
    call("POST", `/subscriptions/members/${racing.id}/decline`, { token: st, body: {} }),
  ]);
  check("two reviewers deciding at once: one decision stands",
    decisions.filter((d) => d.status === 200).length === 1 && decisions.filter((d) => d.status === 409).length === 1,
    decisions.map((d) => d.status).join());

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await sequelize.close();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
