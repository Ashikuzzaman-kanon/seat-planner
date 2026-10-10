// Drive Subscriptions the way three people would: a manager creates one, a
// passenger asks for it, a reviewer approves it for a week, and the passenger
// cancels. Then the reviewer's tabs at phone width.
//
//   node subscriptions-ui.js
//
// Each run creates a subscription with a name of its own and closes it at the
// end. It cannot be deleted — it has a history by then — so runs leave closed
// subscriptions behind; use a database you do not mind that in.
const config = require("./config");
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = config.CHROME;
const BASE = config.WEB;
const OUT = config.SHOTS;
const PAGE = `${BASE}/dashboard/subscriptions`;

const MANAGER = "unittest-super1@example.com"; // holds every permission: manages and reviews
const PASSENGER = "unittest-user@example.com";
const NAME = `Browser check ${Date.now().toString(36)}`;

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A signed-in page in a browser context of its own, so two people can be signed in at once. */
async function signedIn(browser, email, viewport) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("input[type=password]", "UnitTest123!");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);
  return { page, errors };
}

const text = (page) => page.evaluate(() => document.body.innerText);

async function waitFor(page, fn, arg, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    await sleep(300);
  }
  return null;
}

/** What the card for one subscription says, and the buttons under it. */
const card = (page, name) =>
  page.evaluate((name) => {
    const el = [...document.querySelectorAll(".sub-card")].find((c) => c.querySelector("h3")?.textContent === name);
    if (!el) return null;
    return {
      standing: el.querySelector(".sub-standing")?.textContent.trim(),
      buttons: [...el.querySelectorAll(".sub-card__actions .p-button")].map((b) => b.textContent.trim()),
      closed: Boolean(el.querySelector(".sub-card__closed")),
    };
  }, name);

const clickInCard = (page, name, find) =>
  page.evaluate(
    (name, find) => {
      const el = [...document.querySelectorAll(".sub-card")].find((c) => c.querySelector("h3")?.textContent === name);
      const button =
        el && [...el.querySelectorAll(".p-button")].find((b) => b.textContent.trim() === find || b.getAttribute("aria-label") === find);
      if (button) button.click();
      return Boolean(button);
    },
    name,
    find
  );

const clickInDialog = (page, pattern) =>
  page.evaluate((source) => {
    const button = [...document.querySelectorAll(".p-dialog .p-button")].find((b) => new RegExp(source).test(b.textContent.trim()) && !b.disabled);
    if (button) button.click();
    return button ? button.textContent.trim() : null;
  }, pattern);

