// Syncing with the railway, the way a super admin would: check, review what
// differs, apply — against a stand-in railway this script runs, so the real
// one is never called. Then it puts the timetable back as it was.
//
//   node railway-sync-ui.js
//
// The API must ask the stand-in, not the railway: start it with
//   RAILWAY_SOURCE_URL=http://127.0.0.1:47330/train-routes RAILWAY_PAUSE_MS=0
// The railway data must be loaded (Administration → Railway Data → Load).
// The stand-in moves one time on EKOTA EXPRESS (705); the run applies that,
// then applies the timetable as it came with the code again.
const http = require("http");
const path = require("path");
const config = require("./config");
const puppeteer = require("puppeteer-core");
const COMMITTED = require("../backend/src/data/railway/timetable.json");

const CHROME = config.CHROME;
const BASE = config.WEB;
const OUT = config.SHOTS;
const PAGE = `${BASE}/dashboard/railway-data`;
const ADMIN = "unittest-super1@example.com";
const PASSWORD = "UnitTest123!";
const PORT = 47330;

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- The stand-in railway ---------------- */

const later = (text, minutes) => {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(text);
  let total = ((Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0)) * 60 + Number(m[2]) + minutes;
  const h24 = Math.floor(total / 60) % 24;
  return `${String(h24 % 12 || 12).padStart(2, "0")}:${String(total % 60).padStart(2, "0")} ${h24 < 12 ? "am" : "pm"} BST`;
};
const original = new Map(COMMITTED.trains.map((t) => [t.number, t]));
const changed = new Map([...original].map(([n, t]) => [n, JSON.parse(JSON.stringify(t))]));
const ekota = changed.get(705);
const MOVED = ekota.routes[2].city;
ekota.routes[2].arrival_time = later(ekota.routes[2].arrival_time, 5);
ekota.routes[2].departure_time = later(ekota.routes[2].departure_time, 5);

let serving = changed;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const t = serving.get(Number(JSON.parse(body || "{}").model));
    res.writeHead(t ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(t ? { data: { train_name: t.name, days: t.days, total_duration: t.totalDuration, routes: t.routes } } : { message: "Not found" }));
  });
});

async function waitFor(page, fn, arg, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    await sleep(500);
  }
  return null;
}
const clickButton = (page, pattern) =>
  page.evaluate((source) => {
    const b = [...document.querySelectorAll("button")].find((x) => new RegExp(source).test(x.textContent.trim()) && !x.disabled);
    if (b) b.click();
    return Boolean(b);
  }, pattern);
const syncText = (page) => page.evaluate(() => document.querySelector(".rd-sync")?.innerText || "");

(async () => {
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", ADMIN);
  await page.type("input[type=password]", PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);

  console.log("== checking with the railway ==");
  await page.goto(PAGE, { waitUntil: "networkidle0" });
  check("Railway Data has a sync section", /Sync with the railway/.test(await syncText(page)));
  await clickButton(page, "^Check with the railway$");
  check("a check runs, with progress", Boolean(await waitFor(page, () => /Checking with the railway/.test(document.querySelector(".rd-sync")?.innerText || ""), null, 15000)));
  const reviewed = await waitFor(page, () => {
    const text = document.querySelector(".rd-sync")?.innerText || "";
    return /New times/.test(text) && /Apply changes/.test(text) ? text : null;
  });
  check("and shows what differs: the moved time", Boolean(reviewed) && reviewed.includes("EKOTA EXPRESS (705)") && reviewed.includes(MOVED.replace(/_/g, " ")), (reviewed || "").slice(0, 400));
  check("saying nothing has changed yet", /Nothing has changed yet/.test(reviewed || ""));
  await page.screenshot({ path: path.join(OUT, "railway-sync-1-review.png"), fullPage: true });

  console.log("\n== applying it ==");
  await clickButton(page, "^Apply changes$");
  await page.waitForSelector(".p-confirm-dialog");
  check("applying asks first, saying nothing is deleted", /nothing is deleted/i.test(await page.evaluate(() => document.querySelector(".p-confirm-dialog").innerText)));
  await page.evaluate(() => document.querySelector(".p-confirm-dialog-accept").click());
  const applied = await waitFor(page, () => {
    const text = document.querySelector(".rd-sync")?.innerText || "";
    return /Last applied/.test(text) ? text : null;
  });
  check("then reports what it did", Boolean(applied) && /1 new times/.test(applied), (applied || "").slice(0, 400));
  check("and the status says the server works from the sync", /from the last sync/.test(await page.evaluate(() => document.querySelector(".rd-status")?.innerText || "")));
  await page.screenshot({ path: path.join(OUT, "railway-sync-2-applied.png"), fullPage: true });

  console.log("\n== putting it back ==");
  serving = original;
  await clickButton(page, "^Check with the railway$");
  await waitFor(page, () => /Apply changes/.test(document.querySelector(".rd-sync")?.innerText || ""));
  await clickButton(page, "^Apply changes$");
  await page.waitForSelector(".p-confirm-dialog");
  await page.evaluate(() => document.querySelector(".p-confirm-dialog-accept").click());
  await waitFor(page, () => /Last applied/.test(document.querySelector(".rd-sync")?.innerText || ""));
  await clickButton(page, "^Check with the railway$");
  const matched = await waitFor(page, () => /The server matches the railway/.test(document.querySelector(".rd-sync")?.innerText || ""));
  check("the original timetable applies back, after which the server matches", Boolean(matched));

  console.log("\n== the phone ==");
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(PAGE, { waitUntil: "networkidle0" });
  await waitFor(page, () => document.querySelector(".rd-sync"), null, 15000);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("the page fits a phone", overflow <= 0, `${overflow}px`);

  check("no browser errors along the way", errors.length === 0, errors.join(" | "));
  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  server.close();
  process.exit(1);
});
