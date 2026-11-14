// Profiles and restricting accounts, the way staff would use them: open
// someone's profile from their name, restrict the account with a reason, see
// it refused at sign-in and at the subscription check, lift it again; then the
// same for several accounts at once from Users, and the profile window on a
// phone.
//
//   node people-ui.js
//
// It restricts unittest-target@example.com and always lifts it again, before
// and after, so an earlier run that stopped half-way leaves nothing behind.
const config = require("./config");
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = config.CHROME;
const BASE = config.WEB;
const OUT = config.SHOTS;
const USERS = `${BASE}/dashboard/users`;

const STAFF = "unittest-super1@example.com"; // holds every permission
const TARGET = "unittest-target@example.com";
const PASSENGER = "unittest-user@example.com";
const PASSWORD = "UnitTest123!";
const REASON = `Browser check ${Date.now().toString(36)}`;

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, route, { token, body } = {}) {
  const res = await fetch(config.API + route, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

async function signedIn(browser, email, viewport) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("input[type=password]", PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);
  return { page, errors };
}

async function waitFor(page, fn, arg, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    await sleep(300);
  }
  return null;
}

const dialogText = (page) => page.evaluate(() => document.querySelector(".profile-dialog")?.innerText || "");
const dialogGone = (page) => waitFor(page, () => !document.querySelector(".p-dialog-mask"));

const clickButton = (page, within, pattern) =>
  page.evaluate(
    (within, source) => {
      const button = [...document.querySelectorAll(`${within} button`)].find((b) => new RegExp(source).test(b.textContent.trim()) && !b.disabled);
      if (button) button.click();
      return Boolean(button);
    },
    within,
    pattern
  );

/** The Users row for an email, as text. */
const rowOf = (page, email) =>
  page.evaluate((email) => [...document.querySelectorAll(".p-datatable tbody tr")].find((r) => r.textContent.includes(email))?.innerText || null, email);

/** Tick an account's box on Users, with the mouse as a person would. */
async function tickRow(page, email) {
  const rows = await page.$$(".p-datatable tbody tr");
  for (const row of rows) {
    if ((await row.evaluate((r) => r.textContent)).includes(email)) {
      await (await row.$(".p-checkbox")).click();
      return true;
    }
  }
  return false;
}

