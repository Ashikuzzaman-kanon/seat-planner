// Open every dialog and menu the route audit cannot reach, at both widths,
// screenshot it, check it for the same problems, and close it without
// submitting anything.
//
//   node dialogs.js <label> [desk|phone]
const config = require("./config");
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const CHROME = config.CHROME;
const BASE = config.WEB;
const OUT = config.SHOTS;
const [label = "dlg", only] = process.argv.slice(2);
const VIEWPORTS = [
  { name: "desk", width: 1440, height: 900 },
  { name: "phone", width: 400, height: 860, isMobile: true, hasTouch: true },
].filter((v) => !only || v.name === only);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickText(page, selector, text) {
  for (const h of await page.$$(selector)) {
    const ok = await page.evaluate(
      (el, t) => el.offsetParent !== null && el.textContent.trim().includes(t) && !el.disabled,
      h,
      text
    );
    if (ok) {
      await h.click();
      return true;
    }
  }
  return false;
}
async function clickFirst(page, selector) {
  for (const h of await page.$$(selector)) {
    const ok = await page.evaluate((el) => el.offsetParent !== null && !el.disabled, h);
    if (ok) {
      await h.click();
      return true;
    }
  }
  return false;
}

// Each case: where to go, how to open it, what to wait for.
const CASES = [
  { name: "users-roles", route: "/dashboard/users", open: (p) => clickText(p, ".p-button", "Edit roles"), expect: ".p-dialog" },
  { name: "users-standing", route: "/dashboard/users", open: (p) => clickText(p, ".p-button", "Standing"), expect: ".p-dialog" },
  { name: "roles-new", route: "/dashboard/roles", open: (p) => clickText(p, ".p-button", "New role"), expect: ".p-dialog" },
  { name: "roles-edit", route: "/dashboard/roles", open: (p) => clickFirst(p, '.p-datatable-tbody .p-button[aria-label="Edit role"]'), expect: ".p-dialog" },
  { name: "station-add", route: "/dashboard/network", open: (p) => clickText(p, ".p-button", "Add station"), expect: ".p-dialog" },
  { name: "station-edit", route: "/dashboard/network", open: (p) => clickFirst(p, '.p-button[aria-label="Edit station"]'), expect: ".p-dialog" },
  {
    name: "trains",
    route: "/dashboard/network",
    open: async (p) => {
      await clickText(p, ".p-tabview-nav-link", "Trains");
      await wait(800);
      return true;
    },
    expect: ".p-datatable",
  },
  {
    name: "train-schedule",
    route: "/dashboard/network",
    open: async (p) => {
      await clickText(p, ".p-tabview-nav-link", "Trains");
      await wait(800);
      return clickText(p, ".p-button", "Days");
    },
    expect: ".p-dialog",
  },
  {
    name: "train-coaches",
    route: "/dashboard/network",
    open: async (p) => {
      await clickText(p, ".p-tabview-nav-link", "Trains");
      await wait(800);
      return clickText(p, ".p-button", "Coaches");
    },
    expect: ".p-dialog",
  },
  {
    name: "train-route",
    route: "/dashboard/network",
    open: async (p) => {
      await clickText(p, ".p-tabview-nav-link", "Trains");
      await wait(800);
      return clickText(p, ".p-button", "Route");
    },
    expect: ".p-dialog, .route-summary",
  },
  {
    name: "fares",
    route: "/dashboard/network",
    open: async (p) => {
      await clickText(p, ".p-tabview-nav-link", "Fares");
      await wait(800);
      return true;
    },
    expect: ".p-datatable",
  },
  {
    name: "fare-prices",
    route: "/dashboard/network",
    open: async (p) => {
      await clickText(p, ".p-tabview-nav-link", "Fares");
      await wait(800);
      return clickText(p, ".p-button", "Prices");
    },
    expect: ".p-dialog",
  },
  {
    name: "attributes",
    route: "/dashboard/network",
    open: async (p) => {
      await clickText(p, ".p-tabview-nav-link", "Seat Attributes");
      await wait(800);
      return true;
    },
    expect: ".p-datatable",
  },
  {
    name: "classes",
    route: "/dashboard/reference",
    open: async (p) => {
      await clickText(p, ".p-tabview-nav-link", "Coach Classes");
      await wait(800);
      return true;
    },
    expect: ".p-datatable",
  },
  { name: "departure-cancel", route: "/dashboard/departures", open: (p) => clickFirst(p, '.p-button[aria-label="Cancel departure — refunds everyone aboard"]'), expect: ".p-dialog" },
  { name: "departure-coaches", route: "/dashboard/departures", open: (p) => clickFirst(p, '.p-button[aria-label="Coaches — add, cancel or reinstate one"]'), expect: ".coach-ops__row" },
  {
    name: "coach-cancel",
    route: "/dashboard/departures",
    open: async (p) => {
      await clickFirst(p, '.p-button[aria-label="Coaches — add, cancel or reinstate one"]');
      await p.waitForSelector(".coach-ops__row", { timeout: 10000 }).catch(() => {});
      return clickText(p, ".coach-ops__actions .p-button", "Cancel");
    },
    expect: "#cancel-reason",
  },
  { name: "ticket-qr", route: "/dashboard/bookings", open: (p) => clickFirst(p, '.ticket-actions .p-button[aria-label^="Show the QR"]'), expect: ".p-dialog" },
  { name: "ticket-standing", route: "/dashboard/bookings", open: (p) => clickFirst(p, '.ticket-actions .p-button[aria-label^="Travel further"]'), expect: ".p-dialog" },
  { name: "ticket-transfer", route: "/dashboard/bookings", open: (p) => clickFirst(p, '.ticket-actions .p-button[aria-label^="Transfer"]'), expect: ".p-dialog" },
  { name: "ticket-return", route: "/dashboard/bookings", open: (p) => clickFirst(p, '.ticket-actions .p-button[aria-label^="Return"]'), expect: ".p-dialog" },
  { name: "wallet-topup", route: "/dashboard/wallet", open: (p) => clickText(p, ".p-button", "Add"), expect: ".p-dialog" },
  { name: "approval-reject", route: "/dashboard/approvals", open: (p) => clickFirst(p, '.p-button[aria-label="Reject"]'), expect: ".p-dialog" },
  { name: "plan-delete", route: "/dashboard/plans", open: (p) => clickFirst(p, '.p-button[aria-label="Delete"]'), expect: ".p-dialog" },
  { name: "report-standing", route: "/dashboard/reports", open: (p) => clickText(p, ".p-button", "See their standing"), expect: ".p-dialog" },
  { name: "account-menu", route: "/dashboard", open: (p) => clickFirst(p, ".dash-account"), expect: ".acct-menu" },
  { name: "drawer", route: "/dashboard", phoneOnly: true, open: (p) => clickFirst(p, ".dash-burger"), expect: ".dash-sidebar" },
];

