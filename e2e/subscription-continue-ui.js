// Continuing subscriptions that ended, in a real browser: a reviewer
// continues one the person cancelled themselves (and is warned so), with the
// devices it had and as long as last time; the person, after it is cancelled
// again, asks to continue it; the reviewer sees the request is a continuation,
// and approves it; the subscribers list says how often it was continued; at
// phone width. A subscription once used cannot be deleted, so it keeps one of
// its own ("E2E Continue"), opened for the run and closed after it.
//
// Needs the API and the web app running locally with the development data.
const config = require("./config");
const puppeteer = require("puppeteer-core");

const BASE = config.WEB;
const API = config.API;
const PASSWORD = "UnitTest123!";
const NAME = "E2E Continue";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, arg, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    await sleep(200);
  }
  return null;
}

async function api(token, method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json().catch(() => null);
}

async function signIn(browser, email, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("input[type=password]", PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);
  return page;
}

const clickText = (page, selector, pattern) =>
  page.evaluate((s, p) => {
    const b = [...document.querySelectorAll(s)].find((x) => new RegExp(p).test(x.textContent.trim()) && !x.disabled);
    if (b) b.click();
    return b ? b.textContent.trim() : null;
  }, selector, pattern);
const dialogText = (page) => page.evaluate(() => (document.querySelector(".p-dialog")?.innerText || "").replace(/\s+/g, " "));
/** The subscribers' row for our subscription, as text. */
const ourRow = (page) =>
  page.evaluate((name) => {
    const row = [...document.querySelectorAll(".sub-table tbody tr")].find((r) => r.innerText.includes(name) && r.innerText.includes("unittest-user"));
    return row ? row.innerText.replace(/\s+/g, " ") : null;
  }, NAME);

