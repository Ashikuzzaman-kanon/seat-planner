// Feature switches, the way the super admin and a passenger meet them:
// Settings → Features turns a tab off for everyone or for one person, the tab
// leaves the menu, its shortcuts and the Home page, and its address shows a
// notice. Home switched off lands on the next tab; an open page catches up
// when it is looked at again. Everything is switched back on at the end.
//
//   node feature-switches-ui.js
//
// Needs the API and the web app running, with the unit-test accounts
// (npm run seed:unittestusers).
const path = require("path");
const config = require("./config");
const puppeteer = require("puppeteer-core");

const BASE = config.WEB;
const API = config.API;
const OUT = config.SHOTS;
const SUPER = "unittest-super1@example.com";
const USER = "unittest-user@example.com";
const OTHER = "unittest-target@example.com";
const PASSWORD = "UnitTest123!";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, arg, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    await sleep(250);
  }
  return null;
}

async function signIn(browser, email) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("input[type=password]", PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);
  return page;
}

const navText = (page) => page.evaluate(() => document.querySelector(".dash-nav")?.innerText || "");
const offText = (page) => page.evaluate(() => document.querySelector(".feature-off")?.innerText || "");

async function api(token, method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Open a feature's dialog in Settings → Features. */
async function openSwitch(page, label) {
  await page.evaluate((l) => document.querySelector(`button[aria-label="Change ${l}"]`).click(), label);
  await page.waitForSelector(".p-dialog .fs-dialog");
}
const saveDialog = (page) =>
  page.evaluate(() => [...document.querySelectorAll(".p-dialog .p-button")].find((b) => b.innerText.trim() === "Save").click());
const rowText = (page, label) =>
  page.evaluate(
    (l) => [...document.querySelectorAll(".fs__row")].find((r) => r.querySelector("strong")?.innerText === l)?.innerText || "",
    label
  );

(async () => {
  const browser = await puppeteer.launch({ executablePath: config.CHROME, headless: "new", args: ["--no-sandbox"] });
  const admin = await signIn(browser, SUPER);
  const token = await admin.evaluate(() => localStorage.getItem("sp_access_token"));
  let passenger;

  try {
    console.log("== Settings → Features ==");
    await admin.goto(`${BASE}/dashboard/settings`, { waitUntil: "networkidle0" });
    await admin.waitForSelector(".fs__row");
    const rows = await admin.evaluate(() => document.querySelectorAll(".fs__row").length);
    check("every tab but Settings is listed, all on", rows === 24 && /Everything on/.test(await admin.evaluate(() => document.querySelector(".fs")?.innerText)), `${rows}`);

    console.log("\n== Wallet off for everyone ==");
    await openSwitch(admin, "Wallet");
    await admin.click("label[for=fs-off_all]");
    await admin.waitForSelector("#fs-message");
    await admin.type("#fs-message", "Back on Friday");
    const warned = await admin.evaluate(() => document.querySelector(".p-dialog .p-inline-message")?.innerText || "");
    check("the dialog says it includes the super admin", /This includes you/.test(warned), warned);
    await admin.screenshot({ path: path.join(OUT, "features-1-dialog.png") });
    await saveDialog(admin);
    const row = await waitFor(admin, () => {
      const r = [...document.querySelectorAll(".fs__row")].find((x) => x.querySelector("strong")?.innerText === "Wallet");
      return r && /Off for everyone/.test(r.innerText) ? r.innerText : null;
    });
    check("the row shows it off, with the message", Boolean(row) && row.includes("Back on Friday"), row || "");
    check("and Wallet leaves the super admin's own menu", !/\bWallet\b/.test(await navText(admin)));

    passenger = await signIn(browser, USER);
    check("a passenger's menu has no Wallet", !/\bWallet\b/.test(await navText(passenger)) && /My Bookings/.test(await navText(passenger)));
    check("nor does their Home page", !(await passenger.evaluate(() => [...document.querySelectorAll(".home-card__label")].some((l) => l.innerText === "Wallet"))));
    await passenger.click(".dash-account");
    await passenger.waitForSelector(".acct-menu");
    check("nor their account menu", !/Wallet/.test(await passenger.evaluate(() => document.querySelector(".acct-menu").innerText)));
    await passenger.keyboard.press("Escape");
    await passenger.goto(`${BASE}/dashboard/wallet`, { waitUntil: "networkidle0" });
    const notice = await waitFor(passenger, () => document.querySelector(".feature-off")?.innerText);
    check("its address shows that it is unavailable, with the message", /Wallet is unavailable/.test(notice || "") && /Back on Friday/.test(notice || ""), notice || "");
    await passenger.screenshot({ path: path.join(OUT, "features-2-unavailable.png") });

    console.log("\n== Book a Ticket off for one person ==");
    await openSwitch(admin, "Book a Ticket");
    await admin.click("label[for=fs-off_some]");
    await admin.waitForSelector("#fs-people");
    const noneYet = await admin.evaluate(() => [...document.querySelectorAll(".p-dialog .p-button")].find((b) => b.innerText.trim() === "Save").disabled);
    check("off for some cannot be saved with nobody chosen", noneYet);
    await admin.type("#fs-people", "unittest-user@");
    await admin.waitForSelector(".p-autocomplete-item");
    await admin.evaluate(() => [...document.querySelectorAll(".p-autocomplete-item")].find((i) => i.innerText.includes("unittest-user@example.com")).click());
    const mine = await admin.evaluate(() => document.querySelector(".p-dialog .p-inline-message")?.innerText || "");
    check("choosing someone else does not warn the super admin", !/This includes you/.test(mine), mine);
    await saveDialog(admin);
    const bookRow = await waitFor(admin, () => {
      const r = [...document.querySelectorAll(".fs__row")].find((x) => x.querySelector("strong")?.innerText === "Book a Ticket");
      return r && /Off for 1 person/.test(r.innerText) ? r.innerText : null;
    });
    check("the row names who it is off for", Boolean(bookRow) && bookRow.includes("Unit Test User"), bookRow || "");
    check("the super admin keeps Book a Ticket", /Book a Ticket/.test(await navText(admin)));

    await passenger.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0" });
    check("the passenger's menu loses it", !/Book a Ticket/.test(await navText(passenger)));
    check("and the Book a ticket button in the header", !(await passenger.$(".dash-cta")));
    await passenger.goto(`${BASE}/dashboard/book`, { waitUntil: "networkidle0" });
    check("its address shows the notice", /Book a Ticket is unavailable/.test((await waitFor(passenger, () => document.querySelector(".feature-off")?.innerText)) || ""));
    const other = await signIn(browser, OTHER);
    check("another passenger still has it", /Book a Ticket/.test(await navText(other)) && Boolean(await other.$(".dash-cta")));
    await other.browserContext().close();

    console.log("\n== Home and Notifications off ==");
    await api(token, "PUT", "/features/home", { state: "off_all" });
    await api(token, "PUT", "/features/notifications", { state: "off_all" });
    await admin.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0" });
    const landed = await waitFor(admin, () => (location.pathname !== "/dashboard" ? location.pathname : null));
    check("Home off: the super admin lands on the first tab still there", landed === "/dashboard/book", landed || "stayed on /dashboard");
    check("the bell is gone", !(await admin.$(".notif-bell")));
    await passenger.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0" });
    const passengerLanded = await waitFor(passenger, () => (location.pathname !== "/dashboard" ? location.pathname : null));
    check("the passenger, without Book a Ticket, lands on My Bookings", passengerLanded === "/dashboard/bookings", passengerLanded || "");

    console.log("\n== an open page catches up ==");
    await api(token, "PUT", "/features/requests", { state: "off_all" });
    check("Requests is still in the menu of a page loaded before", /Requests/.test(await navText(passenger)));
    await sleep(21000);
    await passenger.evaluate(() => window.dispatchEvent(new Event("focus")));
    const gone = await waitFor(passenger, () => !/Requests/.test(document.querySelector(".dash-nav")?.innerText || ""), null, 10000);
    check("looking at the window again takes it away", Boolean(gone));

    console.log("\n== the phone ==");
    await admin.setViewport({ width: 390, height: 844 });
    await admin.goto(`${BASE}/dashboard/settings`, { waitUntil: "networkidle0" });
    await admin.waitForSelector(".fs__row");
    const overflow = await admin.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("Settings → Features fits a phone", overflow <= 0, `${overflow}px`);
    await openSwitch(admin, "Wallet");
    const dialogOverflow = await admin.evaluate(() => {
      const d = document.querySelector(".p-dialog").getBoundingClientRect();
      return Math.max(0, d.right - window.innerWidth, -d.left);
    });
    check("and so does its dialog", dialogOverflow <= 0, `${dialogOverflow}px`);
    await admin.screenshot({ path: path.join(OUT, "features-3-phone.png") });

    console.log("\n== back on ==");
    await admin.click("label[for=fs-on]");
    await saveDialog(admin);
    await waitFor(admin, () => {
      const r = [...document.querySelectorAll(".fs__row")].find((x) => x.querySelector("strong")?.innerText === "Wallet");
      return r && /\bOn\b/.test(r.innerText);
    });
    await admin.setViewport({ width: 1440, height: 900 });
    await admin.goto(`${BASE}/dashboard/settings`, { waitUntil: "networkidle0" });
    check("switched on in the dialog, Wallet is back in the menu", /\bWallet\b/.test(await navText(admin)));

    check("no browser errors along the way", [...admin.errors, ...passenger.errors].length === 0, [...admin.errors, ...passenger.errors].join(" | "));
  } finally {
    const { body } = await api(token, "GET", "/features");
    for (const f of body?.features || []) if (f.state !== "on") await api(token, "PUT", `/features/${f.key}`, { state: "on" });
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