async function inspect(page) {
  return page.evaluate(() => {
    const problems = [];
    // A closed drawer is parked off screen on purpose; only an open one counts.
    for (const el of document.querySelectorAll(".p-dialog, .p-menu, .menu-open .dash-sidebar")) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (r.right > window.innerWidth + 1 || r.left < -1) problems.push(`${el.className.split(" ")[0]} off screen (${Math.round(r.left)}..${Math.round(r.right)})`);
    }
    for (const el of document.querySelectorAll(".p-dialog *")) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > window.innerWidth + 1) {
        let held = false;
        for (let a = el.parentElement; a && !a.classList.contains("p-dialog"); a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX;
          if (ox !== "visible" && ox !== "clip") { held = true; break; }
        }
        if (!held) { problems.push(`clipped in dialog: ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`); break; }
      }
    }
    const bare = [];
    for (const el of document.querySelectorAll('.p-dialog button, .p-dialog [role="button"]')) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (/[\p{L}\p{N}]/u.test((el.innerText || "").trim())) continue;
      if (el.getAttribute("title")) continue;
      if (el.classList.contains("p-button") && el.getAttribute("aria-label")) continue;
      bare.push(String(el.className).split(" ").slice(0, 2).join("."));
    }
    if (bare.length) problems.push(`no hover text: ${[...new Set(bare)].slice(0, 3).join(", ")}`);
    return problems;
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
  const report = [];
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport(vp);
    let errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
    await page.type("#email", "unittest-super1@example.com");
    await page.type("input[type=password]", "UnitTest123!");
    await Promise.all([page.click('button[type="submit"]'), page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {})]);

    for (const c of CASES) {
      if (c.phoneOnly && vp.name !== "phone") continue;
      errors = [];
      await page.goto(`${BASE}${c.route}`, { waitUntil: "networkidle0" });
      await wait(500);
      const opened = await c.open(page);
      if (!opened) {
        report.push({ vp: vp.name, name: c.name, problems: ["could not open (no enabled control)"] });
        continue;
      }
      await page.waitForSelector(c.expect, { visible: true, timeout: 8000 }).catch(() => {});
      await wait(600);
      const problems = await inspect(page);
      await page.screenshot({ path: path.join(OUT, `${label}-${vp.name}-${c.name}.png`) });
      report.push({ vp: vp.name, name: c.name, problems: [...problems, ...errors.map((e) => `error: ${e}`)] });
      await page.keyboard.press("Escape");
      await wait(300);
    }
    await page.close();
  }
  await browser.close();
  let bad = 0;
  for (const r of report) {
    if (!r.problems.length) continue;
    bad++;
    console.log(`${r.vp.padEnd(5)} ${r.name}`);
    for (const p of r.problems) console.log(`        ${p}`);
  }
  console.log(`\n${report.length - bad}/${report.length} dialog views clean`);
})().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
