// The seat plan editor's tools, in a real browser, on a new plan: rows built
// from a pattern; a row mirrored left to right; undo and redo, by button and
// key; two seats swapped with two; a number typed twice, and the checks
// saying so; several seats changed at once; rows duplicated, copied and
// pasted; numbering from a start with a prefix, snaking; asked before
// leaving unsaved; saved, and still so when opened again; the layout saved to
// two more coaches; at phone width. Removes the plans it made.
//
// Needs the API and the web app running locally with the development data.
const config = require("./config");
const path = require("path");
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

async function waitFor(page, fn, arg, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    await sleep(200);
  }
  return null;
}

async function signIn(browser, email, viewport = { width: 1440, height: 1100 }) {
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

const clickText = (page, selector, text) =>
  page.evaluate((s, t) => {
    const b = [...document.querySelectorAll(s)].find((x) => x.innerText.trim() === t && !x.disabled);
    if (b) b.click();
    return Boolean(b);
  }, selector, text);
/** Each row as it reads: numbers, "_" for a blank. */
const picture = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".seatgrid-row")].map((row) =>
      [...row.querySelectorAll(".seat-slot:not(.add-cell)")].map((s) => s.querySelector(".seat-number")?.innerText.trim() || "_").join(" ")
    )
  );
const seat = (page, number) => page.$(`.seat[data-seat="${number}"]`);
async function ctrlClick(page, number) {
  await page.keyboard.down("Control");
  await (await seat(page, number)).click();
  await page.keyboard.up("Control");
}
const checksText = (page) => page.evaluate(() => (document.querySelector(".pe-checks")?.innerText || "").replace(/\s+/g, " "));

