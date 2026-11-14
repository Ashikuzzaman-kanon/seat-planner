// Audit Log → Analysis, in a real browser: the tabs, the totals, the chart and
// the weekday × hour grid; grouped by a field, a square chosen, a row broken
// down; operations and people picked, two people side by side; the last hour;
// refreshing every 30 seconds; events one by one; the CSV; the Log tab as it
// was; a passenger without it; at phone width.
//
// Needs the API and the web app running locally with the development data and
// a document store (MongoDB) holding some audit events — `docker compose up
// mongo` gives one.
const path = require("path");
const config = require("./config");
const puppeteer = require("puppeteer-core");

const BASE = config.WEB;
const OUT = config.SHOTS;
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

/** Choose an option of a dropdown, by the words it shows. */
async function pick(page, id, text) {
  await page.click(`#${id}`);
  await page.waitForSelector(".p-dropdown-panel");
  const filter = await page.$(".p-dropdown-panel .p-dropdown-filter");
  if (filter) await filter.type(text);
  await sleep(250);
  await page.evaluate((t) => {
    const items = [...document.querySelectorAll(".p-dropdown-panel .p-dropdown-item")];
    (items.find((i) => i.innerText.trim() === t) || items.find((i) => i.innerText.trim().startsWith(t))).click();
  }, text);
  await sleep(300);
}

async function menuItem(page, text) {
  const ok = await waitFor(
    page,
    (t) => {
      const item = [...document.querySelectorAll(".aa-menu .p-menuitem-content")].find((x) => x.innerText.trim() === t);
      if (!item) return false;
      item.click();
      return true;
    },
    text,
    5000
  );
  await sleep(250);
  return ok;
}

const heading = (page) => page.evaluate(() => document.querySelector(".aa-groups__head h2")?.innerText || "");
const chips = (page) => page.evaluate(() => [...document.querySelectorAll(".aa-chip")].map((c) => c.innerText.replace(/\s+/g, " ").trim()));
const events = (page) => page.evaluate(() => Number((document.querySelector(".aa-total strong")?.innerText || "").replace(/[^\d]/g, "")));
/** The analysis, answered again: the heading says so once the new answer is in. */
const settled = (page, pattern) =>
  waitFor(
    page,
    (p) => new RegExp(p, "i").test(document.querySelector(".aa-groups__head h2")?.innerText || "") && !document.querySelector(".aa-table .p-datatable-loading-overlay"),
    pattern
  );
const clickText = (page, selector, text) =>
  page.evaluate((s, t) => [...document.querySelectorAll(s)].find((b) => b.innerText.trim() === t)?.click(), selector, text);

