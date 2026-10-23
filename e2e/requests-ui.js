// Seat Allocation's Requests tab, in a real browser: today's count on the tab,
// the requests grouped by one field then two, a row broken down further, a bar
// of the chart chosen, every request counted, one by one, as a spreadsheet,
// and the public page's own view beneath. The admin role — which may see the
// requests but not the allocation — gets the Requests alone. On a phone too.
//
// Needs the API and the web app running locally with the development data
// (README → Running it locally, `npm run seed:unittestusers`) and some
// allocation data uploaded. Makes searches of its own, which are recorded:
// that is what it looks at.
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

/** Choose an item of the row's menu, by its words — a parent opens its own. */
async function menuItem(page, text) {
  const ok = await waitFor(
    page,
    (t) => {
      const item = [...document.querySelectorAll(".rq-menu .p-menuitem-content")].find((x) => x.innerText.trim() === t);
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

const tabs = (page) => page.evaluate(() => [...document.querySelectorAll(".al-tabs .p-tabview-nav-link")].map((l) => l.innerText.trim()));
const heading = (page) => page.evaluate(() => document.querySelector(".rq-groups__head h2")?.innerText || "");
const chips = (page) => page.evaluate(() => [...document.querySelectorAll(".rq-chip")].map((c) => c.innerText.replace(/\s+/g, " ").trim()));
/** The table, loaded again: the heading says so once the new answer is in. */
const settled = (page, pattern) => waitFor(page, (p) => new RegExp(p, "i").test(document.querySelector(".rq-groups__head h2")?.innerText || "") && !document.querySelector(".rq-table .p-datatable-loading-overlay"), pattern);

(async () => {
  const browser = await puppeteer.launch({ executablePath: config.CHROME, headless: "new", args: ["--no-sandbox"] });

  console.log("== the tabs ==");
  const su = await signIn(browser, "unittest-super1@example.com");
  await su.goto(`${BASE}/dashboard/allocation`, { waitUntil: "networkidle0" });
  await su.waitForSelector(".al-tabs");
  const named = await waitFor(su, () => {
    const t = [...document.querySelectorAll(".al-tabs .p-tabview-nav-link")].map((l) => l.innerText.trim());
    return /Requests · [\d,]+ today/.test(t[1] || "") ? t : null;
  });
  check("Allocation, and Requests with today's count on it", named?.[0] === "Allocation" && Boolean(named), JSON.stringify(await tabs(su)));
  const before = Number((named?.[1] || "").replace(/[^\d]/g, ""));
  await su.waitForSelector(".al-pair, .al-grid, .al-empty");
  await su.evaluate(() => [...document.querySelectorAll(".al-tabs .p-tabview-nav-link")][1].click());
  await su.waitForSelector(".rq-totals");
  check("its address says which tab", await su.evaluate(() => location.hash === "#requests"));
  const counted = await waitFor(su, (b) => {
    const n = Number(([...document.querySelectorAll(".al-tabs .p-tabview-nav-link")][1]?.innerText || "").replace(/[^\d]/g, ""));
    return n > b ? n : null;
  }, before);
  check("the list just shown in the app was a search, and is counted", Boolean(counted), `${before} → ${counted}`);

  console.log("\n== counted ==");
  const totals = await su.evaluate(() => document.querySelector(".rq-totals")?.innerText || "");
  check("searches, people, visitors, found nothing", /Searches/i.test(totals) && /People/i.test(totals) && /Visitors/i.test(totals) &&
    /Found nothing/i.test(totals) && /in the app/.test(totals), totals.replace(/\n/g, " "));
  const byWhere = await su.evaluate(() => [...document.querySelectorAll(".rq-table tbody tr")].map((r) => r.innerText.replace(/\s+/g, " ")));
  check("grouped by public page or app to begin with", byWhere.some((r) => /^In the app/.test(r)), JSON.stringify(byWhere));
  check("over the last 30 days, a bar a day", (await su.evaluate(() => document.querySelectorAll(".rq-chart__bar").length)) === 30);
  await su.screenshot({ path: path.join(OUT, "requests-1-tab.png"), fullPage: true });

  console.log("\n== grouped ==");
  await pick(su, "rq-by", "Person");
  check("by person", Boolean(await settled(su, "by person")), await heading(su));
  const people = await su.evaluate(() => [...document.querySelectorAll(".rq-table tbody tr td:first-child")].map((c) => c.innerText.trim()));
  check("each named, with their email", people.some((p) => /unittest-super1@example\.com/.test(p)), JSON.stringify(people));
  await pick(su, "rq-then", "Public page or app");
  check("then by public page or app: two fields", Boolean(await settled(su, "by person, then public page or app")) &&
    (await su.evaluate(() => document.querySelectorAll(".rq-table thead th").length)) >= 7, await heading(su));

  console.log("\n== broken down ==");
  await su.evaluate(() => {
    const row = [...document.querySelectorAll(".rq-table tbody tr")].find((r) => /unittest-super1@example\.com/.test(r.innerText));
    row?.querySelector("td")?.click();
  });
  await su.waitForSelector(".rq-menu", { visible: true });
  const menu = await su.evaluate(() => document.querySelector(".rq-menu")?.innerText || "");
  check("a row offers its requests one by one, or a breakdown", /one by one/i.test(menu) && /Break down by/.test(menu), menu);
  await menuItem(su, "Break down by");
  await menuItem(su, "Journey");
  const chose = await menuItem(su, "From → to");
  check("broken down by journey", chose && Boolean(await settled(su, "by from → to")), await heading(su));
  const only = await chips(su);
  check("narrowed to that person and the app, as the chips say", only.some((c) => /^Person: .*unittest-super1/.test(c)) &&
    only.some((c) => /^Public page or app: In the app/.test(c)), JSON.stringify(only));
  await su.click(".rq-chip button");
  await sleep(300);
  check("a chip taken away", (await chips(su)).length === 1, JSON.stringify(await chips(su)));
  await su.evaluate(() => [...document.querySelectorAll(".rq-chips button")].find((b) => b.innerText.trim() === "Clear all")?.click());
  await waitFor(su, () => !document.querySelector(".rq-chip"));
  check("and all of them", (await chips(su)).length === 0);

  console.log("\n== a bar of the chart ==");
  await settled(su, "by from → to");
  await su.evaluate(() => [...document.querySelectorAll(".rq-chart__bar")].at(-1).click());
  const day = await waitFor(su, () => [...document.querySelectorAll(".rq-chip")].map((c) => c.innerText.replace(/\s+/g, " ").trim()).find((c) => /^Day:/.test(c)));
  check("today's bar: only today", Boolean(day), JSON.stringify(await chips(su)));

  console.log("\n== every request ==");
  await su.evaluate(() => document.querySelector(".rq-all .p-inputswitch")?.click());
  const all = await waitFor(su, () => (/^Requests/i.test(document.querySelector(".rq-total span")?.innerText || "") ? true : null));
  check("page opens and bot checks counted too: requests, not searches", Boolean(all));

  console.log("\n== one by one ==");
  await su.evaluate(() => (document.querySelector(".rq-latest").open = true));
  const latest = await waitFor(su, () => {
    const rows = [...document.querySelectorAll(".rq-latest tbody tr")];
    return rows.length && rows.some((r) => /App/.test(r.innerText)) ? rows.length : null;
  });
  check("the latest, each saying where from and who", Boolean(latest), String(latest));

  console.log("\n== as a spreadsheet ==");
  const [sheet] = await Promise.all([
    su.waitForResponse((r) => r.url().includes("/allocation/requests.csv"), { timeout: 15000 }),
    su.evaluate(() => [...document.querySelectorAll(".rq-groups__actions button")].find((b) => /Download CSV/.test(b.innerText))?.click()),
  ]);
  check("Download CSV fetches the same groups", sheet.status() === 200 && /text\/csv/.test(sheet.headers()["content-type"] || ""));

  console.log("\n== the public page's own view ==");
  check("beneath, as it was", Boolean(await su.$(".al-public")));

  console.log("\n== the admin role ==");
  const admin = await signIn(browser, "unittest-admin@example.com");
  check("has Seat Allocation in the menu", /Seat Allocation/.test(await admin.evaluate(() => document.querySelector(".dash-nav")?.innerText || "")));
  await admin.goto(`${BASE}/dashboard/allocation`, { waitUntil: "networkidle0" });
  await admin.waitForSelector(".rq-totals, .al-tabs");
  check("sees the requests — and, not seeing the allocation itself, nothing else", Boolean(await admin.$(".rq-totals")) &&
    !(await admin.$(".al-tabs")) && !(await admin.$(".al-pair, .al-data")));

  console.log("\n== a passenger ==");
  const passenger = await signIn(browser, "unittest-user@example.com");
  await passenger.goto(`${BASE}/dashboard/allocation#requests`, { waitUntil: "networkidle0" });
  await sleep(500);
  check("no Requests for them", !(await passenger.$(".rq-totals, .al-tabs")));

  console.log("\n== the phone ==");
  const phone = await signIn(browser, "unittest-super1@example.com", { width: 390, height: 844, isMobile: true, hasTouch: true });
  await phone.goto(`${BASE}/dashboard/allocation#requests`, { waitUntil: "networkidle0" });
  await phone.waitForSelector(".rq-totals");
  await sleep(500);
  check("the Requests fit a phone", (await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await phone.screenshot({ path: path.join(OUT, "requests-2-phone.png"), fullPage: true });

  const errors = [...su.errors, ...admin.errors, ...passenger.errors, ...phone.errors];
  check("no browser errors along the way", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