(async () => {
  const browser = await puppeteer.launch({ executablePath: config.CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await signIn(browser, "unittest-super1@example.com");
  const token = await page.evaluate(() => localStorage.getItem("sp_access_token"));
  const made = [];
  let asked = 0;
  page.on("dialog", async (d) => {
    asked += 1;
    await d.dismiss();
  });

  try {
    console.log("== rows from a pattern ==");
    await page.goto(`${BASE}/dashboard/plans/new`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".pe-toolbar");
    await clickText(page, ".pe-toolbar button", "Add rows…");
    await page.waitForSelector(".pe-dialog");
    await clickText(page, ".pe-patterns .p-button", "2 + 2");
    const rowsInput = await page.$("#pe-rows");
    await rowsInput.click({ clickCount: 3 });
    await rowsInput.type("4");
    await page.click("label[for=pe-replace]");
    await clickText(page, ".pe-dialog button", "Start over with these");
    await sleep(300);
    check("four rows of 2 + 2, numbered", JSON.stringify(await picture(page)) ===
      JSON.stringify(["1 2 _ 3 4", "5 6 _ 7 8", "9 10 _ 11 12", "13 14 _ 15 16"]), JSON.stringify(await picture(page)));
    check("the checks sum it up", /16 seats/.test(await checksText(page)), await checksText(page));

    console.log("\n== mirrored, undone, redone ==");
    await page.evaluate(() => document.querySelector(".row-index--pick").click());
    await sleep(200);
    check("a row's number chooses its seats", (await page.$$(".seat.selected")).length === 4);
    await clickText(page, ".pe-actions button", "Mirror their rows");
    await sleep(200);
    check("the row mirrored: seats reversed, the corridor in place", (await picture(page))[0] === "4 3 _ 2 1", (await picture(page))[0]);
    check("and marked so", Boolean(await page.$(".row-mirrored")));
    await clickText(page, ".pe-toolbar button", "Undo");
    await sleep(200);
    check("Undo puts it back", (await picture(page))[0] === "1 2 _ 3 4", (await picture(page))[0]);
    await clickText(page, ".pe-toolbar button", "Redo");
    await sleep(200);
    check("Redo mirrors it again", (await picture(page))[0] === "4 3 _ 2 1");
    await page.keyboard.down("Control");
    await page.keyboard.press("z");
    await page.keyboard.up("Control");
    await sleep(200);
    check("so does Ctrl+Z, undo", (await picture(page))[0] === "1 2 _ 3 4");
    await clickText(page, ".pe-toolbar button", "Mirror left ↔ right");
    await sleep(200);
    check("the whole plan mirrored", JSON.stringify(await picture(page)) ===
      JSON.stringify(["4 3 _ 2 1", "8 7 _ 6 5", "12 11 _ 10 9", "16 15 _ 14 13"]), JSON.stringify(await picture(page)));
    await clickText(page, ".pe-toolbar button", "Undo");
    await sleep(200);

    console.log("\n== swapped ==");
    await (await seat(page, "1")).click();
    await ctrlClick(page, "2");
    await clickText(page, ".pe-actions button", "Swap with…");
    await page.waitForSelector(".pe-swapbar");
    check("the first two wait, in purple", (await page.$$(".seat.in-swap")).length === 2);
    await (await seat(page, "15")).click();
    check("Swap waits for as many", await page.evaluate(() =>
      [...document.querySelectorAll(".pe-swapbar button")].find((b) => /^Swap/.test(b.innerText.trim()))?.disabled === true));
    await ctrlClick(page, "16");
    await clickText(page, ".pe-swapbar button", "Swap 2 ↔ 2");
    await sleep(300);
    const swapped = await picture(page);
    check("two seats swapped with two, numbers and all", swapped[0] === "15 16 _ 3 4" && swapped[3] === "13 14 _ 1 2", JSON.stringify(swapped));
    await clickText(page, ".pe-toolbar button", "Undo");
    await sleep(200);

    console.log("\n== checked ==");
    await (await seat(page, "3")).click();
    await page.keyboard.press("4");
    await sleep(300);
    await page.click(".seatgrid-station"); // away from the number field
    const twice = await checksText(page);
    check("a number typed straight onto a seat", (await picture(page))[0] === "1 2 _ 4 4", (await picture(page))[0]);
    check("the checks say it is on two seats, and mark them", /Seat 4 is on 2 seats/.test(twice) && (await page.$$(".seat.problem")).length === 2, twice);
    await clickText(page, ".pe-checks button", "Show");
    await sleep(200);
    check("Show chooses them", (await page.$$(".seat.selected")).length === 2);
    await page.keyboard.press("Escape");
    await clickText(page, ".pe-toolbar button", "Undo");
    await sleep(200);
    check("undone: no problem left", !/is on 2 seats/.test(await checksText(page)) && (await picture(page))[0] === "1 2 _ 3 4");

    console.log("\n== several at once ==");
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await sleep(200);
    check("Ctrl+A: every seat", /16 seats selected/.test(await page.evaluate(() => document.querySelector(".pe-count")?.innerText || "")));
    await page.click('button[aria-label="Fan: all"]');
    await sleep(200);
    check("a fan for all of them", (await page.$$(".seat .seat-amenity[title=Fan]")).length === 16);
    await page.keyboard.press("Escape");
    await (await seat(page, "5")).click();
    await page.keyboard.press("ArrowRight");
    check("the arrows move along", (await page.$$(".seat.selected")).length === 1 && Boolean(await page.$('.seat.selected[data-seat="6"]')));
    await page.keyboard.press("Delete");
    await sleep(200);
    check("Delete leaves a blank", (await picture(page))[1] === "5 _ _ 6 7", (await picture(page))[1]);
    await page.keyboard.press(" ");
    await sleep(200);
    check("Space makes it a seat again", (await picture(page))[1] === "5 6 _ 7 8", (await picture(page))[1]);

    console.log("\n== rows copied ==");
    await page.click('button[aria-label="Duplicate row"]');
    await sleep(200);
    check("a row duplicated below it", (await picture(page)).length === 5 && (await picture(page))[1] === "5 6 _ 7 8");
    await page.evaluate(() => document.querySelectorAll(".row-index--pick")[0].click());
    await page.keyboard.down("Control");
    await page.keyboard.press("c");
    await page.keyboard.up("Control");
    await page.keyboard.press("Escape");
    check("copied, and offered to paste", await clickText(page, ".pe-toolbar button", "Paste 1 row"));
    await sleep(200);
    check("pasted at the end", (await picture(page)).length === 6);

    console.log("\n== numbering ==");
    await clickText(page, ".pe-toolbar button", "Numbering…");
    await page.waitForSelector(".pe-dialog #pe-start");
    const start = await page.$("#pe-start");
    await start.click({ clickCount: 3 });
    await start.type("101");
    await page.type("#pe-prefix", "A");
    await clickText(page, ".pe-dialog .p-selectbutton .p-button", "Snake");
    await sleep(300);
    const preview = await page.evaluate(() => document.querySelector(".pe-preview")?.innerText || "");
    check("the dialog shows how the first rows will read", /A101/.test(preview) && /A108/.test(preview), preview);
    await clickText(page, ".pe-dialog button", "Number them so");
    await sleep(300);
    const numbered = await picture(page);
    check("from 101, with the prefix, snaking", numbered[0] === "A101 A102 _ A103 A104" && numbered[1] === "A108 A107 _ A106 A105", JSON.stringify(numbered));

    console.log("\n== unsaved, then saved ==");
    check("it says there are unsaved changes", /Unsaved changes/.test(await page.evaluate(() => document.body.innerText)));
    await page.evaluate(() => [...document.querySelectorAll(".dash-nav a")].find((a) => a.innerText.trim() === "Seat Plans")?.click());
    await sleep(800);
    check("a link away asks first, and staying stays", asked >= 1 && /\/dashboard\/plans\/new$/.test(page.url()), `${asked} ${page.url()}`);
    await clickText(page, ".page-head button", "Save draft");
    await page.waitForFunction(() => /\/dashboard\/plans\/\d+\/edit$/.test(location.pathname), { timeout: 15000 });
    const id = Number(page.url().match(/plans\/(\d+)\/edit/)[1]);
    made.push(id);
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector(".pe-toolbar");
    const again = await picture(page);
    check("opened again: numbered as it was saved", again[0] === "A101 A102 _ A103 A104" && again[1] === "A108 A107 _ A106 A105", JSON.stringify(again));
    check("and nothing unsaved", !/Unsaved changes/.test(await page.evaluate(() => document.body.innerText)));

    console.log("\n== the same layout, more coaches ==");
    await clickText(page, ".page-head button", "Save to more coaches…");
    await page.waitForSelector(".pe-dialog #pe-coaches");
    for (const coach of ["ZZ-E2E-1", "ZZ-E2E-2"]) {
      await page.type("#pe-coaches", coach);
      await page.keyboard.press("Enter");
    }
    await clickText(page, ".pe-dialog button", "Save 2 copies");
    const results = await waitFor(page, () => {
      const items = [...document.querySelectorAll(".pe-results li")];
      return items.length === 2 ? items.map((li) => li.className + " " + li.innerText) : null;
    });
    check("two more plans, each its own", Array.isArray(results) && results.every((r) => /is-ok/.test(r) && /saved as a draft/.test(r)), JSON.stringify(results));
    const ids = await page.evaluate(() => [...document.querySelectorAll(".pe-results a")].map((a) => Number(a.href.match(/plans\/(\d+)/)[1])));
    made.push(...ids);
    await clickText(page, ".pe-dialog button", "Done");
    await page.screenshot({ path: path.join(OUT, "plan-editor-1.png"), fullPage: true });

    console.log("\n== the phone ==");
    const phone = await signIn(browser, "unittest-super1@example.com", { width: 390, height: 844, isMobile: true, hasTouch: true });
    await phone.goto(`${BASE}/dashboard/plans/${id}/edit`, { waitUntil: "networkidle0" });
    await phone.waitForSelector(".pe-toolbar");
    await phone.evaluate(() => [...document.querySelectorAll(".pe-toolbar button")].find((b) => b.innerText.trim() === "Select several")?.click());
    const seats = await phone.$$(".seat");
    await seats[0].tap();
    await seats[1].tap();
    await sleep(200);
    check("Select several: a tap adds to the choice", (await phone.$$(".seat.selected")).length === 2);
    check("the editor fits a phone; the grid scrolls inside itself", await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 0));
    await phone.screenshot({ path: path.join(OUT, "plan-editor-2-phone.png"), fullPage: true });

    const errors = [...page.errors, ...phone.errors];
    check("no browser errors along the way", errors.length === 0, errors.join(" | "));
  } finally {
    for (const id of made) {
      await fetch(`${API}/plans/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    await browser.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
