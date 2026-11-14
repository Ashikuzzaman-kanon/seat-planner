// Seat plan templates and clashes, in a real browser: saving into a train and
// coach another plan has opens the choices — its coach number changed, it
// moved to templates, an approved one replaced through approval, mine kept as
// a template — each saving mine after; one a train uses cannot be moved; the
// Templates list, several plans moved at once, a template made into a plan,
// one moved back; a template's own page. Removes what it made.
//
// Needs the API and the web app running locally with the development data.
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

async function waitFor(page, fn, arg, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    await sleep(200);
  }
  return null;
}

async function api(token, method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json().catch(() => null);
}

const clickText = (page, selector, text) =>
  page.evaluate((s, t) => {
    const b = [...document.querySelectorAll(s)].find((x) => x.innerText.trim() === t && !x.disabled);
    if (b) b.click();
    return Boolean(b);
  }, selector, text);
const text = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
const dialogText = (page) => page.evaluate(() => (document.querySelector(".pc")?.innerText || "").replace(/\s+/g, " "));

/** Open a plan in the editor, give it a coach number, and save it as a draft. */
async function saveWithCoach(page, id, coachNo) {
  await page.goto(`${BASE}/dashboard/plans/${id}/edit`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".pe-toolbar");
  const input = await page.$('input[placeholder="e.g. KHA"]');
  await input.click({ clickCount: 3 });
  await input.type(coachNo);
  await clickText(page, ".page-head button", "Save draft");
  return waitFor(page, () => Boolean(document.querySelector(".pc")) || /Saved as draft/.test(document.body.innerText));
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: config.CHROME, headless: "new", args: ["--no-sandbox"] });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", "unittest-super1@example.com");
  await page.type("input[type=password]", PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);
  const S = await page.evaluate(() => localStorage.getItem("sp_access_token"));

  // An approved plan in use (the development data's trains use theirs), and plans of our own on its train.
  const P0 = (await api(S, "GET", "/plans?status=approved")).plans.find((p) => p.trainNameId && p.coachNo);
  const base = { trainNameId: P0.trainNameId, coachTypeId: P0.coachTypeId, coachClassId: P0.coachClassId };
  const layout = { rows: [{ id: "r1", cells: [{ kind: "seat", id: "a", number: "1" }, { kind: "seat", id: "b", number: "2" }] }] };
  const make = async (coachNo, extra = {}) => (await api(S, "POST", "/plans", { ...base, coachNo, layout, ...extra })).plan;
  const made = [];
  const X = await make("ZZT-X");
  const R = await make("ZZT-R");
  await api(S, "POST", `/plans/${R.id}/submit`);
  const M = await make("ZZT-M");
  const N = await make("ZZT-N");
  const Y = await make("ZZT-Y");
  made.push(X.id, R.id, M.id, N.id, Y.id);
  const plan = async (id) => (await api(S, "GET", `/plans/${id}`)).plan;

  try {
    console.log("== a clash: their coach number changed ==");
    await saveWithCoach(page, M.id, "ZZT-X");
    const first = await dialogText(page);
    check("saving into another plan's coach opens the choices", /already has a seat plan for coach ZZT-X/.test(first) && /Draft/.test(first), first);
    check("all four of them, for a draft", /Move it to templates/.test(first) && /another coach number/.test(first) && /as a template/.test(first) &&
      !/Replace it with mine/.test(first));
    await page.screenshot({ path: path.join(OUT, "plan-templates-1-clash.png") });
    await page.type('input[aria-label="Its new coach number"]', "ZZT-X2");
    await clickText(page, ".pc button", "Change it");
    await waitFor(page, () => /Saved as draft/.test(document.body.innerText));
    check("theirs renumbered, mine saved", (await plan(X.id)).coachNo === "ZZT-X2" && (await plan(M.id)).coachNo === "ZZT-X");

    console.log("\n== a clash: theirs moved to templates ==");
    await saveWithCoach(page, M.id, "ZZT-X2");
    await clickText(page, ".pc button", "Move it");
    await waitFor(page, () => /Saved as draft/.test(document.body.innerText));
    check("theirs a template, mine in its coach", (await plan(X.id)).isTemplate === true && (await plan(M.id)).coachNo === "ZZT-X2");

    console.log("\n== a clash with an approved plan: replaced through approval ==");
    await saveWithCoach(page, M.id, "ZZT-R");
    const approved = await dialogText(page);
    check("an approved one can be replaced", /Approved/.test(approved) && /Replace it with mine/.test(approved), approved);
    await clickText(page, ".pc button", "Replace it");
    await page.waitForFunction(() => /Change Seat Plan/.test(document.body.innerText), { timeout: 15000 });
    const copy = await plan(M.id);
    const kept = (await api(S, "GET", "/plans?kind=templates")).plans.filter((p) => p.coachNo === "ZZT-R");
    made.push(...kept.map((p) => p.id));
    check("mine is its new layout, waiting for approval", copy.revisionOfId === R.id && (await plan(R.id)).status === "approved");
    check("and the layout in use is kept as a template", kept.length >= 1);

    console.log("\n== a clash with a plan a train uses ==");
    await saveWithCoach(page, N.id, P0.coachNo);
    const inUse = await dialogText(page);
    check("it says which train, and it cannot be moved", /among the coaches of/.test(inUse) &&
      (await page.evaluate(() => [...document.querySelectorAll(".pc button")].find((b) => b.innerText.trim() === "Move it")?.disabled === true)), inUse);
    await clickText(page, ".pc button", "Save as template");
    await page.waitForFunction(() => /Edit Template/.test(document.body.innerText), { timeout: 15000 });
    check("mine kept as a template instead", (await plan(N.id)).isTemplate === true && /Save template/.test(await text(page)));

    console.log("\n== the lists ==");
    await page.goto(`${BASE}/dashboard/plans`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".p-datatable tbody tr");
    await sleep(800);
    await clickText(page, ".plans-toolbar .p-selectbutton .p-button", "Templates");
    await waitFor(page, () => /never used by trains/.test(document.body.innerText) && !document.querySelector(".p-datatable-loading-overlay"));
    const listed = await text(page);
    await page.screenshot({ path: path.join(OUT, "plan-templates-2-list.png") });
    // N kept the coach it clashed in; X its new number; the layout R had, its own.
    check("the Templates list has them", [P0.coachNo, "ZZT-X2", "ZZT-R"].every((c) => listed.includes(` ${c} `)) && /New template/.test(listed),
      listed.slice(listed.indexOf("Seat Plans Browse"), listed.indexOf("Seat Plans Browse") + 500));
    await page.type('input[aria-label="Search seat plans"]', "ZZT-X2");
    await sleep(300);
    await page.click('button[aria-label="Move back to plans"]');
    await waitFor(page, () => /Not moved back|Back among the plans/.test(document.body.innerText));
    check("a template moved back among the plans, its coach free again", /Back among the plans/.test(await text(page)) && (await plan(X.id)).isTemplate === false);
    await page.goto(`${BASE}/dashboard/plans`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".p-datatable tbody tr");
    await sleep(800);
    await clickText(page, ".plans-toolbar .p-selectbutton .p-button", "Templates");
    await waitFor(page, () => /never used by trains/.test(document.body.innerText));
    await page.type('input[aria-label="Search seat plans"]', P0.coachNo);
    await sleep(300);
    await page.evaluate(() => [...document.querySelectorAll('button[aria-label="Move back to plans"]')][0]?.click());
    await waitFor(page, () => /Not moved back|Back among the plans/.test(document.body.innerText));
    check("not while a plan has its coach", /Not moved back/.test(await text(page)) && (await plan(N.id)).isTemplate === true);

    await clickText(page, ".plans-toolbar .p-selectbutton .p-button", "Plans");
    await waitFor(page, () => !/never used by trains/.test(document.body.innerText));
    const search = await page.$('input[aria-label="Search seat plans"]');
    await search.click({ clickCount: 3 });
    await search.type("ZZT-Y");
    await sleep(500);
    await (await page.$(".p-datatable tbody tr .p-selection-column .p-checkbox")).click();
    await sleep(300);
    check("several plans chosen offer to move them", await clickText(page, ".plans-toolbar button", "Move 1 to templates"));
    await page.waitForSelector(".p-confirm-dialog-accept");
    await page.click(".p-confirm-dialog-accept");
    await waitFor(page, () => /moved to templates/.test(document.body.innerText));
    check("moved", (await plan(Y.id)).isTemplate === true);

    await clickText(page, ".plans-toolbar .p-selectbutton .p-button", "Templates");
    await sleep(800);
    await page.click('button[aria-label="Make a plan from it"]');
    await page.waitForFunction(() => /\/dashboard\/plans\/new\?from=\d+/.test(location.href), { timeout: 10000 });
    check("a template made into a new plan", Boolean(await waitFor(page, () => /Template loaded/.test(document.body.innerText))));

    console.log("\n== a template's page ==");
    await page.goto(`${BASE}/dashboard/plans/${N.id}`, { waitUntil: "networkidle0" });
    const own = await text(page);
    check("says it is a template, with what can be done", /Template/.test(own) && /never used by trains/.test(own) && /Make a plan from it/.test(own) &&
      /Move back to plans/.test(own));

    check("no browser errors along the way", page.errors.length === 0, page.errors.join(" | "));
  } finally {
    // The copy before the plan it changes; then the rest.
    for (const id of [M.id, ...made.filter((id) => id !== M.id)]) await api(S, "DELETE", `/plans/${id}`).catch(() => {});
    await browser.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
