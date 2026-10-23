// Seat Allocation for everyone, the way a stranger meets it: the sign-in
// page's button, the public page with where its data comes from, a few free
// searches, the invitation to sign in, signing in and carrying on; then a
// passenger in the app, a manager's view of the visits, and the page switched
// off. Settings are put back at the end.
//
//   node public-ui.js
//
// Needs the API and the web app running with allocation data uploaded and the
// unit-test accounts. To take the bot check too, start the API with
// Cloudflare's test keys, which always pass:
//   TURNSTILE_SITE_KEY=1x00000000000000000000AA TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
const path = require("path");
const config = require("./config");
const puppeteer = require("puppeteer-core");

const BASE = config.WEB;
const API = config.API;
const OUT = config.SHOTS;
const PASSWORD = "UnitTest123!";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, arg, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    await sleep(250);
  }
  return null;
}

async function apiAs(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const { accessToken } = await res.json();
  return (method, url, body) =>
    fetch(API + url, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
}

async function newPage(browser, width = 1440, height = 900) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  return page;
}

async function signIn(page, email, next = "") {
  await page.goto(`${BASE}/login${next}`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("input[type=password]", PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);
}

const results = (page) =>
  waitFor(page, () => document.querySelector(".al-pair, .al-none, .pub-invite, .pub-message h2")?.closest("section, li, p")?.innerText || null);

async function pickFrom(page, index) {
  await page.click("#al-from");
  await page.waitForSelector(".p-dropdown-panel");
  await sleep(150);
  await page.evaluate((i) => document.querySelectorAll(".p-dropdown-panel .p-dropdown-item")[i].click(), index);
  await sleep(700);
}

(async () => {
  const admin = await apiAs("unittest-super1@example.com");
  const set = (key, value) => admin("PUT", `/settings/${key}`, { value });
  await set("allocation.public_enabled", true);
  await set("allocation.public_free_searches", 3);
  const browser = await puppeteer.launch({ executablePath: config.CHROME, headless: "new", args: ["--no-sandbox"] });

  try {
    console.log("== the sign-in page ==");
    const guest = await newPage(browser);
    await guest.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
    const button = await waitFor(guest, () => document.querySelector(".auth-public")?.innerText);
    check("has a button to Seat Allocation, free, no account needed",
      /Check seat allocation/.test(button || "") && /Free · no account needed/.test(button || ""), button || "");
    await guest.screenshot({ path: path.join(OUT, "public-1-login.png") });

    console.log("\n== the public page ==");
    await Promise.all([guest.waitForNavigation({ waitUntil: "networkidle0" }), guest.click(".auth-public")]);
    check("opens without signing in", new URL(guest.url()).pathname === "/seat-allocation", guest.url());
    const notice = await waitFor(guest, () => document.querySelector(".al-notice")?.innerText);
    check("says where the data comes from, and when it was last updated",
      /official e-ticket site/.test(notice || "") && /Last updated/.test(notice || "") && /Not affiliated/.test(notice || ""), notice || "");
    check("links to the official site", await guest.evaluate(() => Boolean(document.querySelector('.al-notice a[href="https://eticket.railway.gov.bd"]'))));
    check("offers Sign in and Create a free account", /Sign in/.test(await guest.evaluate(() => document.querySelector(".pub-head").innerText)) &&
      /Create a free account/.test(await guest.evaluate(() => document.querySelector(".pub-head").innerText)));
    const first = await results(guest);
    check("shows the pairs — after the bot check, if there is one", Boolean(first) && !/Keep searching/.test(first), first || "");
    check("with nothing staff-only: no uploads, no editing",
      await guest.evaluate(() => !document.querySelector("input[data-upload], .al-data, .al-visits") && ![...document.querySelectorAll("button")].some((b) => /^(Edit|Set)$/.test(b.innerText.trim()))));
    await guest.screenshot({ path: path.join(OUT, "public-2-page.png"), fullPage: true });

    console.log("\n== free searches ==");
    let invite = null;
    for (let i = 1; i <= 5 && !invite; i++) {
      await pickFrom(guest, i);
      invite = await guest.evaluate(() => document.querySelector(".pub-invite")?.innerText || null);
    }
    check("after the free searches, an invitation to sign in", /Keep searching/.test(invite || "") && /3 free searches/.test(invite || ""), invite || "");
    const signInHref = await guest.evaluate(() => document.querySelector(".pub-invite a")?.getAttribute("href"));
    check("whose Sign in comes back here", signInHref === "/login?next=%2Fseat-allocation", signInHref);
    await guest.screenshot({ path: path.join(OUT, "public-3-invite.png") });

    console.log("\n== signing in from it ==");
    await Promise.all([guest.waitForNavigation({ waitUntil: "networkidle0" }), guest.click(".pub-invite a")]);
    await guest.type("#email", "unittest-user@example.com");
    await guest.type("input[type=password]", PASSWORD);
    await Promise.all([guest.waitForNavigation({ waitUntil: "networkidle0" }), guest.click("button[type=submit]")]);
    check("signing in comes back to the page", new URL(guest.url()).pathname === "/seat-allocation", guest.url());
    await results(guest);
    let stillOpen = true;
    for (let i = 6; i <= 8; i++) {
      await pickFrom(guest, i);
      if (await guest.evaluate(() => Boolean(document.querySelector(".pub-invite")))) stillOpen = false;
    }
    check("signed in, the searches carry on", stillOpen);
    check("and the header offers the app", /Open the app/.test(await guest.evaluate(() => document.querySelector(".pub-head").innerText)));

    console.log("\n== a passenger in the app ==");
    await guest.goto(`${BASE}/dashboard/allocation`, { waitUntil: "networkidle0" });
    check("Seat Allocation is in their menu while it is public", /Seat Allocation/.test(await guest.evaluate(() => document.querySelector(".dash-nav").innerText)));
    const inApp = await waitFor(guest, () => document.querySelector(".al-notice")?.innerText);
    check("with the same notice, not the staff's details", Boolean(inApp) && !(await guest.$(".al-data")), inApp || "");

    console.log("\n== a manager ==");
    const manager = await newPage(browser);
    await signIn(manager, "unittest-super1@example.com");
    // On the Requests tab, under the analysis.
    await manager.goto(`${BASE}/dashboard/allocation#requests`, { waitUntil: "networkidle0" });
    await manager.waitForSelector(".al-public");
    await manager.evaluate(() => (document.querySelector(".al-public").open = true));
    const panel = await waitFor(manager, () => {
      const t = document.querySelector(".al-public")?.innerText || "";
      return /Latest visits/i.test(t) ? t : null;
    });
    check("sees how the public page is used", /Open to the public/i.test(panel || "") && /Today/i.test(panel || "") && /Searched most/i.test(panel || ""), (panel || "").slice(0, 300));
    check("visit by visit", (await manager.evaluate(() => document.querySelectorAll(".al-public .al-visits__latest tbody tr").length)) > 3);
    await manager.screenshot({ path: path.join(OUT, "public-4-visits.png"), fullPage: true });

    console.log("\n== the phone ==");
    const phone = await newPage(browser, 390, 844);
    await phone.goto(`${BASE}/seat-allocation`, { waitUntil: "networkidle0" });
    await results(phone);
    check("the public page fits a phone", (await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
    await phone.screenshot({ path: path.join(OUT, "public-5-phone.png") });

    console.log("\n== switched off ==");
    await set("allocation.public_enabled", false);
    const late = await newPage(browser);
    await late.goto(`${BASE}/seat-allocation`, { waitUntil: "networkidle0" });
    const offText = await waitFor(late, () => document.querySelector(".pub-message")?.innerText);
    check("the page says it is not available", /Not available right now/.test(offText || ""), offText || "");
    await late.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
    await sleep(800);
    check("and the sign-in page has no button for it", !(await late.$(".auth-public")));

    const errors = [guest, manager, phone, late].flatMap((p) => p.errors);
    check("no browser errors along the way", errors.length === 0, errors.join(" | "));
  } finally {
    await set("allocation.public_enabled", false);
    await set("allocation.public_free_searches", 5);
    await browser.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