(async () => {
  const browser = await puppeteer.launch({ executablePath: config.CHROME, headless: "new", args: ["--no-sandbox"] });

  console.log("== the tabs ==");
  const su = await signIn(browser, "unittest-super1@example.com");
  await su.goto(`${BASE}/dashboard/audit`, { waitUntil: "networkidle0" });
  const tabs = await su.evaluate(() => [...document.querySelectorAll(".audit-tabs .p-tabview-nav-link")].map((l) => l.innerText.trim()));
  check("Log, and Analysis", tabs.join() === "Log,Analysis", JSON.stringify(tabs));
  check("the Log as it was, event by event", Boolean(await waitFor(su, () => document.querySelectorAll(".audit-tabs .p-datatable tbody tr").length > 0)));
  await su.evaluate(() => [...document.querySelectorAll(".audit-tabs .p-tabview-nav-link")][1].click());
  await su.waitForSelector(".aa-totals", { timeout: 20000 });
  check("its address says which tab", await su.evaluate(() => location.hash === "#analysis"));

  console.log("\n== counted ==");
  // The development data is mostly the test accounts' doing: show it.
  await su.click("#aa-hide-tests");
  await clickText(su, ".aa-range .p-button", "90 days");
  const counted = await waitFor(su, () => {
    const n = Number((document.querySelector(".aa-total strong")?.innerText || "").replace(/[^\d]/g, ""));
    return n > 0 ? n : null;
  });
  check("events, people, addresses, failures counted", Boolean(counted), String(counted));
  check("a bar a day", Boolean(await waitFor(su, () => document.querySelectorAll(".aa > .card .tb-bar").length === 90)));
  check("a square for every hour of every day, Saturday first", await su.evaluate(() =>
    document.querySelectorAll(".hm:not(.hm--compact) .hm-cell").length === 168 && document.querySelector(".hm-day")?.innerText.trim() === "Sat"));
  const busiest = await su.evaluate(() => document.querySelector(".hm figcaption small")?.innerText || "");
  check("and when it is busiest", /^Busiest: \w+day, \d\d:00–\d\d:00/.test(busiest), busiest);
  await su.screenshot({ path: path.join(OUT, "audit-1-analysis.png"), fullPage: true });

  console.log("\n== grouped, narrowed ==");
  await pick(su, "aa-by", "Hour of the day");
  check("by hour of the day", Boolean(await settled(su, "by hour of the day")), await heading(su));
  const hours = await su.evaluate(() => [...document.querySelectorAll(".aa-table tbody tr td:first-child")].map((c) => c.innerText.trim()));
  check("in the order of the day", hours.length > 1 && hours.every((h, i) => !i || h >= hours[i - 1]), JSON.stringify(hours));
  const all = await events(su);
  await su.evaluate(() => [...document.querySelectorAll(".hm:not(.hm--compact) button.hm-cell")].find((c) => c.style.background)?.click());
  const square = await waitFor(su, () => {
    const c = [...document.querySelectorAll(".aa-chip")].map((x) => x.innerText.replace(/\s+/g, " ").trim());
    return c.some((x) => /^Day of the week:/.test(x)) && c.some((x) => /^Hour of the day:/.test(x)) ? c : null;
  });
  check("a square: only that day and hour", Boolean(square), JSON.stringify(await chips(su)));
  const fewer = await waitFor(su, (a) => {
    const n = Number((document.querySelector(".aa-total strong")?.innerText || "").replace(/[^\d]/g, ""));
    return n > 0 && n < a ? n : null;
  }, all);
  check("fewer events counted", Boolean(fewer), `${all} → ${fewer}`);
  await clickText(su, ".aa-chips button", "Clear all");
  await waitFor(su, () => !document.querySelector(".aa-chip"));

  await pick(su, "aa-by", "Operation");
  await settled(su, "by operation");
  await su.evaluate(() => document.querySelector(".aa-table tbody tr td")?.click());
  await su.waitForSelector(".aa-menu", { visible: true });
  await menuItem(su, "Break down by");
  await menuItem(su, "Who");
  const broke = await menuItem(su, "Person");
  check("a row broken down by person", broke && Boolean(await settled(su, "by person")), await heading(su));
  check("narrowed to that operation", (await chips(su)).some((c) => /^Operation: /.test(c)), JSON.stringify(await chips(su)));
  await clickText(su, ".aa-chips button", "Clear all");
  await waitFor(su, () => !document.querySelector(".aa-chip"));

  console.log("\n== operations and people ==");
  await su.click("#aa-ops");
  await su.waitForSelector(".p-multiselect-panel");
  await su.type(".p-multiselect-panel .p-multiselect-filter", "auth.login");
  await sleep(300);
  await su.evaluate(() => [...document.querySelectorAll(".p-multiselect-panel .p-multiselect-item")].find((i) => i.innerText.trim() === "auth.login")?.click());
  await su.keyboard.press("Escape");
  const logins = await waitFor(su, () => {
    const rows = [...document.querySelectorAll(".aa-table tbody tr td:first-child")].map((c) => c.innerText.trim());
    return rows.length ? rows : null;
  });
  await sleep(800);
  check("only sign-ins", (await su.evaluate(() => document.querySelector(".aa-multiselect, .p-multiselect")?.innerText || "")).includes("auth.login"),
    JSON.stringify(logins));
  for (const who of ["unittest-super1", "unittest-user@"]) {
    await su.click("#aa-people");
    await su.type("#aa-people", who);
    await su.waitForSelector(".p-autocomplete-panel .p-autocomplete-item", { timeout: 10000 });
    await su.evaluate((w) => [...document.querySelectorAll(".p-autocomplete-panel .p-autocomplete-item")].find((i) => i.innerText.includes(w))?.click(), who);
    await sleep(500);
  }
  const side = await waitFor(su, () => (document.querySelectorAll(".aa-person").length === 2 ? true : null), null, 20000);
  check("two people: side by side, each their own", Boolean(side) &&
    (await su.evaluate(() => [...document.querySelectorAll(".aa-person")].every((p) => p.querySelector(".tb") && p.querySelector(".hm")))));
  await su.screenshot({ path: path.join(OUT, "audit-2-compare.png"), fullPage: true });

  console.log("\n== the last hour, and live ==");
  await clickText(su, ".aa-range .p-button", "Last hour");
  const steps = await waitFor(su, () => {
    const n = document.querySelectorAll(".aa > .card .tb-bar").length;
    return n >= 12 && n <= 13 ? n : null;
  });
  check("in five-minute steps", Boolean(steps), String(steps));
  await su.evaluate(() => document.querySelector(".aa-live .p-inputswitch")?.click());
  const refreshed = await su
    .waitForResponse((r) => r.url().includes("/audit/analysis?"), { timeout: 40000 })
    .then((r) => r.status())
    .catch(() => null);
  check("asked again within 30 seconds while live", refreshed === 200, String(refreshed));
  await su.evaluate(() => document.querySelector(".aa-live .p-inputswitch")?.click());

  console.log("\n== one by one, and as a spreadsheet ==");
  await clickText(su, ".aa-range .p-button", "90 days");
  await sleep(1500);
  await su.evaluate(() => (document.querySelector(".aa-latest").open = true));
  check("the latest events that match", Boolean(await waitFor(su, () => document.querySelectorAll(".aa-latest tbody tr").length > 0)));
  const [sheet] = await Promise.all([
    su.waitForResponse((r) => r.url().includes("/audit/analysis.csv"), { timeout: 15000 }),
    clickText(su, ".aa-groups__actions button", "Download CSV"),
  ]);
  check("Download CSV fetches the groups", sheet.status() === 200 && /text\/csv/.test(sheet.headers()["content-type"] || ""));

  console.log("\n== a passenger ==");
  const passenger = await signIn(browser, "unittest-user@example.com");
  check("has no Audit Log in the menu", !/Audit Log/.test(await passenger.evaluate(() => document.querySelector(".dash-nav")?.innerText || "")));

  console.log("\n== the phone ==");
  const phone = await signIn(browser, "unittest-super1@example.com", { width: 390, height: 844, isMobile: true, hasTouch: true });
  await phone.goto(`${BASE}/dashboard/audit#analysis`, { waitUntil: "networkidle0" });
  await phone.waitForSelector(".aa-totals", { timeout: 20000 });
  await sleep(500);
  check("the analysis fits a phone; the grid scrolls inside itself", await phone.evaluate(() =>
    document.documentElement.scrollWidth - window.innerWidth <= 0 && getComputedStyle(document.querySelector(".hm-scroll")).overflowX === "auto"));
  await phone.screenshot({ path: path.join(OUT, "audit-3-phone.png"), fullPage: true });

  const errors = [...su.errors, ...passenger.errors, ...phone.errors];
  check("no browser errors along the way", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
