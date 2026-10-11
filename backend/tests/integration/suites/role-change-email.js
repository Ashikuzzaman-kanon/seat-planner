// Changing someone's roles emails them: what was added and removed, who did
// it, and what the account can do now. Changing nothing sends nothing.
//
// Read from the test outbox: the API writes every message it does not actually
// send to EMAIL_OUTBOX, one JSON line each.
const fs = require("fs");

const BASE = process.env.API_BASE;
const OUTBOX = process.env.EMAIL_OUTBOX;
const TARGET = "unittest-target@example.com";

let pass = 0;
let fail = 0;
const check = (what, ok, note = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${ok ? "" : `  -- ${note}`}`);
  ok ? pass++ : fail++;
};

const call = async (method, p, { token, body } = {}) => {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not json */
  }
  return { status: res.status, body: json };
};
const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: "UnitTest123!" } })).body;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Messages to TARGET written since `from` bytes into the outbox. */
const mailSince = (from) =>
  fs
    .readFileSync(OUTBOX)
    .subarray(from) // bytes, like the mark — "৳" and "—" are several bytes each
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((m) => m.to === TARGET);
const mark = () => fs.statSync(OUTBOX).size;

(async () => {
  const su = (await login("unittest-super1@example.com")).accessToken;
  const target = await login(TARGET);
  const targetId = target.user.id;
  const roles = (await call("GET", "/roles", { token: su })).body.roles;
  const id = (name) => roles.find((r) => r.name === name).id;

  console.log("== a role is added ==");
  let at = mark();
  const added = await call("PUT", `/users/${targetId}/roles`, { token: su, body: { roleIds: [id("user"), id("planner")] } });
  check("the change is made", added.status === 200, JSON.stringify(added.body).slice(0, 200));
  await pause(800);
  let mail = mailSince(at);
  check("one email goes to the account", mail.length === 1, `${mail.length} messages`);
  let m = mail[0] || {};
  check("its subject names the new role", /given the Planner role/.test(m.subject || ""), m.subject);
  check("it lists what was added, with what the role is for",
    /Added/.test(m.text) && /Planner — Designs coach seat layouts/.test(m.text), (m.text || "").slice(0, 300));
  check("it names who made the change", /Unit Test Super Admin 1 changed the roles/.test(m.text), (m.text || "").slice(0, 200));
  check("it says what the account can do now", /What you can do now/i.test(m.text) && /Seat plans/.test(m.text));
  check("and how to raise it if it was not expected", /Not expecting this\?/.test(m.text));
  check("nothing renders as a hole", !/undefined|null|NaN|\[object Object\]/.test(`${m.subject} ${m.text}`));

  console.log("\n== a role is removed ==");
  at = mark();
  await call("PUT", `/users/${targetId}/roles`, { token: su, body: { roleIds: [id("user")] } });
  await pause(800);
  m = mailSince(at)[0] || {};
  check("removing sends one too", Boolean(m.subject), "no message");
  check("with a subject that says access changed", /access to Seat Planner has changed/.test(m.subject || ""), m.subject);
  check("listing what was removed", /Removed/.test(m.text) && /Planner/.test(m.text), (m.text || "").slice(0, 300));

  console.log("\n== nothing changes ==");
  at = mark();
  await call("PUT", `/users/${targetId}/roles`, { token: su, body: { roleIds: [id("user")] } });
  await pause(800);
  check("saving the same roles sends nothing", mailSince(at).length === 0, `${mailSince(at).length} messages`);

  console.log("\n== made a super admin ==");
  at = mark();
  await call("PUT", `/users/${targetId}/roles`, { token: su, body: { roleIds: [id("super_admin")] } });
  await pause(800);
  m = mailSince(at)[0] || {};
  check("it says plainly the account can do everything", /Everything — this account is a super admin/.test(m.text), (m.text || "").slice(0, 300));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("suite crashed:", err);
  process.exit(1);
});
