// The later booking steps: seats held -> passengers -> payment -> (gateway)
// -> confirmation. Uses the unittest-super1 account.
//
//   node flow2.js <label> [desk|phone] [--pay]
//
// Without --pay the walk stops at the gateway dialog and gives the seats back.
const config = require("./config");
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const CHROME = config.CHROME;
const BASE = config.WEB;
const OUT = config.SHOTS;
const args = process.argv.slice(2);
const pay = args.includes("--pay");
const [label = "flow2", only] = args.filter((a) => !a.startsWith("--"));

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
  for (const h of await page.$$(selector)) {
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
      await wait(400);
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

    await page.goto(`${BASE}/dashboard/book`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".journey-field .p-dropdown");
    await pick(page, 0, "Kamalapur");
    await pick(page, 1, "Setu East");
    // A later date, so a test booking sits away from today's trains.
    const chips = await page.$$(".date-chip");
    if (chips.length > 3) await chips[3].click();
    await page.click(".journey-search");
    await page.waitForSelector(".departure-card", { timeout: 20000 });
    await clickText(page, ".departure-card .p-button", "Choose seats");
    await page.waitForSelector(".seat-proposal, .seat-refusal", { timeout: 20000 });
    await clickText(page, ".seat-actions .p-button", "Hold these seats");
    await page.waitForSelector(".passenger-card", { timeout: 20000 });
    await shot("passengers");

    // Fill anything the profile did not.
    const fill = async (sel, value) => {
      const el = await page.$(sel);
      if (!el) return;
      const current = await page.evaluate((e) => e.value, el);
      if (!current) {
        await el.click();
        await page.keyboard.type(value);
      }
    };
    await fill("#name-0", "Unit Test Super Admin 1");
    await fill("#nid-0", "1985111122223");
    const dob = await page.$("#dob-0");
    if (dob && !(await page.evaluate((e) => e.value, dob))) {
      await page.evaluate((e) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        set.call(e, "1990-01-15");
        e.dispatchEvent(new Event("input", { bubbles: true }));
      }, dob);
      await page.$eval("#dob-0", (e) => e.blur());
    }
    await shot("passengers-filled");
    // A first booking offers to save passenger 1 as the account's own details.
    // Only the paying run accepts; the others leave the profile alone.
    const offer = await page.$("#save-as-mine");
    if (offer && !pay) {
      await page.click(".profile-needed__choice");
      await wait(200);
      await shot("passengers-not-me");
      await page.click(".profile-needed__choice");
    }
    await clickText(page, ".book-nav .p-button", "ontinue to payment");
    await page.waitForSelector(".payment-option", { timeout: 20000 });
    await shot("payment");
    await shot("payment-full", true);

    // The card gateway.
    await clickText(page, ".payment-option", "Card");
    await wait(300);
    await clickText(page, ".book-nav .p-button", "Pay");
    await page.waitForSelector(".p-dialog", { timeout: 15000 }).catch(() => {});
    await shot("gateway");

    if (pay && vp.name === "desk") {
      await page.click(".gateway-provider");
      await page.waitForSelector("#gw-account", { visible: true });
      await page.type("#gw-account", "01700000000");
      await page.type("#gw-secret", "1234");
      await shot("gateway-credentials");
      await clickText(page, ".p-dialog .return-actions .p-button", "Continue");
      await page.waitForSelector(".gateway-challenge__answer", { visible: true });
      await page.type(".gateway-challenge__answer", "anything");
      await clickText(page, ".p-dialog .return-actions .p-button", "Pay");
      await wait(600);
      await shot("gateway-processing");
      await page.waitForFunction(() => !document.querySelector(".gateway-dialog"), { timeout: 30000 }).catch(() => {});
      await wait(2500);
      await shot("confirmation");
      await shot("confirmation-full", true);
    } else {
      // Give the seats back: close the gateway, step back twice, confirm.
      await page.keyboard.press("Escape");
      await wait(500);
      await clickText(page, ".book-nav .p-button", "Back");
      await page.waitForSelector(".passenger-card", { timeout: 10000 }).catch(() => {});
      await clickText(page, ".book-nav .p-button", "Back");
      await wait(400);
      await clickText(page, ".p-confirm-dialog .p-button", "Yes");
      await wait(1200);
      console.log(`  ${vp.name} released the hold`);
    }
    await page.close();
  }
  await browser.close();
  console.log(errors.length ? `\nerrors:\n${errors.join("\n")}` : "\nno page errors");
})().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
