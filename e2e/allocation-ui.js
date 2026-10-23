// Seat Allocation, the way it is used: the four filters, a train's grid, a
// count typed in and taken out again, a file read and not applied, and a file
// that is not what it says. Then a passenger, who may not see it at all.
//
//   node allocation-ui.js
//
// Needs the API and the web app running with allocation data uploaded (the
// train routes and a census — Operations → Seat Allocation), and the unit-test
// accounts. Leaves the allocation and its counts as it found them; only the
// time a count last changed moves.
const fs = require("fs");
const os = require("os");
const path = require("path");
const config = require("./config");
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
const label = (s) => s.replace(/_/g, " ");

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

async function api(token, url) {
  const res = await fetch(API + url, { headers: { Authorization: `Bearer ${token}` } });
  return url.endsWith(".csv") || url.includes(".csv?") ? res.text() : res.json();
}

/** Choose in one of the filter dropdowns, typing to find the option. */
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
  await sleep(800);
}
/** Press Save with the mouse, as a person would: the field being typed in loses focus first. */
async function saveButton(page) {
  const handle = await page.evaluateHandle(() =>
    [...document.querySelectorAll(".p-dialog .p-button")].find((b) => b.innerText.trim() === "Save")
  );
  await handle.asElement().click();
}
const summary = (page) => page.evaluate(() => document.querySelector(".al-summary__line")?.innerText || "");
const clickText = (page, selector, pattern) =>
  page.evaluate((s, p) => {
    const b = [...document.querySelectorAll(s)].find((x) => new RegExp(p).test(x.innerText.trim()) && !x.disabled);
    if (b) b.click();
    return Boolean(b);
  }, selector, pattern);

