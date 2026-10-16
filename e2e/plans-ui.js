// Changing an approved seat plan, the way a planner and an approver would:
// Edit opens an editable copy while the plan stays in use, the copy is
// submitted and approved back into the plan, and a second copy is thrown away.
// Then the plan's page at phone width.
//
//   node plans-ui.js
//
// It works on EKOTA EXPRESS (705), coach GHA, and changes nothing in it: the
// copy it approves is the plan as it was. Any copy an earlier run left open is
// thrown away first.
const config = require("./config");
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = config.CHROME;
const BASE = config.WEB;
const OUT = config.SHOTS;

const PLANNER = "unittest-planner@example.com";
const APPROVER = "unittest-super1@example.com";
const PASSWORD = "UnitTest123!";
const TRAIN = "EKOTA EXPRESS (705)";
const COACH = "GHA";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function waitFor(page, fn, arg, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    await sleep(300);
  }
  return null;
}

const text = (page) => page.evaluate(() => document.body.innerText);
const clickButton = (page, pattern) =>
  page.evaluate((source) => {
    const button = [...document.querySelectorAll("button")].find((b) => new RegExp(source).test(b.textContent.trim()) && !b.disabled);
    if (button) button.click();
    return Boolean(button);
  }, pattern);

/** The plans list's row for the plan, as text, with its Edit button clicked when asked. */
const planRow = (page, { click = false } = {}) =>
  page.evaluate(
    (train, coach, click) => {
      const row = [...document.querySelectorAll(".p-datatable tbody tr")].find((r) => {
        const cells = [...r.querySelectorAll("td")].map((td) => td.innerText.trim());
        return cells[0] === train && cells[1] === coach;
      });
      if (row && click) row.querySelector('button[aria-label^="Edit"], button[aria-label^="Open the changes"]').click();
      return row ? row.innerText.replace(/\s+/g, " ") : null;
    },
    TRAIN,
    COACH,
    click
  );