const dialogGone = (page) => waitFor(page, () => !document.querySelector(".p-dialog-mask"));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const laptop = { width: 1440, height: 900 };

  /* ---------------- The manager creates one ---------------- */
  console.log("== a manager creates a subscription ==");
  const manager = await signedIn(browser, MANAGER, laptop);
  await manager.page.goto(PAGE, { waitUntil: "networkidle0" });
  check("the page is in the menu", (await manager.page.$('a[href="/dashboard/subscriptions"]')) !== null);
  check("a reviewer sees the three tabs",
    (await manager.page.$$eval(".sub-tab", (tabs) => tabs.map((t) => t.textContent.trim().replace(/\d+$/, "")).join("|"))) ===
      "Subscriptions|Requests|Subscribers");

  await manager.page.evaluate(() => document.querySelector(".page-head .p-button").click());
  await manager.page.waitForSelector("#sub-name");
  check("creating needs a name", await manager.page.$eval(".p-dialog button[type=submit]", (b) => b.disabled));
  await manager.page.type("#sub-name", NAME);
  await manager.page.type("#sub-description", "Made by the browser check.");
  await manager.page.screenshot({ path: path.join(OUT, "subs-1-create.png") });
  await manager.page.click(".p-dialog button[type=submit]");
  await dialogGone(manager.page);
  const made = await waitFor(manager.page, (name) => [...document.querySelectorAll(".sub-card h3")].some((h) => h.textContent === name), NAME);
  check("it appears in the list", Boolean(made));
  check("with its code shown to staff",
    await manager.page.evaluate((name) => {
      const el = [...document.querySelectorAll(".sub-card")].find((c) => c.querySelector("h3")?.textContent === name);
      return /^browser-check-/.test(el?.querySelector(".sub-code")?.textContent.trim() || "");
    }, NAME));

  /* ---------------- A passenger asks ---------------- */
  console.log("\n== a passenger asks for it ==");
  const passenger = await signedIn(browser, PASSENGER, laptop);
  await passenger.page.goto(PAGE, { waitUntil: "networkidle0" });
  check("an ordinary account sees no reviewer tabs", (await passenger.page.$$(".sub-tab")).length === 0);
  const before = await card(passenger.page, NAME);
  check("the new subscription is offered", before?.standing === "Not subscribed" && before.buttons.join() === "Subscribe", JSON.stringify(before));
  await clickInCard(passenger.page, NAME, "Subscribe");
  const asked = await waitFor(passenger.page, (name) => {
    const el = [...document.querySelectorAll(".sub-card")].find((c) => c.querySelector("h3")?.textContent === name);
    return /waiting for approval/.test(el?.querySelector(".sub-standing")?.textContent || "");
  }, NAME);
  check("asking shows it waiting, with a way to withdraw", Boolean(asked) && (await card(passenger.page, NAME)).buttons.join() === "Withdraw request");

  /* ---------------- The reviewer approves ---------------- */
  console.log("\n== a reviewer approves it for a week ==");
  await manager.page.goto(`${PAGE}?tab=requests`, { waitUntil: "networkidle0" });
  check("?tab=requests opens on the queue",
    (await manager.page.$eval(".sub-tab.is-active", (t) => t.textContent.trim())).startsWith("Requests"));
  const row = (name) => {
    const el = [...document.querySelectorAll(".sub-request")].find((r) => r.textContent.includes(name));
    return el ? el.textContent : null;
  };
  check("the request is in it, saying who asked", /Unit Test User/.test((await waitFor(manager.page, row, NAME)) || ""));
  await manager.page.evaluate((name) => {
    [...document.querySelectorAll(".sub-request")].find((r) => r.textContent.includes(name)).querySelector(".p-button").click();
  }, NAME);
  await manager.page.waitForSelector(".sub-period");
  const preview = () => manager.page.$eval(".sub-period__until", (p) => p.textContent.trim());
  check("the dialog says the day thirty days comes to", /^Valid through \d{1,2} \w{3} \d{4}/.test(await preview()), await preview());
  const thirty = await preview();
  await manager.page.evaluate(() => [...document.querySelectorAll(".sub-period .sub-chip")].find((c) => c.textContent === "7 days").click());
  await sleep(200);
  check("and changes with the choice", (await preview()) !== thirty, await preview());
  await manager.page.screenshot({ path: path.join(OUT, "subs-2-approve.png") });
  const pressed = await clickInDialog(manager.page, "^Approve until");
  check("the button names the last day", /^Approve until \d{1,2} \w{3} \d{4}$/.test(pressed || ""), pressed);
  await dialogGone(manager.page);
  check("the request leaves the queue", Boolean(await waitFor(manager.page, (name) => ![...document.querySelectorAll(".sub-request")].some((r) => r.textContent.includes(name)), NAME)));

  await manager.page.evaluate(() => document.querySelectorAll(".sub-tab")[2].click());
  check("and the person is among the subscribers",
    Boolean(await waitFor(manager.page, (name) => [...document.querySelectorAll(".sub-table tbody tr")].some((r) => r.textContent.includes(name) && /Running/.test(r.textContent)), NAME)));
  await manager.page.screenshot({ path: path.join(OUT, "subs-3-subscribers.png") });
  const untipped = await manager.page.$$eval(".sub-table .p-button", (buttons) =>
    buttons.filter((b) => !b.textContent.trim() && !b.getAttribute("aria-label")).length);
  check("every icon-only button there says what it does", untipped === 0, `${untipped} without a label`);

  /* ---------------- The passenger sees it, and cancels ---------------- */
  console.log("\n== the passenger sees it running, and cancels ==");
  await passenger.page.goto(PAGE, { waitUntil: "networkidle0" });
  const running = await card(passenger.page, NAME);
  check("the card says until when", /^Active until \d{1,2} \w{3} \d{4}$/.test(running?.standing || "") && running.buttons.join() === "Cancel subscription",
    JSON.stringify(running));
  await passenger.page.screenshot({ path: path.join(OUT, "subs-4-active.png") });
  await clickInCard(passenger.page, NAME, "Cancel subscription");
  await passenger.page.waitForSelector(".p-dialog");
  check("cancelling asks first, saying what is lost", /stops straight away/.test(await text(passenger.page)));
  await clickInDialog(passenger.page, "^Cancel subscription$");
  await dialogGone(passenger.page);
  const ended = await waitFor(passenger.page, (name) => {
    const el = [...document.querySelectorAll(".sub-card")].find((c) => c.querySelector("h3")?.textContent === name);
    return el?.querySelector(".sub-standing")?.textContent.trim() === "Cancelled";
  }, NAME);
  check("then it reads as cancelled, and can be asked for again", Boolean(ended) && (await card(passenger.page, NAME)).buttons.join() === "Subscribe again");
  check("and is in their earlier requests", /Your earlier requests/.test(await text(passenger.page)));

  /* ---------------- Closing it; the phone ---------------- */
  console.log("\n== closing it, and the phone ==");
  await manager.page.goto(PAGE, { waitUntil: "networkidle0" });
  await clickInCard(manager.page, NAME, "Close to new requests");
  await manager.page.waitForSelector(".p-dialog");
  await clickInDialog(manager.page, "^Close it$");
  await dialogGone(manager.page);
  check("the manager can close it", Boolean(await waitFor(manager.page, (name) => {
    const el = [...document.querySelectorAll(".sub-card")].find((c) => c.querySelector("h3")?.textContent === name);
    return Boolean(el?.querySelector(".sub-card__closed"));
  }, NAME)));
  await passenger.page.goto(PAGE, { waitUntil: "networkidle0" });
  const shut = await card(passenger.page, NAME);
  check("after which nobody can ask for it", shut?.closed === true && shut.buttons.length === 0, JSON.stringify(shut));

  const phone = await signedIn(browser, MANAGER, { width: 390, height: 844, isMobile: true, hasTouch: true });
  for (const tab of ["subscriptions", "requests", "subscribers"]) {
    await phone.page.goto(`${PAGE}?tab=${tab}`, { waitUntil: "networkidle0" });
    const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`no sideways scrolling on a phone: ${tab}`, overflow <= 0, `${overflow}px`);
  }
  await phone.page.screenshot({ path: path.join(OUT, "subs-5-phone.png"), fullPage: true });

  const errors = [...manager.errors, ...passenger.errors, ...phone.errors];
  check("no browser errors along the way", errors.length === 0, errors.join(" | "));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
