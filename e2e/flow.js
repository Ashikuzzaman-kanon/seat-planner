// Walk the screens a route audit cannot reach: search results, the "where is
// there room" matrix, the seat step (auto and by hand), the inventory pair
// dialog and the departure seat dialog. Screenshots at both widths.
//
//   node flow.js <label> [desk|phone]
const config = require("./config");
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const CHROME = config.CHROME;
const BASE = config.WEB;
const OUT = config.SHOTS;
const label = process.argv[2] || "flow";
const only = process.argv[3];

const VIEWPORTS = [
  { name: "desk", width: 1440, height: 900 },
  { name: "phone", width: 400, height: 860, isMobile: true, hasTouch: true },
].filter((v) => !only || v.name === only);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function pick(page, fieldIndex, text) {
  const fields = await page.$$(".journey-field .p-dropdown");
  await fields[fieldIndex].click();
  await page.waitForSelector(".p-dropdown-panel .p-dropdown-filter", { visible: true });
  await wait(300);
  await page.focus(".p-dropdown-panel .p-dropdown-filter");
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForFunction(
    (t) => {
      const first = document.querySelector(".p-dropdown-panel .p-dropdown-item");
      return first && first.textContent.toLowerCase().includes(t.toLowerCase());
    },
    { timeout: 5000 },
    text
  );
  await page.click(".p-dropdown-panel .p-dropdown-item");
  await wait(400);
}

async function clickText(page, selector, text) {
  const handles = await page.$$(selector);
  for (const h of handles) {
    const t = await page.evaluate((el) => el.textContent.trim(), h);
    if (t.includes(text)) {
      await h.click();
      return true;
    }
  }
  return false;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
  const errors = [];

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport(vp);
    page.on("pageerror", (e) => errors.push(`${vp.name}: ${e.message.split("\n")[0]}`));
    const shot = async (name, full = false) => {
      await wait(350);
      await page.screenshot({ path: path.join(OUT, `${label}-${vp.name}-${name}.png`), fullPage: full });
      console.log(`  ${vp.name} ${name}`);
    };

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
    await page.type("#email", "unittest-super1@example.com");
    await page.type("input[type=password]", "UnitTest123!");
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
    ]);

    // ---------------- Booking ----------------
    await page.goto(`${BASE}/dashboard/book`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".journey-field .p-dropdown");
    await pick(page, 0, "Kamalapur");
    await pick(page, 1, "Setu East");
    await shot("journey-filled");
    await page.click(".journey-search");
    await page.waitForSelector(".departure-card", { timeout: 20000 }).catch(async (e) => {
      await shot("journey-stuck");
      throw e;
    });
    await shot("results");
    await shot("results-full", true);

    await page.click(".departure-room");
    await page.waitForSelector(".matrix-dialog .matrix-list, .matrix-dialog .matrix-grid", { timeout: 15000 });
    await shot("room-row");
    await clickText(page, ".matrix-views .p-button", "Every pair");
    await wait(300);
    await shot("room-grid");
    await page.keyboard.press("Escape");
    await wait(400);

    await clickText(page, ".departure-card .p-button", "Choose seats");
    await page.waitForSelector(".seat-proposal, .seat-refusal", { timeout: 20000 });
    await shot("seat-auto");

    await clickText(page, ".seat-toolbar .p-button", "Choose myself");
    await page.waitForSelector(".coach", { timeout: 20000 });
    await wait(400);
    await shot("seat-manual");
    const free = await page.$(".coach-seat.is-free");
    if (free) {
      await free.click();
      await wait(200);
    }
    await shot("seat-manual-picked");
    await clickText(page, ".coach-orient__btn", "Across");
    await shot("seat-manual-across");

    // ---------------- Inventory pair dialog ----------------
    await page.goto(`${BASE}/dashboard/inventory`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".inv-matrix, .pm-cell", { timeout: 20000 }).catch(() => {});
    await wait(500);
    await shot("inventory");
    const cell = await page.$(".inv-matrix .cell:not(.empty), .pm-cell:not(:disabled)");
    if (cell) {
      await cell.click();
      await page.waitForSelector(".p-dialog", { timeout: 15000 });
      await wait(1200);
      await shot("inventory-pair");
      await page.keyboard.press("Escape");
      await wait(300);
    }

    // ---------------- Departure seats dialog ----------------
    await page.goto(`${BASE}/dashboard/departures`, { waitUntil: "networkidle0" });
    await wait(500);
    const seatsBtn = await page.$('[aria-label="Seats"], [aria-label="Seat map"], .p-button .pi-th-large');
    if (seatsBtn) {
      await seatsBtn.click();
      await page.waitForSelector(".p-dialog", { timeout: 15000 }).catch(() => {});
      await wait(1200);
      await shot("departure-seats");
      await page.keyboard.press("Escape");
    }

    await page.close();
  }
  await browser.close();
  console.log(errors.length ? `\nerrors:\n${errors.join("\n")}` : "\nno page errors");
})().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
