// Drive the Demo Data screen the way a super admin would: populate, watch it
// run, read what it reports, delete. Screenshots at each step, laptop and phone.
//
//   node demo-ui.js
const config = require("./config");
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = config.CHROME;
const BASE = config.WEB;
const OUT = config.SHOTS;

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", "unittest-super1@example.com");
  await page.type("input[type=password]", "UnitTest123!");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);
}

const text = (page) => page.evaluate(() => document.body.innerText);
const clickButton = (page, label) =>
  page.evaluate((label) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === label && !x.disabled);
    if (b) b.click();
    return Boolean(b);
  }, label);

async function waitForText(page, pattern, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pattern.test(await text(page))) return true;
    await sleep(400);
  }
  return false;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

  /* ---------------- Laptop: the whole cycle ---------------- */
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);

  await page.goto(`${BASE}/dashboard/demo-data`, { waitUntil: "networkidle0" });
  check("the page loads, reachable from the nav", /Demo data/.test(await text(page)) &&
    (await page.$('a[href="/dashboard/demo-data"]')) !== null);
  const startState = /No demo data/.test(await text(page));
  if (!startState) {
    console.log("  (demo data already populated here — leaving it alone)");
    await browser.close();
    process.exit(0);
  }
  check("dates read as one phrase", /\d{4}, \d{2}:\d{2}/.test(await text(page)) || !/Last (deleted|populated)/.test(await text(page)),
    (await text(page)).match(/Last (deleted|populated)[^\n]*/)?.[0]);
  const deleteDisabled = await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Delete demo data")?.disabled);
  check("Delete is disabled while there is nothing to delete", deleteDisabled === true);

  check("Populate opens a confirmation", await clickButton(page, "Populate demo data"));
  await sleep(500);
  const dialog = await text(page);
  check("which says what will be created and that nothing existing changes",
    /no super admins/.test(dialog) && /not changed/.test(dialog), dialog.slice(0, 200));
  await page.screenshot({ path: path.join(OUT, "demoui-1-confirm.png") });

  check("confirming starts it", await clickButton(page, "Populate"));
  const sawProgress = await waitForText(page, /Populating demo data…|Demo data ready|Demo data is populated/, 15000);
  check("the page shows it running", sawProgress);
  await page.screenshot({ path: path.join(OUT, "demoui-2-running.png") });

  check("and then populated", await waitForText(page, /Demo data is populated/));
  await sleep(800);
  const after = await text(page);
  check("the toast says what was created", /Demo data ready/.test(after), after.slice(0, 300));
  check("the result lists what was already there", /Worth knowing/i.test(after) && /already existed/.test(after));
  check("the checker accounts show as the demo's, with a password", /checker1@example\.com[\s\S]{0,80}Checker123!/.test(after));
  check("pre-existing accounts show no password", /its own password/.test(after));
  await page.screenshot({ path: path.join(OUT, "demoui-3-populated.png"), fullPage: true });

  // Copy buttons explain themselves on hover.
  const copyTips = await page.evaluate(() =>
    [...document.querySelectorAll(".demo-copy")].every((b) => b.getAttribute("aria-label")));
  check("every copy button has hover text", copyTips);

  /* ---------------- Phone ---------------- */
  const phone = await browser.newPage();
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await login(phone);
  await phone.goto(`${BASE}/dashboard/demo-data`, { waitUntil: "networkidle0" });
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("no sideways scrolling on a phone", overflow <= 0, `${overflow}px`);
  await phone.screenshot({ path: path.join(OUT, "demoui-4-phone.png"), fullPage: true });

  /* ---------------- Delete ---------------- */
  check("Delete opens a confirmation", await clickButton(page, "Delete demo data"));
  await sleep(500);
  const warn = await text(page);
  check("which counts what goes and says it cannot be undone", /cannot be undone/.test(warn) && /2 account\(s\)/.test(warn),
    warn.slice(0, 300));
  await page.screenshot({ path: path.join(OUT, "demoui-5-delete-confirm.png") });
  await page.evaluate(() => document.querySelector(".p-confirm-dialog-accept")?.click());
  check("and deleting finishes", await waitForText(page, /No demo data/));
  await sleep(800);
  const done = await text(page);
  check("with a toast saying so", /Demo data deleted/.test(done));
  check("and the last run described", /Removed 2 account/.test(done), done.slice(0, 400));
  await page.screenshot({ path: path.join(OUT, "demoui-6-deleted.png"), fullPage: true });

  check("no script errors on the page", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
