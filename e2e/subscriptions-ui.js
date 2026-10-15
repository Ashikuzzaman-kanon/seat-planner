// Drive Subscriptions the way three people would: a manager creates one, a
// passenger asks for it on so many devices, a reviewer approves it for a week
// with counts of their own, devices check in from outside and the reviewer
// looks after them, and the passenger cancels. Then the platforms, the rules
// on app versions, and every tab at phone width.
//
//   node subscriptions-ui.js
//
// Each run creates a subscription with a name of its own and closes it at the
// end. It cannot be deleted — it has a history by then — so runs leave closed
// subscriptions behind; use a database you do not mind that in. The devices it
// puts on the passenger's account are removed again, before and after.
const config = require("./config");
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = config.CHROME;
const BASE = config.WEB;
const OUT = config.SHOTS;
const PAGE = `${BASE}/dashboard/subscriptions`;

const MANAGER = "unittest-super1@example.com"; // holds every permission: manages and reviews
const PASSENGER = "unittest-user@example.com";
const PASSWORD = "UnitTest123!";
const STAMP = Date.now().toString(36);
const NAME = `Browser check ${STAMP}`;
const DEVICE_A = `browser-check-${STAMP}-a`;
const DEVICE_B = `browser-check-${STAMP}-b`;
const PLATFORM = `e2e-${STAMP}`;

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The API, called as a program outside the browser would. */
async function api(method, route, { token, body } = {}) {
  const res = await fetch(config.API + route, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

/** A signed-in page in a browser context of its own, so two people can be signed in at once. */
async function signedIn(browser, email, viewport) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("input[type=password]", PASSWORD);
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
      devices: el.querySelector(".sub-card__devices")?.textContent.trim() || null,
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

/** The device counts showing in the open dialog: { windows: 1, android: 1 }. */
const counts = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll(".p-dialog .sub-stepper")].map((s) => [
        s.dataset.platform,
        Number(s.querySelector(".sub-stepper__value").textContent),
      ])
    )
  );

/** Press a platform's minus or plus in the open dialog, one press at a time as a person would. */
async function step(page, platform, direction, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(
      (platform, up) => document.querySelectorAll(`.p-dialog .sub-stepper[data-platform="${platform}"] .sub-stepper__btn`)[up ? 1 : 0].click(),
      platform,
      direction === "up"
    );
    await sleep(60);
  }
}