(async () => {
  const S = (await api(null, "POST", "/auth/login", { email: "unittest-super1@example.com", password: PASSWORD })).accessToken;
  const U = (await api(null, "POST", "/auth/login", { email: "unittest-user@example.com", password: PASSWORD })).accessToken;
  // Its own subscription, from an earlier run or new; open for this one.
  let sub = (await api(S, "GET", "/subscriptions")).subscriptions.find((s) => s.code === "e2e-continue");
  if (sub) await api(S, "PATCH", `/subscriptions/${sub.id}`, { isOpen: true });
  else sub = (await api(S, "POST", "/subscriptions", { name: NAME, code: "e2e-continue" })).subscription;
  // The passenger's record, running for 5 days, then cancelled by them.
  const theirs = async () =>
    (await api(S, "GET", `/subscriptions/members?search=unittest-user&subscriptionId=${sub.id}`)).members[0] || null;
  let asked = await theirs();
  if (!asked) asked = (await api(U, "POST", `/subscriptions/${sub.id}/requests`)).subscription;
  else if (asked.status === "pending") await api(S, "POST", `/subscriptions/members/${asked.id}/approve`, { days: 5 });
  else if (!asked.valid) await api(S, "POST", `/subscriptions/members/${asked.id}/resume`, { days: 5 });
  if ((await theirs()).status === "pending") await api(S, "POST", `/subscriptions/members/${asked.id}/approve`, { days: 5 });
  await api(U, "POST", `/subscriptions/members/${asked.id}/cancel`, { reason: "Too dear" });
  const before = (await theirs()).history.length;
  const record = async () => (await api(S, "GET", "/subscriptions/members?search=unittest-user")).members.find((m) => m.id === asked.id);

  const browser = await puppeteer.launch({ executablePath: config.CHROME, headless: "new", args: ["--no-sandbox"] });
  try {
    console.log("== a reviewer continues one the person cancelled ==");
    const reviewer = await signIn(browser, "unittest-super1@example.com");
    await reviewer.goto(`${BASE}/dashboard/subscriptions?tab=subscribers`, { waitUntil: "networkidle0" });
    await reviewer.waitForSelector(".sub-filters");
    await clickText(reviewer, ".sub-filters .sub-chip", "^Cancelled$");
    await reviewer.type(".sub-filters input", "unittest-user");
    const row = await waitFor(reviewer, (name) => [...document.querySelectorAll(".sub-table tbody tr")].some((r) => r.innerText.includes(name)), NAME);
    check("the cancelled one is listed, with Continue", Boolean(row) && Boolean(await reviewer.$('.sub-table button[aria-label="Continue it"]')));
    await reviewer.evaluate((name) => {
      const r = [...document.querySelectorAll(".sub-table tbody tr")].find((x) => x.innerText.includes(name));
      r.querySelector('button[aria-label="Continue it"]').click();
    }, NAME);
    await reviewer.waitForSelector(".p-dialog");
    const warned = await dialogText(reviewer);
    check("the dialog says how it ended, and that they ended it themselves", /Cancelled/.test(warned) && /by them/.test(warned) &&
      /They cancelled it themselves/.test(warned) && /Too dear/.test(warned), warned);
    check("as long as last time, with the devices it had", /Continue until/.test(warned) && /as it had/.test(warned), warned);
    await clickText(reviewer, ".p-dialog .p-button", "^Continue until");
    await waitFor(reviewer, () => /Continued/.test(document.body.innerText));
    const after = await record();
    check("running again: the same record, its history kept", after.status === "active" && after.history.length === before + 1 &&
      after.history[0].reason === "Too dear", JSON.stringify(after?.history));

    console.log("\n== the person asks to continue ==");
    await api(S, "POST", `/subscriptions/members/${asked.id}/cancel`, { reason: "Paused" });
    const person = await signIn(browser, "unittest-user@example.com");
    await person.goto(`${BASE}/dashboard/subscriptions`, { waitUntil: "networkidle0" });
    const buttons = await waitFor(person, (name) => {
      const el = [...document.querySelectorAll(".sub-card")].find((c) => c.querySelector("h3")?.textContent === name);
      return el ? [...el.querySelectorAll(".sub-card__actions .p-button")].map((b) => b.textContent.trim()) : null;
    }, NAME);
    check("their card offers Ask to continue", JSON.stringify(buttons) === JSON.stringify(["Ask to continue"]), JSON.stringify(buttons));
    await person.evaluate((name) => {
      const el = [...document.querySelectorAll(".sub-card")].find((c) => c.querySelector("h3")?.textContent === name);
      [...el.querySelectorAll(".p-button")].find((b) => b.textContent.trim() === "Ask to continue").click();
    }, NAME);
    await person.waitForSelector(".p-dialog");
    check("the dialog says it carries on", /Ask to continue E2E Continue/.test(await dialogText(person)) && /carries on/.test(await dialogText(person)));
    await clickText(person, ".p-dialog .p-button", "^Send request$");
    const standing = await waitFor(person, (name) => {
      const el = [...document.querySelectorAll(".sub-card")].find((c) => c.querySelector("h3")?.textContent === name);
      const t = el?.querySelector(".sub-standing")?.textContent.trim();
      return /waiting/.test(t || "") ? t : null;
    }, NAME);
    check("it waits, as a continuation", standing === "Asked to continue — waiting for approval", standing);

    console.log("\n== the reviewer approves it ==");
    await reviewer.goto(`${BASE}/dashboard/subscriptions?tab=requests`, { waitUntil: "networkidle0" });
    const card = await waitFor(reviewer, (name) => {
      const c = [...document.querySelectorAll(".sub-request")].find((x) => x.innerText.includes(name));
      return c ? c.innerText.replace(/\s+/g, " ") : null;
    }, NAME);
    check("the request says it continues one, and how that ended", /asked to continue/i.test(card || "") && /Cancelled/.test(card || "") &&
      /Paused/.test(card || ""), card);
    await reviewer.evaluate((name) => {
      const c = [...document.querySelectorAll(".sub-request")].find((x) => x.innerText.includes(name));
      [...c.querySelectorAll(".p-button")].find((b) => b.textContent.trim() === "Approve").click();
    }, NAME);
    await reviewer.waitForSelector(".p-dialog");
    await clickText(reviewer, ".p-dialog .p-button", "^Approve until");
    await waitFor(reviewer, () => /Approved/.test(document.body.innerText));
    const approved = await record();
    check("approved: running, two earlier periods kept", approved.status === "active" && approved.history.length === before + 2, JSON.stringify(approved));

    await reviewer.goto(`${BASE}/dashboard/subscriptions?tab=subscribers`, { waitUntil: "networkidle0" });
    await reviewer.type(".sub-filters input", "unittest-user");
    const listed = await waitFor(reviewer, (name) => {
      const r = [...document.querySelectorAll(".sub-table tbody tr")].find((x) => x.innerText.includes(name));
      return r ? r.innerText.replace(/\s+/g, " ") : null;
    }, NAME);
    check("the subscribers list says how often it was continued", new RegExp(`continued ${before + 2}×`).test(listed || ""), listed);

    console.log("\n== the phone ==");
    const phone = await signIn(browser, "unittest-super1@example.com", { width: 390, height: 844, isMobile: true, hasTouch: true });
    await phone.goto(`${BASE}/dashboard/subscriptions?tab=subscribers`, { waitUntil: "networkidle0" });
    await sleep(500);
    check("the subscribers fit a phone", await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 0));

    const errors = [...reviewer.errors, ...person.errors, ...phone.errors];
    check("no browser errors along the way", errors.length === 0, errors.join(" | "));
  } finally {
    // Nothing left running, and closed until the next run.
    const last = await theirs().catch(() => null);
    if (last?.valid || last?.status === "pending") await api(S, "POST", `/subscriptions/members/${last.id}/cancel`, { reason: "End of the test" });
    await api(S, "PATCH", `/subscriptions/${sub.id}`, { isOpen: false }).catch(() => {});
    await browser.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
