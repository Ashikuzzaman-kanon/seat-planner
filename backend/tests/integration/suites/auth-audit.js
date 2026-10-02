// Sign-in, account creation and password reset leave audit entries — the
// failures as well as the successes — naming the account, never a password
// or a code.
//
// Uses a throwaway `unittest-` account, removed at the end.
const BACKEND = require("path").resolve(__dirname, "../../..");
const mongoose = require(`${BACKEND}/node_modules/mongoose`);
require(`${BACKEND}/node_modules/dotenv`).config({ path: `${BACKEND}/.env` });
const { User } = require(`${BACKEND}/src/models`);

const BASE = process.env.API_BASE;
const EMAIL = `unittest-auth-audit-${Date.now()}@example.com`;
const PASSWORD = "AuditProbe123!";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};
const call = async (path, body) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

(async () => {
  if (!process.env.MONGO_URI) {
    console.log("  SKIP  no MONGO_URI — the audit log is not recorded without MongoDB");
    console.log("\n0 passed, 0 failed\n");
    process.exit(0);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const events = mongoose.connection.db.collection("audit_events");
  const started = new Date();
  const since = async (action) =>
    events.find({ action, "actor.email": EMAIL, at: { $gte: started } }).sort({ at: 1 }).toArray();
  const settle = () => new Promise((r) => setTimeout(r, 300));

  console.log("== creating an account ==");
  const reg = await call("/auth/register", { fullName: "Audit Probe", email: EMAIL, password: PASSWORD });
  check("registration accepted", reg.status === 201 || reg.status === 200, `${reg.status}`);
  await settle();
  const [registered] = await since("auth.register");
  check("it is recorded", Boolean(registered));
  check("credited to the new account, not to 'system'", registered?.actor?.id > 0 && registered?.actor?.email === EMAIL,
    JSON.stringify(registered?.actor));
  check("with the address it came from", Boolean(registered?.context?.ipAddress), JSON.stringify(registered?.context));
  check("and no password anywhere in it", !JSON.stringify(registered).includes(PASSWORD));

  console.log("\n== signing in before verifying ==");
  const early = await call("/auth/login", { email: EMAIL, password: PASSWORD });
  check("is refused", early.status === 403, `${early.status}`);
  await settle();
  const [unverified] = await since("auth.login_failed");
  check("and recorded as a failure, with why", unverified?.outcome === "failure" && /not verified/.test(unverified?.after?.reason || ""),
    JSON.stringify(unverified?.after));

  console.log("\n== verifying the email ==");
  const user = await User.findOne({ where: { email: EMAIL } });
  const verified = await call("/auth/verify-email", { email: EMAIL, code: user.verificationCode });
  check("verification succeeds", verified.status === 200, `${verified.status}`);
  await settle();
  const [done] = await since("auth.verify_email");
  check("is recorded", Boolean(done) && done.outcome === "success");
  check("without the code in it", !JSON.stringify(done).includes(user.verificationCode));

  console.log("\n== signing in ==");
  const wrong = await call("/auth/login", { email: EMAIL, password: "not-the-password" });
  check("a wrong password is refused", wrong.status === 401, `${wrong.status}`);
  const ok = await call("/auth/login", { email: EMAIL, password: PASSWORD });
  check("the right one signs in", ok.status === 200 && Boolean(ok.body?.accessToken), `${ok.status}`);
  const ghost = `unittest-nobody-${Date.now()}@example.com`;
  await call("/auth/login", { email: ghost, password: "whatever" });
  await settle();

  const failures = await since("auth.login_failed");
  check("the wrong password is recorded, saying so", failures.some((e) => e.after?.reason === "wrong password"),
    JSON.stringify(failures.map((e) => e.after)));
  check("without the password that was tried", !failures.some((e) => JSON.stringify(e).includes("not-the-password")));
  const [signedIn] = await since("auth.login");
  check("a successful sign-in is recorded", signedIn?.outcome === "success" && signedIn?.message === "signed in");
  check("with the roles held at the time", Array.isArray(signedIn?.actor?.roles) && signedIn.actor.roles.includes("user"),
    JSON.stringify(signedIn?.actor));
  const unknown = await events.findOne({ action: "auth.login_failed", "actor.email": ghost, at: { $gte: started } });
  check("an attempt on an address with no account is recorded too", unknown?.after?.reason === "no account with that email" && unknown?.actor?.id === null,
    JSON.stringify(unknown));

  console.log("\n== resetting the password ==");
  const forgot = await call("/auth/forgot-password", { email: EMAIL });
  check("a reset is requested", forgot.status === 200, `${forgot.status}`);
  await settle();
  const [asked] = await since("auth.password_reset_request");
  check("the request is recorded", asked?.after?.codeSent === true);

  const badCode = await call("/auth/reset-password", { email: EMAIL, code: "000000", newPassword: "NewPassword123!" });
  check("a wrong code is refused", badCode.status === 400, `${badCode.status}`);
  await settle();
  const [refused] = await since("auth.password_reset_failed");
  check("and recorded as a failure", refused?.outcome === "failure" && refused?.after?.reason === "wrong code",
    JSON.stringify(refused?.after));

  const fresh = await User.findOne({ where: { email: EMAIL } });
  const reset = await call("/auth/reset-password", { email: EMAIL, code: fresh.verificationCode, newPassword: "NewPassword123!" });
  check("the right code resets it", reset.status === 200, `${reset.status}`);
  await settle();
  const [changed] = await since("auth.password_reset");
  check("the reset is recorded", changed?.outcome === "success");
  check("and no new password is written", !JSON.stringify(changed).includes("NewPassword123!"));

  const unknownReset = await call("/auth/forgot-password", { email: ghost });
  check("asking to reset an unknown address still answers the same", unknownReset.status === 200, `${unknownReset.status}`);
  await settle();
  const quiet = await events.findOne({ action: "auth.password_reset_request", "actor.email": ghost, at: { $gte: started } });
  check("but the log notes nothing was sent", quiet?.after?.codeSent === false && quiet?.outcome === "failure", JSON.stringify(quiet));

  console.log("\n== the audit screen hides these with the test accounts ==");
  const admin = await (await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "unittest-super1@example.com", password: "UnitTest123!" }),
  })).json();
  const visible = await (await fetch(`${BASE}/audit?limit=100&excludeTests=1&action=auth.login_failed`, {
    headers: { Authorization: `Bearer ${admin.accessToken}` },
  })).json();
  check("filtered out when 'hide test activity' is on",
    !(visible.events || []).some((e) => String(e.actor?.email || "").startsWith("unittest-")),
    JSON.stringify((visible.events || []).map((e) => e.actor?.email)));

  // Tidy up the probe account.
  await User.destroy({ where: { email: EMAIL } });
  await mongoose.disconnect();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