/** Click an icon button, found by what it says it does, inside the first element matching `within` that mentions `mention`. */
const clickLabelled = (page, within, mention, label) =>
  page.evaluate(
    (within, mention, label) => {
      const el = [...document.querySelectorAll(within)].find((e) => e.textContent.includes(mention));
      const button = el && [...el.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").startsWith(label));
      if (button) button.click();
      return Boolean(button);
    },
    within,
    mention,
    label
  );

(async () => {
  // Start from an account with nothing running and no devices on it, whatever
  // an earlier run left: places are counted across the whole account, so a
  // subscription still running from a run that stopped half-way would change
  // which device is let in.
  const staff = (await api("POST", "/auth/login", { body: { email: MANAGER, password: PASSWORD } })).body;
  const subscriber = (await api("POST", "/auth/login", { body: { email: PASSENGER, password: PASSWORD } })).body;
  for (const status of ["active", "pending"]) {
    const left = (await api("GET", `/subscriptions/members?status=${status}&search=${encodeURIComponent(PASSENGER)}&limit=100`, { token: staff.accessToken })).body?.members || [];
    for (const member of left) {
      await api("POST", `/subscriptions/members/${member.id}/cancel`, { token: staff.accessToken, body: { reason: "Left by an earlier browser check" } });
    }
  }
  const clearDevices = async () => {
    const held = (await api("GET", `/subscriptions/users/${subscriber.user.id}/devices`, { token: staff.accessToken })).body?.devices || [];
    for (const device of held) await api("DELETE", `/subscriptions/devices/${device.id}`, { token: staff.accessToken });
  };
  await clearDevices();

  /** Whether the subscription made here is valid for the passenger on a device. */
  let code = null;
  const checkFrom = async (deviceId, platform = "windows", version = "1.4.2") => {
    const res = await api("POST", "/subscriptions/check", { body: { email: PASSENGER, password: PASSWORD, deviceId, platform, version } });
    return { status: res.status, entry: res.body?.subscriptions?.find((s) => s.code === code), body: res.body };
  };

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const laptop = { width: 1440, height: 900 };

  /* ---------------- The manager creates one ---------------- */
  console.log("== a manager creates a subscription ==");
  const manager = await signedIn(browser, MANAGER, laptop);
  await manager.page.goto(PAGE, { waitUntil: "networkidle0" });
  check("the page is in the menu", (await manager.page.$('a[href="/dashboard/subscriptions"]')) !== null);
  check("someone who reviews, manages and looks after versions sees the five tabs",
    (await manager.page.$$eval(".sub-tab", (tabs) => tabs.map((t) => t.textContent.trim().replace(/\d+$/, "")).join("|"))) ===
      "Subscriptions|Requests|Subscribers|Platforms|Versions");

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
  code = await manager.page.evaluate((name) => {
    const el = [...document.querySelectorAll(".sub-card")].find((c) => c.querySelector("h3")?.textContent === name);
    return el?.querySelector(".sub-code")?.textContent.trim() || null;
  }, NAME);
  check("with its code shown to staff", /^browser-check-/.test(code || ""), code);

  /* ---------------- A passenger asks ---------------- */
  console.log("\n== a passenger asks for it, saying on how many devices ==");
  const passenger = await signedIn(browser, PASSENGER, laptop);
  await passenger.page.goto(PAGE, { waitUntil: "networkidle0" });
  check("an ordinary account sees no tabs", (await passenger.page.$$(".sub-tab")).length === 0);
  const before = await card(passenger.page, NAME);
  check("the new subscription is offered", before?.standing === "Not subscribed" && before.buttons.join() === "Subscribe", JSON.stringify(before));
  await clickInCard(passenger.page, NAME, "Subscribe");
  await passenger.page.waitForSelector(".p-dialog .sub-stepper");
  let chosen = await counts(passenger.page);
  check("subscribing asks how many devices, starting on one of each", chosen.windows === 1 && chosen.android === 1, JSON.stringify(chosen));
  for (const platform of Object.keys(chosen)) await step(passenger.page, platform, "down", chosen[platform]);
  check("with none chosen it says so, and cannot be sent",
    /Choose at least one device/.test(await passenger.page.$eval(".p-dialog", (d) => d.innerText)) &&
      (await clickInDialog(passenger.page, "^Send request$")) === null);
  await step(passenger.page, "windows", "up", 2);
  await step(passenger.page, "android", "up", 1);
  chosen = await counts(passenger.page);
  check("the steppers count up", chosen.windows === 2 && chosen.android === 1, JSON.stringify(chosen));
  await passenger.page.screenshot({ path: path.join(OUT, "subs-2-subscribe.png") });
  await clickInDialog(passenger.page, "^Send request$");
  await dialogGone(passenger.page);
  const asked = await waitFor(passenger.page, (name) => {
    const el = [...document.querySelectorAll(".sub-card")].find((c) => c.querySelector("h3")?.textContent === name);
    return /waiting for approval/.test(el?.querySelector(".sub-standing")?.textContent || "");
  }, NAME);
  const waiting = await card(passenger.page, NAME);
  check("asking shows it waiting, with a way to withdraw", Boolean(asked) && waiting.buttons.join() === "Withdraw request");
  check("and what was asked for", waiting.devices === "Asked for 2 Windows, 1 Android", waiting.devices);

  /* ---------------- The reviewer approves ---------------- */
  console.log("\n== a reviewer approves it for a week, on fewer devices ==");
  await manager.page.goto(`${PAGE}?tab=requests`, { waitUntil: "networkidle0" });
  check("?tab=requests opens on the queue",
    (await manager.page.$eval(".sub-tab.is-active", (t) => t.textContent.trim())).startsWith("Requests"));
  const row = (name) => {
    const el = [...document.querySelectorAll(".sub-request")].find((r) => r.textContent.includes(name));
    return el ? el.textContent : null;
  };
  const request = (await waitFor(manager.page, row, NAME)) || "";
  check("the request is in it, saying who asked", /Unit Test User/.test(request));
  check("and on how many devices", /on 2 Windows, 1 Android/.test(request), request);
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
  let granted = await counts(manager.page);
  check("the counts start on what was asked for", granted.windows === 2 && granted.android === 1, JSON.stringify(granted));
  await step(manager.page, "windows", "down");
  granted = await counts(manager.page);
  check("and the reviewer can change them", granted.windows === 1 && granted.android === 1, JSON.stringify(granted));
  await manager.page.screenshot({ path: path.join(OUT, "subs-3-approve.png") });
  const pressed = await clickInDialog(manager.page, "^Approve until");
  check("the button names the last day", /^Approve until \d{1,2} \w{3} \d{4}$/.test(pressed || ""), pressed);
  await dialogGone(manager.page);
  check("the request leaves the queue", Boolean(await waitFor(manager.page, (name) => ![...document.querySelectorAll(".sub-request")].some((r) => r.textContent.includes(name)), NAME)));

  await manager.page.evaluate(() => document.querySelectorAll(".sub-tab")[2].click());
  const subscriberRow = (name) => {
    const el = [...document.querySelectorAll(".sub-table tbody tr")].find((r) => r.textContent.includes(name));
    return el ? el.innerText : null;
  };
  const running = (await waitFor(manager.page, (name) => {
    const el = [...document.querySelectorAll(".sub-table tbody tr")].find((r) => r.textContent.includes(name) && /Running/.test(r.textContent));
    return el ? el.innerText : null;
  }, NAME)) || "";
  check("and the person is among the subscribers", Boolean(running));
  check("with the counts the reviewer gave", /1 Windows, 1 Android/.test(running), running);
  const untipped = await manager.page.$$eval(".sub-table .p-button", (buttons) =>
    buttons.filter((b) => !b.textContent.trim() && !b.getAttribute("aria-label")).length);
  check("every icon-only button there says what it does", untipped === 0, `${untipped} without a label`);

  /* ---------------- Devices check in ---------------- */
  console.log("\n== devices check in from outside, and the reviewer looks after them ==");
  const first = await checkFrom(DEVICE_A);
  check("the first Windows device is valid", first.status === 200 && first.entry?.valid === true, JSON.stringify(first.body));
  const second = await checkFrom(DEVICE_B);
  check("a second is not", second.status === 200 && second.entry?.valid === false, JSON.stringify(second.body));
  check("and is told nothing but that",
    Object.keys(second.body).sort().join() === "subscriptions,user" && second.body.subscriptions.every((s) => Object.keys(s).sort().join() === "code,valid"),
    JSON.stringify(second.body));

  await clickLabelled(manager.page, ".sub-table tbody tr", NAME, "Devices");
  await manager.page.waitForSelector(".p-dialog .sub-dev");
  const dialog = () => manager.page.$eval(".p-dialog", (d) => d.innerText);
  let seen = await dialog();
  check("the reviewer sees the device and its place", seen.includes(DEVICE_A) && /Place 1/.test(seen), seen.slice(0, 400));
  check("and the app version it checked in with", /version 1\.4\.2/.test(seen), seen.slice(0, 400));
  check("and why the other was turned away", /every place was taken/.test(seen) && seen.includes(DEVICE_B), seen.slice(-400));

  await clickLabelled(manager.page, ".p-dialog .sub-dev", DEVICE_A, "Add a note");
  await manager.page.waitForSelector(".sub-dev__note-form input");
  await manager.page.type(".sub-dev__note-form input", "Office laptop");
  await manager.page.evaluate(() => document.querySelector(".sub-dev__note-form button[type=submit]").click());
  check("a note can be put on a device",
    Boolean(await waitFor(manager.page, () => document.querySelector(".p-dialog .sub-dev__note")?.textContent.includes("Office laptop"))));

  await step(manager.page, "windows", "up");
  await clickInDialog(manager.page, "^Save counts$");
  check("the counts can be raised while it runs",
    Boolean(await waitFor(manager.page, () => /1 of 2/.test(document.querySelector(".p-dialog .sub-usage")?.textContent || ""))));
  check("then the second device is let in", (await checkFrom(DEVICE_B)).entry?.valid === true);

  await clickLabelled(manager.page, ".p-dialog .sub-dev", DEVICE_A, "Block this device");
  check("a device can be blocked",
    Boolean(await waitFor(manager.page, (id) => {
      const el = [...document.querySelectorAll(".p-dialog .sub-dev")].find((d) => d.textContent.includes(id));
      return /Blocked/.test(el?.querySelector(".p-tag")?.textContent || "");
    }, DEVICE_A)));
  check("which is then not valid", (await checkFrom(DEVICE_A)).entry?.valid === false);
  await manager.page.screenshot({ path: path.join(OUT, "subs-4-devices.png") });

  // The same dialog at a phone's width, while it has everything in it. Only the
  // size changes: asking for a touch screen as well would reload the page.
  await manager.page.setViewport({ width: 390, height: 844 });
  await sleep(400);
  const squeezed = await manager.page.evaluate(() => {
    const box = document.querySelector(".p-dialog");
    const content = document.querySelector(".p-dialog-content");
    return { page: document.documentElement.scrollWidth - window.innerWidth, dialog: content.scrollWidth - content.clientWidth, right: Math.round(box.getBoundingClientRect().right) };
  });
  check("the devices dialog fits a phone", squeezed.page <= 0 && squeezed.dialog <= 0 && squeezed.right <= 390, JSON.stringify(squeezed));
  await manager.page.screenshot({ path: path.join(OUT, "subs-5-devices-phone.png") });
  await manager.page.setViewport(laptop);
  await sleep(300);

  await clickLabelled(manager.page, ".p-dialog .sub-dev", DEVICE_A, "Unblock");
  await waitFor(manager.page, (id) => {
    const el = [...document.querySelectorAll(".p-dialog .sub-dev")].find((d) => d.textContent.includes(id));
    return /^Place 1$/.test(el?.querySelector(".p-tag")?.textContent.trim() || "");
  }, DEVICE_A);
  check("and unblocked, it is valid again", (await checkFrom(DEVICE_A)).entry?.valid === true);

  await clickLabelled(manager.page, ".p-dialog .sub-dev", DEVICE_B, "Remove from the account");
  await manager.page.waitForSelector(".p-dialog .sub-dev__confirm");
  check("removing asks first, and says blocking is what keeps a device out", /block it instead/.test(await dialog()));
  await clickInDialog(manager.page, "^Remove$");
  check("then it is gone from the account",
    Boolean(await waitFor(manager.page, (id) => ![...document.querySelectorAll(".p-dialog .sub-dev")].some((d) => d.textContent.includes(id)), DEVICE_B)));
  await manager.page.evaluate(() => document.querySelector(".p-dialog-header-close").click());
  await dialogGone(manager.page);
  check("and the list shows the new counts", /2 Windows, 1 Android/.test((await waitFor(manager.page, subscriberRow, NAME)) || ""));

  /* ---------------- Version rules, for this subscription ---------------- */
  // While the passenger's subscription runs and DEVICE_A has a place, so a
  // version this subscription turns away is the only thing in the way — the
  // one case the check says why.
  console.log("\n== this subscription's rules on app versions ==");
  await manager.page.goto(PAGE, { waitUntil: "networkidle0" });
  check("each card has a way to its version rules", await clickInCard(manager.page, NAME, "Version rules"));
  await waitFor(manager.page, () => document.querySelector(".sub-versions-pick"));
  check("which opens the Versions tab on that subscription",
    (await manager.page.$eval(".sub-tab.is-active", (t) => t.textContent.trim())).startsWith("Versions") &&
      (await manager.page.$eval(".sub-versions-pick .p-dropdown-label", (l) => l.textContent.trim())) === NAME &&
      new URL(manager.page.url()).searchParams.get("subscription") !== null,
    manager.page.url());

  /** The Windows rules of the subscription shown: its text, or click, focus or read one thing in it. */
  const inCard = (op, selector) =>
    manager.page.evaluate(
      (op, selector) => {
        const el = [...document.querySelectorAll(".sub-versions")].find((c) => c.querySelector(".sub-request__who code")?.textContent === "windows");
        if (!el) return null;
        if (op === "text") return el.innerText;
        const target = el.querySelector(selector);
        if (!target) return null;
        if (op === "click") target.click();
        if (op === "focus") target.focus();
        return op === "disabled" ? target.disabled : op === "value" ? target.value : true;
      },
      op,
      selector
    );
  const cardText = async () => (await inCard("text")) || "";
  const savedToast = (words) => waitFor(manager.page, (words) => (document.querySelector(".p-toast")?.textContent || "").includes(words), words);
  await waitFor(manager.page, () => document.querySelector(".sub-versions"));
  check("it starts with no rules", /None[.]/.test(await cardText()) && !(await inCard("value", ".sub-versions__minimum input")), await cardText());
  check("and shows the version its subscriber's device checked in with", /1\.4\.2\s+1 device/.test(await cardText()), await cardText());

  const entryOf = (r) => r.entry || {};
  let res = await checkFrom(DEVICE_A, "windows", "");
  check("with no rules, a check without a version is valid", res.entry?.valid === true, JSON.stringify(res.body));

  await inCard("click", ".p-inputswitch input");
  await savedToast("A version is now required");
  res = await checkFrom(DEVICE_A, "windows", "");
  check("a version can be required — then that subscription says so",
    entryOf(res).valid === false && entryOf(res).message === "A version is required", JSON.stringify(res.body));

  await inCard("focus", ".sub-versions__minimum input");
  await manager.page.keyboard.type("two");
  check("a minimum that is not a version cannot be saved", await inCard("disabled", ".sub-versions__minimum button[type=submit]"));
  await manager.page.keyboard.down("Control");
  await manager.page.keyboard.press("a");
  await manager.page.keyboard.up("Control");
  await manager.page.keyboard.type("2.0");
  await inCard("click", ".sub-versions__minimum button[type=submit]");
  check("a minimum can be set", Boolean(await savedToast("Minimum is now 2.0")));
  res = await checkFrom(DEVICE_A);
  check("then an older version is told to update",
    entryOf(res).valid === false && entryOf(res).message === "This version is no longer supported. Please update.", JSON.stringify(res.body));
  check("and the screen marks who that turns away",
    Boolean(await waitFor(manager.page, () => /Older than the minimum/.test(document.body.innerText) && /1 device last checked in with a version these rules refuse/.test(document.body.innerText))));
  check("while the minimum itself is valid", (await checkFrom(DEVICE_A, "windows", "2")).entry?.valid === true);

  await inCard("focus", ".sub-versions__block-form input");
  await manager.page.keyboard.type("v2.1");
  await manager.page.keyboard.press("Tab");
  await manager.page.keyboard.type("Crashes on start");
  await inCard("click", ".sub-versions__block-form button[type=submit]");
  check("a single version can be blocked, with why",
    Boolean(await waitFor(manager.page, () => {
      const el = [...document.querySelectorAll(".sub-versions")].find((c) => c.querySelector(".sub-request__who code")?.textContent === "windows");
      const row = el?.querySelector(".sub-versions__blocked li");
      return row && /2\.1/.test(row.textContent) && /Crashes on start/.test(row.textContent);
    })));
  res = await checkFrom(DEVICE_A, "windows", "2.1.0");
  check("which is then refused, however it is written", entryOf(res).message === "This version is no longer supported. Please update.", JSON.stringify(res.body));
  check("while the next one is valid", (await checkFrom(DEVICE_A, "windows", "2.2")).entry?.valid === true);
  await manager.page.screenshot({ path: path.join(OUT, "subs-5b-versions.png") });

  await inCard("click", '.sub-versions__blocked button[aria-label^="Unblock"]');
  await savedToast("Version 2.1 unblocked");
  check("it can be unblocked, after which it checks again", (await checkFrom(DEVICE_A, "windows", "2.1")).entry?.valid === true);

  // Back to no rules, so the rest of the run is not about versions.
  await inCard("focus", ".sub-versions__minimum input");
  await manager.page.keyboard.down("Control");
  await manager.page.keyboard.press("a");
  await manager.page.keyboard.up("Control");
  await manager.page.keyboard.press("Backspace");
  await inCard("click", ".sub-versions__minimum button[type=submit]");
  await savedToast("Minimum removed");
  await inCard("click", ".p-inputswitch input");
  await savedToast("A version is no longer required");
  check("and the rules can be cleared", (await checkFrom(DEVICE_A, "windows", "")).entry?.valid === true);

  /* ---------------- The passenger sees it, and cancels ---------------- */
  console.log("\n== the passenger sees it running, and cancels ==");
  await passenger.page.goto(PAGE, { waitUntil: "networkidle0" });
  const active = await card(passenger.page, NAME);
  check("the card says until when", /^Active until \d{1,2} \w{3} \d{4}$/.test(active?.standing || "") && active.buttons.join() === "Cancel subscription",
    JSON.stringify(active));
  check("and on how many devices", active?.devices === "On 2 Windows, 1 Android", active?.devices);
  const mine = await passenger.page.evaluate(() => {
    const section = document.querySelector("#sub-devices-title")?.closest("section");
    return section ? { text: section.innerText, buttons: section.querySelectorAll("button").length } : null;
  });
  check("they see their devices and how many places are used", Boolean(mine) && mine.text.includes(DEVICE_A) && /1 of 2/.test(mine.text), JSON.stringify(mine));
  check("to look at, not to change — and without staff's note", mine?.buttons === 0 && !/Office laptop/.test(mine?.text || ""), JSON.stringify(mine));
  await passenger.page.screenshot({ path: path.join(OUT, "subs-6-active.png"), fullPage: true });
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
  check("and no device is valid for it any more", (await checkFrom(DEVICE_A)).entry?.valid === false);

  /* ---------------- Platforms ---------------- */
  console.log("\n== the platforms ==");
  await manager.page.goto(`${PAGE}?tab=platforms`, { waitUntil: "networkidle0" });
  check("?tab=platforms opens on them",
    (await manager.page.$eval(".sub-tab.is-active", (t) => t.textContent.trim())).startsWith("Platforms"));
  const platformRows = () => manager.page.$$eval(".sub-platform", (rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ").trim()));
  const listed = await platformRows();
  check("Windows and Android are there, with what a caller sends",
    listed.some((r) => /^Windows Callers send windows On/.test(r)) && listed.some((r) => /^Android Callers send android On/.test(r)), listed.join(" | "));
  const addDisabled = () => manager.page.$eval(".sub-platform-form button[type=submit]", (b) => b.disabled);
  check("adding one needs a name and a value", await addDisabled());
  await manager.page.type("#platform-name", "Browser check TV");
  await manager.page.type("#platform-value", "smart tv!");
  check("and a value that is a tidy word",
    (await addDisabled()) && /Lowercase letters and digits/.test(await manager.page.$eval("#platform-value-hint", (h) => h.textContent)));
  await manager.page.click("#platform-value", { clickCount: 3 });
  await manager.page.keyboard.press("Backspace");
  await manager.page.type("#platform-value", PLATFORM);
  await manager.page.click(".sub-platform-form button[type=submit]");
  check("a new platform joins the list",
    Boolean(await waitFor(manager.page, (value) => [...document.querySelectorAll(".sub-platform")].some((r) => r.textContent.includes(value)), PLATFORM)));
  await manager.page.screenshot({ path: path.join(OUT, "subs-7-platforms.png") });
  await clickLabelled(manager.page, ".sub-platform", PLATFORM, "Switch off");
  check("it can be switched off",
    Boolean(await waitFor(manager.page, (value) => {
      const el = [...document.querySelectorAll(".sub-platform")].find((r) => r.textContent.includes(value));
      return /Switched off/.test(el?.textContent || "");
    }, PLATFORM)));
  await clickLabelled(manager.page, ".sub-platform", PLATFORM, "Delete");
  await manager.page.waitForSelector(".p-dialog");
  await clickInDialog(manager.page, "^Delete$");
  await dialogGone(manager.page);
  check("and, with nothing using it, deleted",
    Boolean(await waitFor(manager.page, (value) => ![...document.querySelectorAll(".sub-platform")].some((r) => r.textContent.includes(value)), PLATFORM)));

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
  for (const tab of ["subscriptions", "requests", "subscribers", "platforms", "versions"]) {
    await phone.page.goto(`${PAGE}?tab=${tab}`, { waitUntil: "networkidle0" });
    const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`no sideways scrolling on a phone: ${tab}`, overflow <= 0, `${overflow}px`);
  }
  await phone.page.screenshot({ path: path.join(OUT, "subs-8-phone.png"), fullPage: true });

  const errors = [...manager.errors, ...passenger.errors, ...phone.errors];
  check("no browser errors along the way", errors.length === 0, errors.join(" | "));

  await browser.close();
  await clearDevices();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
