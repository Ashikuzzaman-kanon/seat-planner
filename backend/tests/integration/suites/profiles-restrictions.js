// The profile window, and restricted accounts: who sees what of whom, who may
// restrict whom, and that a restricted account really is out — at sign-in, in
// a session already open, on renewing one, and at the subscription check.
const BACKEND = require("path").resolve(__dirname, "../../..");
const { sequelize, User } = require(`${BACKEND}/src/models`);

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
const signIn = (email, password = PASSWORD) => call("POST", "/auth/login", { body: { email, password } });
const login = async (email) => (await signIn(email)).body;

const USER = "unittest-user@example.com";
const TARGET = "unittest-target@example.com";
const ADMIN = "unittest-admin@example.com";
const CHECKER = "unittest-checker@example.com";
const SUPER2 = "unittest-super2@example.com";

(async () => {
  const sp = await login("unittest-super1@example.com");
  const ap = await login(ADMIN);
  const up = await login(USER);
  const tp = await login(TARGET);
  const [st, at, ut, tt] = [sp, ap, up, tp].map((x) => x.accessToken);
  const idOf = async (email) => (await User.findOne({ where: { email } })).id;
  const [userId, targetId, adminId, checkerId, super2Id] = await Promise.all([USER, TARGET, ADMIN, CHECKER, SUPER2].map(idOf));
  const profile = async (token, id) => call("GET", `/users/${id}/profile`, { token });

  console.log("== the profile window ==");
  const other = await profile(ut, sp.user.id);
  check("anyone signed in can open anyone's profile", other.status === 200, say(other));
  check("but sees only the name and roles",
    other.body.profile.limited === true && other.body.profile.fullName === sp.user.fullName && other.body.profile.roles.includes("super_admin") &&
      other.body.profile.email === undefined && other.body.profile.dateOfBirth === undefined,
    JSON.stringify(other.body.profile));

  const own = await profile(ut, userId);
  check("your own shows everything about you",
    own.body.profile.limited === false && own.body.profile.isSelf && own.body.profile.email === USER && own.body.profile.dateOfBirth === "1990-06-06",
    JSON.stringify(own.body.profile));
  check("the National ID as its last four digits only",
    own.body.profile.nidLast4 === "0066" && !JSON.stringify(own.body).includes("1990000000066"), JSON.stringify(own.body.profile.nidLast4));
  check("and when you last signed in", Math.abs(Date.now() - new Date(own.body.profile.lastSignInAt).getTime()) < 60_000, own.body.profile.lastSignInAt);
  check("with no buttons you cannot use", own.body.profile.can.restrict === false && own.body.profile.can.editRoles === false && own.body.profile.restrictions === undefined,
    JSON.stringify(own.body.profile.can));

  const seenByAdmin = await profile(at, userId);
  check("someone who can view users sees all of it, and the history",
    seenByAdmin.body.profile.limited === false && seenByAdmin.body.profile.email === USER && Array.isArray(seenByAdmin.body.profile.restrictions),
    JSON.stringify(seenByAdmin.body.profile));
  check("and the buttons they may use",
    seenByAdmin.body.profile.can.restrict === true && seenByAdmin.body.profile.can.lift === false && seenByAdmin.body.profile.can.editRoles === true,
    JSON.stringify(seenByAdmin.body.profile.can));
  check("no Restrict button for an account that can do what they cannot",
    (await profile(at, checkerId)).body.profile.can.restrict === false);
  check("an account that does not exist is a 404", (await profile(ut, 999999)).status === 404);
  check("an id that is not one is a 400", (await call("GET", "/users/abc/profile", { token: ut })).status === 400);
  check("and nobody signed out sees any of it", (await call("GET", `/users/${userId}/profile`)).status === 401);

  console.log("\n== who may restrict whom ==");
  const restrict = (token, id, reason = "Test account, not in use") => call("POST", `/users/${id}/restrict`, { token, body: { reason } });
  check("not without the permission", (await restrict(tt, userId)).status === 403);
  const superRefused = await restrict(at, super2Id);
  check("not a super admin", superRefused.status === 403 && /super admin/.test(superRefused.body.error.message), say(superRefused));
  const strongerRefused = await restrict(at, checkerId);
  check("not an account that can do something you cannot", strongerRefused.status === 403 && /permissions you do not/.test(strongerRefused.body.error.message), say(strongerRefused));
  const selfRefused = await restrict(at, adminId);
  check("not your own", selfRefused.status === 403 && /your own account/.test(selfRefused.body.error.message), say(selfRefused));
  check("not without a reason", (await restrict(at, userId, "  ")).status === 400);

  console.log("\n== restricting ==");
  const done = await restrict(at, userId);
  check("an admin can restrict a passenger", done.status === 201 && done.body.restriction.inForce && done.body.restriction.reason === "Test account, not in use", say(done));
  check("it says who did it", done.body.restriction.restrictedBy?.fullName === ap.user.fullName, JSON.stringify(done.body.restriction.restrictedBy));
  check("an account is restricted once", (await restrict(at, userId)).status === 409);

  const session = await call("GET", "/auth/me", { token: ut });
  check("a session already open is refused at once", session.status === 401 && /restricted/.test(session.body.error.message), say(session));
  check("and cannot be renewed", (await call("POST", "/auth/refresh", { body: { refreshToken: up.refreshToken } })).status === 401);
  const signInAgain = await signIn(USER);
  check("signing in is refused, saying why", signInAgain.status === 403 && signInAgain.body.error.message === "This account is restricted. Contact an administrator.", say(signInAgain));
  const wrong = await signIn(USER, "not-the-password");
  check("but only to whoever has the password", wrong.status === 401 && !/restricted/.test(JSON.stringify(wrong.body)), say(wrong));
  const subscriptionCheck = await call("POST", "/subscriptions/check", { body: { email: USER, password: PASSWORD, deviceId: "restricted-device-01", platform: "windows" } });
  check("the subscription check refuses it the same way", subscriptionCheck.status === 403 && /restricted/.test(subscriptionCheck.body.error.message), say(subscriptionCheck));

  await User.update({ verificationCode: "424242", verificationCodeExpires: new Date(Date.now() + 600_000) }, { where: { id: userId } });
  const reset = await call("POST", "/auth/reset-password", { body: { email: USER, code: "424242", newPassword: PASSWORD } });
  check("resetting the password works", reset.status === 200, say(reset));
  check("but does not undo the restriction", (await signIn(USER)).status === 403);

  const staffView = (await profile(at, userId)).body.profile;
  check("staff see it on the profile, with the reason", staffView.restriction?.reason === "Test account, not in use" && staffView.can.lift && !staffView.can.restrict,
    JSON.stringify({ restriction: staffView.restriction, can: staffView.can }));
  const restrictedList = await call("GET", "/users?status=restricted", { token: at });
  check("and on the Users list, filtered", restrictedList.body.users.some((u) => u.id === userId) && restrictedList.body.users.every((u) => u.restrictedAt),
    JSON.stringify(restrictedList.body.users.map((u) => u.email)));
  check("which the active filter leaves out", !(await call("GET", "/users?status=active&limit=100", { token: at })).body.users.some((u) => u.id === userId));
  check("a status that is not one is a 400", (await call("GET", "/users?status=gone", { token: at })).status === 400);

  console.log("\n== lifting ==");
  const lift = (token, id, note) => call("POST", `/users/${id}/lift-restriction`, { token, body: note ? { note } : {} });
  check("not without the permission", (await lift(tt, userId)).status === 403);
  const lifted = await lift(at, userId, "Needed for testing this week");
  check("an admin can lift it", lifted.status === 200 && lifted.body.lifted === true, say(lifted));
  check("an account that is not restricted cannot be lifted", (await lift(at, userId)).status === 409);
  check("then it signs in again", (await signIn(USER)).status === 200);
  const history = (await profile(at, userId)).body.profile;
  check("and the history keeps who restricted it, who lifted it and why",
    history.restriction === null && history.restrictions.length === 1 && history.restrictions[0].liftedBy?.fullName === ap.user.fullName &&
      history.restrictions[0].liftNote === "Needed for testing this week" && history.restrictions[0].inForce === false,
    JSON.stringify(history.restrictions));

  const superOnAdmin = await restrict(st, adminId, "Holiday cover ended");
  check("a super admin can restrict an admin", superOnAdmin.status === 201, say(superOnAdmin));
  check("who is then out too", (await signIn(ADMIN)).status === 403);
  check("and back in when lifted", (await lift(st, adminId)).status === 200 && (await signIn(ADMIN)).status === 200);
  const at2 = (await login(ADMIN)).accessToken;

  console.log("\n== several at once ==");
  const many = await call("POST", "/users/restrict", {
    token: at2,
    body: { userIds: [userId, targetId, adminId, checkerId, 999999, userId], reason: "Test accounts off for the weekend" },
  });
  const result = (id) => many.body.results.find((r) => r.userId === id);
  check("several accounts can be restricted together", many.status === 200 && many.body.done === 2 && result(userId).done && result(targetId).done, say(many));
  check("each refused one says why, and stops nothing else",
    /your own account/.test(result(adminId).error) && /permissions you do not/.test(result(checkerId).error) && /No such account/.test(result(999999).error),
    JSON.stringify(many.body.results));
  check("an account named twice is done once", many.body.results.filter((r) => r.userId === userId).length === 1);
  check("both are out", (await signIn(USER)).status === 403 && (await signIn(TARGET)).status === 403);
  const liftMany = await call("POST", "/users/lift-restriction", { token: at2, body: { userIds: [userId, targetId] } });
  check("and lifted together", liftMany.status === 200 && liftMany.body.done === 2, say(liftMany));
  check("both are back", (await signIn(USER)).status === 200 && (await signIn(TARGET)).status === 200);
  check("a list of none is refused", (await call("POST", "/users/restrict", { token: at2, body: { userIds: [], reason: "x" } })).status === 400);
  check("so is one of more than a hundred",
    (await call("POST", "/users/restrict", { token: at2, body: { userIds: Array.from({ length: 101 }, (_, i) => i + 1), reason: "x" } })).status === 400);
  check("and several without a reason", (await call("POST", "/users/restrict", { token: at2, body: { userIds: [userId] } })).status === 400);
  check("only with the permission", (await call("POST", "/users/restrict", { token: tt, body: { userIds: [userId], reason: "x" } })).status === 403);

  console.log("\n== the audit log, when there is one ==");
  const logged = async (action) => (await call("GET", `/audit?action=${action}&limit=20`, { token: st })).body;
  if ((await logged("account.restrict")).available === false) {
    console.log("  (no document store here — skipped)");
  } else {
    await pause(300);
    const restricted = (await logged("account.restrict")).events;
    check("every restriction is recorded with its reason",
      restricted.some((e) => e.entity?.label === USER && e.after?.reason === "Test account, not in use"), JSON.stringify(restricted.slice(0, 3).map((e) => e.after)));
    const unrestricted = (await logged("account.unrestrict")).events;
    check("and every lifting, with its note", unrestricted.some((e) => e.entity?.label === USER && e.after?.note === "Needed for testing this week"),
      JSON.stringify(unrestricted.slice(0, 3).map((e) => e.after)));
    const refused = (await call("GET", "/audit?action=auth.login_failed&limit=50", { token: st })).body.events;
    check("a sign-in refused because of it is recorded as that", refused.some((e) => e.after?.reason === "account restricted"),
      JSON.stringify(refused.slice(0, 3).map((e) => e.after)));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await sequelize.close();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