(async () => {
  const browser = await puppeteer.launch({ executablePath: config.CHROME, headless: "new", args: ["--no-sandbox"] });
  const admin = await signIn(browser, "unittest-super1@example.com");
  const token = await admin.evaluate(() => localStorage.getItem("sp_access_token"));

  const first = (await api(token, "/allocation?pageSize=1")).items?.[0];
  if (!first) {
    console.log("No allocation data uploaded — upload the train routes and a census first.");
    process.exit(1);
  }
  const train = first.train;

  console.log("== the page ==");
  await admin.goto(`${BASE}/dashboard/allocation`, { waitUntil: "networkidle0" });
  await admin.waitForSelector(".al-pair");
  check("it says how much data there is", /\d+ trains?/.test(await admin.evaluate(() => document.querySelector(".al-data")?.innerText)));
  check("and lists every allocated pair to begin with", /^Everything:/.test(await summary(admin)));
  check("with the upload buttons for whoever manages it", await admin.evaluate(() => document.querySelectorAll("input[data-upload]").length === 3));
  const top = await admin.evaluate(() => document.querySelector(".al-latest")?.innerText || "");
  check("and how current it is: routes and census, each with when they came in, and when the railway was checked",
    /Routes[\s\S]*uploaded/i.test(top) && /Census[\s\S]*railway checked[\s\S]*uploaded/i.test(top) && /Counts/i.test(top), top);
  check("the results say when the railway was checked for them", /railway checked/.test(await summary(admin)));
  const quiet = await admin.evaluate(() => {
    const cards = [...document.querySelectorAll(".al-pair")];
    const zeros = [...document.querySelectorAll(".al-pair .al-class")].filter((c) => /^\S+\s+0 seats$/.test(c.innerText.trim()));
    return {
      repeated: cards.filter((el) => /Checked \d|updated \d/.test(el.innerText)).length,
      zeros: zeros.length,
      amber: zeros.filter((c) => c.classList.contains("is-zero")).length,
    };
  });
  check("and the cards do not each say it again: no 'Checked …' or 'updated …' on every one", quiet.repeated === 0, JSON.stringify(quiet));
  check("a class with 0 seats is amber, as in the grid", quiet.amber === quiet.zeros, JSON.stringify(quiet));
  await admin.evaluate(() => {
    document.querySelector(".al-history").open = true;
  });
  const history = await waitFor(admin, () => {
    const t = document.querySelector(".al-history")?.innerText || "";
    return /Loading/.test(t) ? null : t;
  });
  check("the upload history opens, listing what was applied — or saying nothing yet",
    /No file has been applied|uploaded|Census|Train routes|Seat counts/.test(history || ""), history || "");

  console.log("\n== from and to ==");
  await pick(admin, "al-from", label(first.from));
  await pick(admin, "al-to", label(first.to));
  const pairLine = await summary(admin);
  check("a journey: the summary names it", pairLine.startsWith(`${label(first.from)} to ${label(first.to)}`), pairLine);
  check("and the trains with seats on it are listed", await admin.evaluate((n) =>
    [...document.querySelectorAll(".al-train strong")].some((s) => s.innerText === String(n)), train.number));
  await admin.click("label[for=al-all]");
  const allLine = await waitFor(admin, () => {
    const t = document.querySelector(".al-summary__line")?.innerText || "";
    return /not checked/.test(t) ? t : null;
  });
  check("everything shown: allocated, not allocated and not checked counted", Boolean(allLine), allLine || "");
  await admin.click("label[for=al-all]");
  await clickText(admin, "button", "^Clear filters$");
  await sleep(800);
  check("cleared, back to everything", /^Everything:/.test(await summary(admin)));

  console.log("\n== one train ==");
  await pick(admin, "al-train", `${train.number} · ${train.name}`);
  check("the train alone: its pairs", (await summary(admin)).startsWith(`${train.name} (${train.number})`), await summary(admin));
  await clickText(admin, ".al-view .p-button", "Grid");
  await admin.waitForSelector(".al-grid");
  const cells = await admin.evaluate(() => ({
    all: document.querySelectorAll(".al-grid .al-cell").length,
    allocated: document.querySelectorAll(".al-grid .al-cell.is-allocated").length,
  }));
  check("as a grid, every pair of its route, the allocated ones marked", cells.all > 0 && cells.allocated > 0, JSON.stringify(cells));
  // The pair worked with from here on: the first allocated cell, by its stations.
  const target = await admin.evaluate(() => {
    const c = document.querySelector(".al-grid .al-cell.is-allocated");
    return [c.dataset.from, c.dataset.to];
  });
  const cellEl = async () =>
    (
      await admin.evaluateHandle(
        ([f, t]) => [...document.querySelectorAll(".al-grid .al-cell")].find((c) => c.dataset.from === f && c.dataset.to === t),
        target
      )
    ).asElement();
  const cellText = async () => (await (await cellEl()).evaluate((c) => c.innerText.trim()));
  const pinnedText = () => admin.evaluate(() => document.querySelector(".al-card.is-pinned")?.innerText || "");

  console.log("\n== a cell's card ==");
  await (await cellEl()).hover();
  const hoverCard = await waitFor(admin, () => document.querySelector(".al-card.is-hover")?.innerText, null, 1500);
  check("hovering shows its card at once: the pair, each class and its count",
    Boolean(hoverCard) && /seats|count not available/.test(hoverCard) && /Click to keep it open/.test(hoverCard), hoverCard || "");
  await admin.mouse.move(2, 2);
  check("moving away takes it away", Boolean(await waitFor(admin, () => !document.querySelector(".al-card"), null, 1500)));
  await (await cellEl()).click();
  await admin.waitForSelector(".al-card.is-pinned");
  await admin.mouse.move(2, 2);
  await sleep(300);
  check("clicking keeps it open, wherever the pointer goes", Boolean(await admin.$(".al-card.is-pinned")));
  check("beside the cell, on the screen", await admin.evaluate(() => {
    const r = document.querySelector(".al-card.is-pinned").getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  }));
  check("with Edit, for whoever manages the data", /\bEdit\b/.test(await pinnedText()));
  await admin.screenshot({ path: path.join(OUT, "allocation-1-grid.png"), fullPage: true });
  await admin.keyboard.press("Escape");
  check("Escape closes it", Boolean(await waitFor(admin, () => !document.querySelector(".al-card.is-pinned"), null, 1500)));
  await (await cellEl()).click();
  await admin.waitForSelector(".al-card.is-pinned");
  await admin.click(".al-card__close");
  check("so does its ×", Boolean(await waitFor(admin, () => !document.querySelector(".al-card.is-pinned"), null, 1500)));
  await (await cellEl()).click();
  await admin.waitForSelector(".al-card.is-pinned");
  await admin.click(".page-title");
  check("and a click anywhere else", Boolean(await waitFor(admin, () => !document.querySelector(".al-card.is-pinned"), null, 1500)));

  console.log("\n== a count typed in, and taken out ==");
  const before = (await api(token, `/allocation?train=${train.number}&pageSize=1000`)).items;
  const openEdit = async () => {
    if (!(await admin.$(".al-card.is-pinned"))) {
      await (await cellEl()).click();
      await admin.waitForSelector(".al-card.is-pinned");
    }
    await clickText(admin, ".al-card.is-pinned button", "^(Edit|Set)$");
    await admin.waitForSelector(".p-dialog .al-edit");
  };
  await openEdit();
  const input = await admin.$(".p-dialog .al-edit__row .p-inputnumber-input");
  await input.click({ clickCount: 3 });
  await input.type("37");
  await saveButton(admin);
  await waitFor(admin, () => !document.querySelector(".p-dialog .al-edit"));
  const pairNow = (await api(token, `/allocation?train=${train.number}&pageSize=1000`)).items.find(
    (i) => i.from === target[0] && i.to === target[1]
  );
  check("saved: 37 seats, saying when", pairNow?.classes.some((c) => c.seats === 37 && c.seatsUpdatedAt), JSON.stringify(pairNow?.classes));
  const fresh = await waitFor(admin, () => {
    const t = document.querySelector(".al-card.is-pinned")?.innerText || "";
    return /37 seats/.test(t) ? t : null;
  });
  check("the card stays open and shows the new count, with the day it was set", /37 seats · \d{1,2} [A-Z][a-z]{2}/.test(fresh || ""), fresh || "");
  const countsLine = await waitFor(admin, () => {
    const t = document.querySelector(".al-summary__line")?.innerText || "";
    return /counts updated/.test(t) ? t : null;
  });
  check("and the summary says, once, when the counts shown were set", /counts updated \d{1,2}(–\d{1,2})? [A-Z][a-z]{2}/.test(countsLine || ""), countsLine || "");

  // A number in a cell is seats, never a number of classes.
  const counted = pairNow.classes.find((c) => c.seats === 37);
  const others = pairNow.classes.filter((c) => c.code !== counted.code);
  const expected = others.some((c) => c.seats === null) ? "37+" : "37";
  check(`the cell shows its seats: ${expected}, not how many classes`, (await cellText()) === expected, await cellText());
  await pick(admin, "al-class", counted.code);
  await waitFor(admin, () => Boolean(document.querySelector(".al-legend__class")));
  check(`with ${counted.code} chosen, that class's seats`, (await cellText()) === "37", await cellText());
  check("and the legend says which class", (await admin.evaluate(() => document.querySelector(".al-legend")?.innerText || "")).includes(counted.code));
  if (others.length) {
    await pick(admin, "al-class", others[0].code);
    const other = await cellText();
    check(`with ${others[0].code} chosen, its count — not known here, so ✓`, other === (others[0].seats === null ? "✓" : String(others[0].seats)), other);
  }
  await admin.evaluate(() => document.querySelector("#al-class")?.closest(".p-dropdown")?.querySelector(".p-dropdown-clear-icon")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await waitFor(admin, () => !document.querySelector(".al-legend__class"));
  await openEdit();
  const again = await admin.$(".p-dialog .al-edit__row .p-inputnumber-input");
  await again.click({ clickCount: 3 });
  await admin.keyboard.press("Backspace");
  await admin.keyboard.press("Tab");
  await saveButton(admin);
  await waitFor(admin, () => !document.querySelector(".p-dialog .al-edit"));
  const after = (await api(token, `/allocation?train=${train.number}&pageSize=1000`)).items;
  const strip = (list) =>
    JSON.stringify(list.map((i) => [i.from, i.to, i.status, i.source, i.checkedAt, i.classes.map((c) => [c.code, c.seats])]));
  check("emptied: back to not known — the pair as it was, still the census's", strip(after) === strip(before),
    JSON.stringify(after.find((i) => i.from === target[0] && i.to === target[1])));
  await admin.keyboard.press("Escape");

  console.log("\n== files ==");
  const sheet = await api(token, `/allocation/counts.csv?train=${train.number}`);
  const file = path.join(os.tmpdir(), `seat-counts-${Date.now()}.csv`);
  fs.writeFileSync(file, sheet);
  const counts = await admin.$("input[data-upload=counts]");
  await counts.uploadFile(file);
  await admin.waitForSelector(".p-dialog .al-preview");
  const preview = await admin.evaluate(() => document.querySelector(".p-dialog .al-preview").innerText);
  check("the counts sheet, read back: every line as it is, nothing to apply",
    /as they are/.test(preview) && /nothing in this file to apply/.test(preview), preview);
  await admin.screenshot({ path: path.join(OUT, "allocation-2-preview.png") });
  await clickText(admin, ".p-dialog .p-button", "^Cancel$");
  fs.unlinkSync(file);

  const wrong = path.join(os.tmpdir(), `not-a-census-${Date.now()}.csv`);
  fs.writeFileSync(wrong, "name,age\nx,1\n");
  const census = await admin.$("input[data-upload=census]");
  await census.uploadFile(wrong);
  const toast = await waitFor(admin, () => {
    const t = document.querySelector(".p-toast")?.innerText || "";
    return /census/i.test(t) ? t : null;
  });
  check("a file that is not a census is refused, saying so", /not a census file/.test(toast || ""), toast || "");
  fs.unlinkSync(wrong);

  console.log("\n== the phone ==");
  await admin.setViewport({ width: 390, height: 844 });
  await admin.goto(`${BASE}/dashboard/allocation`, { waitUntil: "networkidle0" });
  await admin.waitForSelector(".al-pair");
  check("the list fits a phone", (await admin.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await pick(admin, "al-train", `${train.number} · ${train.name}`);
  await clickText(admin, ".al-view .p-button", "Grid");
  await admin.waitForSelector(".al-grid");
  check("and the grid scrolls inside itself, not the page",
    (await admin.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await admin.mouse.move(1, 1);
  await admin.evaluate(() => document.querySelector(".al-grid .al-cell.is-allocated").scrollIntoView({ block: "center", inline: "center" }));
  await admin.evaluate(() => document.querySelector(".al-grid .al-cell.is-allocated").click());
  await admin.waitForSelector(".al-card.is-pinned");
  check("a tap keeps a cell's card open, on the screen", await admin.evaluate(() => {
    const r = document.querySelector(".al-card.is-pinned").getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
  }));
  await admin.screenshot({ path: path.join(OUT, "allocation-3-phone-card.png") });

  console.log("\n== a passenger ==");
  const passenger = await signIn(browser, "unittest-user@example.com");
  check("has no Seat Allocation in the menu", !/Seat Allocation/.test(await passenger.evaluate(() => document.querySelector(".dash-nav")?.innerText || "")));
  await passenger.goto(`${BASE}/dashboard/allocation`, { waitUntil: "networkidle0" });
  check("and its address says they cannot see it", /cannot see the seat allocation/.test(await passenger.evaluate(() => document.body.innerText)));

  check("no browser errors along the way", [...admin.errors, ...passenger.errors].length === 0, [...admin.errors, ...passenger.errors].join(" | "));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