(async () => {
  const approverToken = (await api("POST", "/auth/login", { body: { email: APPROVER, password: PASSWORD } })).body.accessToken;
  const list = (await api("GET", "/plans", { token: approverToken })).body.plans;
  const plan = list.find((p) => p.trainName?.name === TRAIN && p.coachNo === COACH && !p.revisionOfId);
  if (!plan) throw new Error(`No plan for ${TRAIN} coach ${COACH} — load the railway data first`);
  for (const left of list.filter((p) => p.revisionOfId === plan.id)) await api("DELETE", `/plans/${left.id}`, { token: approverToken });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const laptop = { width: 1440, height: 900 };

  console.log(`== a planner edits an approved plan: ${TRAIN}, coach ${COACH} ==`);
  const planner = await signedIn(browser, PLANNER, laptop);
  await planner.page.goto(`${BASE}/dashboard/plans`, { waitUntil: "networkidle0" });
  await planner.page.type('input[aria-label="Search seat plans"]', `${TRAIN.split(" (")[0]} ${COACH}`);
  const listed = await waitFor(planner.page, (args) => {
    const row = [...document.querySelectorAll(".p-datatable tbody tr")].find((r) => {
      const cells = [...r.querySelectorAll("td")].map((td) => td.innerText.trim());
      return cells[0] === args[0] && cells[1] === args[1];
    });
    return row ? row.innerText : null;
  }, [TRAIN, COACH]);
  check("the approved plan offers Edit", /Approved/.test(listed || "") && Boolean(await planner.page.$('button[aria-label^="Edit"]')), listed);
  await planRow(planner.page, { click: true });
  await planner.page.waitForFunction(() => /\/dashboard\/plans\/\d+\/edit$/.test(location.pathname), { timeout: 15000 });
  const copyId = Number(planner.page.url().match(/plans\/(\d+)\/edit/)[1]);
  check("which opens an editable copy, not the plan", copyId !== plan.id, planner.page.url());
  await waitFor(planner.page, () => /Change Seat Plan/.test(document.body.innerText));
  check("saying the plan keeps being used meanwhile", /keeps being used as it is until they are approved/.test(await text(planner.page)));
  await clickButton(planner.page, "^Save draft$");
  await waitFor(planner.page, () => /Saved as draft/.test(document.body.innerText));
  await planner.page.screenshot({ path: path.join(OUT, "plans-1-copy.png") });

  await planner.page.goto(`${BASE}/dashboard/plans`, { waitUntil: "networkidle0" });
  await planner.page.type('input[aria-label="Search seat plans"]', `${TRAIN.split(" (")[0]} ${COACH}`);
  await waitFor(planner.page, (args) =>
    [...document.querySelectorAll(".p-datatable tbody tr")].some((r) => r.innerText.includes(args[0]) && r.innerText.includes(args[1])), [TRAIN, COACH]);
  const row = (await planRow(planner.page)) || "";
  check("the list shows one row, still approved, with changes in draft", /Approved/.test(row) && /Changes in draft/.test(row), row);
  check("the copy is not a second row",
    (await planner.page.$$eval(".p-datatable tbody tr", (rows, args) => rows.filter((r) => {
      const cells = [...r.querySelectorAll("td")].map((td) => td.innerText.trim());
      return cells[0] === args[0] && cells[1] === args[1];
    }).length, [TRAIN, COACH])) === 1);

  await planner.page.goto(`${BASE}/dashboard/plans/${plan.id}`, { waitUntil: "networkidle0" });
  check("the plan's page says so, with a way to the changes",
    /Changes in draft/.test(await text(planner.page)) && /Open the changes/.test(await text(planner.page)));
  await planner.page.goto(`${BASE}/dashboard/plans/${copyId}/edit`, { waitUntil: "networkidle0" });
  await waitFor(planner.page, () => /Change Seat Plan/.test(document.body.innerText));
  await clickButton(planner.page, "^Save & submit$");
  await planner.page.waitForFunction(() => location.pathname === "/dashboard/plans", { timeout: 15000 });
  check("submitted, the copy waits for approval",
    (await api("GET", `/plans/${copyId}`, { token: approverToken })).body.plan?.status === "pending");

  console.log("\n== an approver approves the changes ==");
  const approver = await signedIn(browser, APPROVER, laptop);
  await approver.page.goto(`${BASE}/dashboard/approvals`, { waitUntil: "networkidle0" });
  const queued = await waitFor(approver.page, () =>
    [...document.querySelectorAll(".p-datatable tbody tr")].find((r) => /Changes to an approved plan/.test(r.innerText))?.innerText);
  check("the queue marks them as changes to an approved plan", Boolean(queued) && queued.includes(COACH), queued);
  await approver.page.screenshot({ path: path.join(OUT, "plans-2-approvals.png") });
  await approver.page.evaluate(() => {
    const row = [...document.querySelectorAll(".p-datatable tbody tr")].find((r) => /Changes to an approved plan/.test(r.innerText));
    row.querySelector('button[aria-label="Approve"]').click();
  });
  await approver.page.waitForSelector(".p-confirm-dialog");
  await approver.page.evaluate(() => document.querySelector(".p-confirm-dialog-accept").click());
  check("approving them empties the queue of them",
    Boolean(await waitFor(approver.page, () => ![...document.querySelectorAll(".p-datatable tbody tr")].some((r) => /Changes to an approved plan/.test(r.innerText)))));
  const after = (await api("GET", `/plans/${plan.id}`, { token: approverToken })).body.plan;
  check("the plan has them, under its own id, and no copy is left",
    after.status === "approved" && !after.revision && (await api("GET", `/plans/${copyId}`, { token: approverToken })).status === 404);

  console.log("\n== changes thrown away ==");
  await planner.page.goto(`${BASE}/dashboard/plans/${plan.id}`, { waitUntil: "networkidle0" });
  await clickButton(planner.page, "^Edit$");
  await planner.page.waitForFunction(() => /\/dashboard\/plans\/\d+\/edit$/.test(location.pathname), { timeout: 15000 });
  await waitFor(planner.page, () => /Change Seat Plan/.test(document.body.innerText));
  await clickButton(planner.page, "^Throw changes away$");
  await planner.page.waitForFunction((id) => location.pathname === `/dashboard/plans/${id}`, { timeout: 15000 }, plan.id);
  check("a copy can be thrown away, back on the plan, untouched",
    !(await api("GET", `/plans/${plan.id}`, { token: approverToken })).body.plan.revision);

  console.log("\n== the phone ==");
  await api("POST", `/plans/${plan.id}/revise`, { token: approverToken });
  const phone = await signedIn(browser, PLANNER, { width: 390, height: 844 });
  await phone.page.goto(`${BASE}/dashboard/plans/${plan.id}`, { waitUntil: "networkidle0" });
  await waitFor(phone.page, () => document.querySelector(".plan-revision-note"));
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("the plan's page, with its note, fits a phone", overflow <= 0, `${overflow}px`);
  await phone.page.screenshot({ path: path.join(OUT, "plans-3-phone.png"), fullPage: true });
  const open = (await api("GET", `/plans/${plan.id}`, { token: approverToken })).body.plan.revision;
  if (open) await api("DELETE", `/plans/${open.id}`, { token: approverToken });

  const errors = [...planner.errors, ...approver.errors, ...phone.errors];
  check("no browser errors along the way", errors.length === 0, errors.join(" | "));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