(async () => {
  const staff = (await api("POST", "/auth/login", { body: { email: STAFF, password: PASSWORD } })).body;
  const target = (await api("POST", "/auth/login", { body: { email: TARGET, password: PASSWORD } })).body;
  const targetId = target?.user?.id || (await api("GET", `/users?search=${encodeURIComponent(TARGET)}`, { token: staff.accessToken })).body.users[0].id;
  const liftIfNeeded = () => api("POST", `/users/${targetId}/lift-restriction`, { token: staff.accessToken, body: { note: "Left by an earlier browser check" } });
  await liftIfNeeded();

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const laptop = { width: 1440, height: 900 };

  /* ---------------- A profile from a name ---------------- */
  console.log("== a profile, opened from a name ==");
  const admin = await signedIn(browser, STAFF, laptop);
  await admin.page.goto(`${USERS}?q=${encodeURIComponent(TARGET)}`, { waitUntil: "networkidle0" });
  await waitFor(admin.page, (email) => [...document.querySelectorAll(".p-datatable tbody tr")].some((r) => r.textContent.includes(email)), TARGET);
  check("a name on Users is a link to the profile", Boolean(await admin.page.$(".p-datatable tbody .person-link")));
  await admin.page.evaluate((email) => {
    const row = [...document.querySelectorAll(".p-datatable tbody tr")].find((r) => r.textContent.includes(email));
    row.querySelector(".person-link").click();
  }, TARGET);
  await admin.page.waitForSelector(".profile-fields");
  let seen = await dialogText(admin.page);
  check("it opens on their details", seen.includes(TARGET) && /Member since/.test(seen) && /Last sign-in/.test(seen), seen.slice(0, 300));
  check("with the national ID hidden but its last four", !/National ID\s*\n?\s*\d{5,}/.test(seen), seen);
  check("and a button to restrict the account", await admin.page.evaluate(() => [...document.querySelectorAll(".profile-dialog button")].some((b) => /Restrict account/.test(b.textContent))));
  await admin.page.screenshot({ path: path.join(OUT, "people-1-profile.png") });

  /* ---------------- Restricting it ---------------- */
  console.log("\n== restricting it ==");
  await clickButton(admin.page, ".profile-dialog", "^Restrict account$");
  await admin.page.waitForSelector("#profile-act-text");
  check("a reason is needed", await admin.page.evaluate(() =>
    [...document.querySelectorAll(".profile-act button")].find((b) => /Restrict account/.test(b.textContent))?.disabled === true));
  await admin.page.type("#profile-act-text", REASON);
  await clickButton(admin.page, ".profile-act", "^Restrict account$");
  check("then it is restricted, with who and why",
    Boolean(await waitFor(admin.page, (reason) => {
      const box = document.querySelector(".profile-restriction");
      return box && box.textContent.includes(reason) && /Unit Test Super Admin 1/.test(box.textContent);
    }, REASON)));
  seen = await dialogText(admin.page);
  check("and the window offers to lift it instead", /Lift restriction/.test(seen) && !/Restrict account/.test(seen), seen);
  check("and keeps it in the history", /In force/.test(seen));
  await admin.page.screenshot({ path: path.join(OUT, "people-2-restricted.png") });
  await admin.page.keyboard.press("Escape");
  await dialogGone(admin.page);
  check("the Users list marks it Restricted", Boolean(await waitFor(admin.page, (email) =>
    /Restricted/.test([...document.querySelectorAll(".p-datatable tbody tr")].find((r) => r.textContent.includes(email))?.innerText || ""), TARGET)));

  const login = await api("POST", "/auth/login", { body: { email: TARGET, password: PASSWORD } });
  check("it cannot sign in, and is told why", login.status === 403 && /restricted/i.test(JSON.stringify(login.body)), JSON.stringify(login.body));
  const wrong = await api("POST", "/auth/login", { body: { email: TARGET, password: "not-the-password" } });
  check("but a wrong password says nothing of it", wrong.status === 401 && !/restricted/i.test(JSON.stringify(wrong.body)), JSON.stringify(wrong.body));
  const session = await api("GET", "/auth/me", { token: target?.accessToken });
  check("the session it had is over", session.status === 401, `${session.status}`);
  const checked = await api("POST", "/subscriptions/check", { body: { email: TARGET, password: PASSWORD, deviceId: "people-check-1", platform: "windows" } });
  check("and the subscription check refuses it the same way", checked.status === 403 && /restricted/i.test(JSON.stringify(checked.body)), JSON.stringify(checked.body));

  // Signing in on the page says so too.
  const refused = await browser.createBrowserContext();
  const loginPage = await refused.newPage();
  await loginPage.setViewport(laptop);
  await loginPage.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await loginPage.type("#email", TARGET);
  await loginPage.type("input[type=password]", PASSWORD);
  await loginPage.click("button[type=submit]");
  check("the sign-in page shows the restriction",
    Boolean(await waitFor(loginPage, () => /restricted/i.test(document.body.innerText))));
  await refused.close();

  /* ---------------- Who sees what ---------------- */
  console.log("\n== who sees what ==");
  const passenger = (await api("POST", "/auth/login", { body: { email: PASSENGER, password: PASSWORD } })).body;
  const theirs = (await api("GET", `/users/${targetId}/profile`, { token: passenger.accessToken })).body?.profile;
  check("someone without user:view sees only a name and roles",
    theirs?.limited === true && !("email" in theirs) && Array.isArray(theirs.roles), JSON.stringify(theirs));
  const own = (await api("GET", `/users/${passenger.user.id}/profile`, { token: passenger.accessToken })).body?.profile;
  check("and their own profile in full, with nothing they can do to it",
    own?.limited === false && own.email === PASSENGER && !own.can.restrict && !own.can.lift, JSON.stringify(own));
  const self = await api("POST", `/users/${staff.user.id}/restrict`, { token: staff.accessToken, body: { reason: "test" } });
  check("nobody can restrict their own account", self.status === 403, JSON.stringify(self.body));

  /* ---------------- Lifting it ---------------- */
  console.log("\n== lifting it ==");
  await admin.page.evaluate((email) => {
    const row = [...document.querySelectorAll(".p-datatable tbody tr")].find((r) => r.textContent.includes(email));
    row.querySelector(".person-link").click();
  }, TARGET);
  await admin.page.waitForSelector(".profile-restriction");
  await clickButton(admin.page, ".profile-dialog", "^Lift restriction$");
  await admin.page.waitForSelector("#profile-act-text");
  await admin.page.type("#profile-act-text", "Browser check done");
  await clickButton(admin.page, ".profile-act", "^Lift restriction$");
  check("the restriction can be lifted", Boolean(await waitFor(admin.page, () =>
    !document.querySelector(".profile-restriction") && /Lifted/.test(document.querySelector(".profile-history")?.textContent || ""))));
  check("after which it can sign in again", (await api("POST", "/auth/login", { body: { email: TARGET, password: PASSWORD } })).status === 200);
  await admin.page.keyboard.press("Escape");
  await dialogGone(admin.page);

  /* ---------------- Several at once ---------------- */
  console.log("\n== several at once ==");
  await waitFor(admin.page, (email) => !/Restricted/.test([...document.querySelectorAll(".p-datatable tbody tr")].find((r) => r.textContent.includes(email))?.innerText || "x"), TARGET);
  await tickRow(admin.page, TARGET);
  check("ticking an account brings up what can be done to the selected",
    Boolean(await waitFor(admin.page, () => /1 selected/.test(document.querySelector(".users-bulk")?.textContent || ""))));
  await clickButton(admin.page, ".users-bulk", "^Restrict$");
  await admin.page.waitForSelector("#bulk-text");
  await admin.page.type("#bulk-text", `${REASON} (bulk)`);
  await clickButton(admin.page, ".p-dialog-footer", "^Restrict$");
  await dialogGone(admin.page);
  check("and restricts them together", Boolean(await waitFor(admin.page, (email) =>
    /Restricted/.test([...document.querySelectorAll(".p-datatable tbody tr")].find((r) => r.textContent.includes(email))?.innerText || ""), TARGET)));
  check("which the server agrees with", (await api("POST", "/auth/login", { body: { email: TARGET, password: PASSWORD } })).status === 403);
  await admin.page.screenshot({ path: path.join(OUT, "people-3-bulk.png") });

  await tickRow(admin.page, TARGET);
  await waitFor(admin.page, () => Boolean(document.querySelector(".users-bulk")));
  await clickButton(admin.page, ".users-bulk", "^Lift restriction$");
  await admin.page.waitForSelector("#bulk-text");
  await clickButton(admin.page, ".p-dialog-footer", "^Lift restriction$");
  await dialogGone(admin.page);
  check("and lifts them together", Boolean(await waitFor(admin.page, (email) =>
    !/Restricted/.test([...document.querySelectorAll(".p-datatable tbody tr")].find((r) => r.textContent.includes(email))?.innerText || "Restricted"), TARGET)));
  check("so it can sign in again", (await api("POST", "/auth/login", { body: { email: TARGET, password: PASSWORD } })).status === 200);

  /* ---------------- Names elsewhere; the phone ---------------- */
  console.log("\n== names elsewhere, and the phone ==");
  await admin.page.goto(`${BASE}/dashboard/audit`, { waitUntil: "networkidle0" });
  const auditLinks = await waitFor(admin.page, () => document.querySelectorAll(".person-link").length, null, 8000);
  // The audit log is only there when it is configured.
  const auditOn = await admin.page.evaluate(() => !/not configured|unavailable/i.test(document.body.innerText));
  if (auditOn) check("names in the audit log open profiles too", auditLinks > 0, `${auditLinks}`);

  const phone = await signedIn(browser, STAFF, { width: 390, height: 844 });
  await phone.page.goto(`${USERS}?q=${encodeURIComponent(TARGET)}`, { waitUntil: "networkidle0" });
  await waitFor(phone.page, () => Boolean(document.querySelector(".p-datatable tbody .person-link")));
  await phone.page.evaluate(() => document.querySelector(".p-datatable tbody .person-link").click());
  await phone.page.waitForSelector(".profile-fields");
  const fits = await phone.page.evaluate(() => {
    const box = document.querySelector(".profile-dialog").getBoundingClientRect();
    return box.left >= 0 && box.right <= window.innerWidth && document.documentElement.scrollWidth <= window.innerWidth;
  });
  check("the profile window fits a phone", fits);
  await phone.page.screenshot({ path: path.join(OUT, "people-4-phone.png") });

  const errors = [...admin.errors, ...phone.errors];
  check("no browser errors along the way", errors.length === 0, errors.join(" | "));

  await browser.close();
  await liftIfNeeded();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
