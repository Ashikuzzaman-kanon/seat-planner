// Visit every route at desktop and phone width, logged in, and check:
//   - the page renders without a browser error
//   - no element makes the page scroll sideways
//   - every button's colour matches what its classes ask for
//   - screenshots of each, for looking at
//
//   node audit-ui.js <label>
const config = require("./config");
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const CHROME = config.CHROME;
const BASE = config.WEB;
const OUT = config.SHOTS;
const label = process.argv[2] || "audit";

const ROUTES = [
  "/dashboard",
  "/dashboard/book",
  "/dashboard/bookings",
  "/dashboard/wallet",
  "/dashboard/refunds",
  "/dashboard/requests",
  "/dashboard/profile",
  "/dashboard/checker",
  "/dashboard/departures",
  "/dashboard/inventory",
  "/dashboard/reports",
  "/dashboard/network",
  "/dashboard/plans",
  "/dashboard/plans/new",
  "/dashboard/approvals",
  "/dashboard/users",
  "/dashboard/roles",
  "/dashboard/reference",
  "/dashboard/settings",
  "/dashboard/audit",
  "/dashboard/jobs",
  "/dashboard/demo-data",
];
const PUBLIC = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/privacy"];

const VIEWPORTS = [
  { name: "desk", width: 1440, height: 900 },
  { name: "phone", width: 400, height: 860, isMobile: true, hasTouch: true },
];

const BRAND = "rgb(37, 99, 235)";

async function inspect(page) {
  return page.evaluate((BRAND) => {
    const problems = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1) {
      // Name the widest offender, so the fix has somewhere to start.
      let worst = null;
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right > window.innerWidth + 1 && (!worst || r.right > worst.r)) {
          worst = { r: r.right, what: `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")}` };
        }
      }
      problems.push(`page scrolls sideways (${doc.scrollWidth}px > ${window.innerWidth}px), widest: ${worst?.what}`);
    }

    /*
     * Content cut off at the right edge.
     *
     * The body uses `overflow-x: clip` on phones, which stops sideways
     * scrolling — and would also hide an overflow from the check above. So look
     * for visible elements past the edge that no scrolling container of their
     * own is holding. Anything inside a table wrapper or a coach map is meant
     * to scroll, and is skipped.
     */
    const clipped = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.right <= window.innerWidth + 1) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || style.position === "fixed") continue;
      let held = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox !== "visible" && ox !== "clip") { held = true; break; }
        if (getComputedStyle(a).position === "fixed") { held = true; break; }
      }
      if (!held) clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").filter(Boolean).slice(0, 2).join(".")} ends at ${Math.round(r.right)}px`);
    }
    if (clipped.length) problems.push(`cut off at the edge: ${clipped.slice(0, 2).join("; ")}`);

    /*
     * Icon-only controls must say what they do on hover. A PrimeReact Button
     * with an aria-label has its tooltip checked in the source scan
     * (find-icon-buttons.py); anything else needs a title.
     */
    const bare = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"], .p-dropdown-clear-icon, .p-password .p-icon-field > svg')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
      if (el.closest('[aria-hidden="true"]') && !el.matches(".p-dropdown-clear-icon, svg")) continue;
      const text = (el.innerText || "").trim();
      if (/[\p{L}\p{N}]/u.test(text)) continue;
      if (el.getAttribute("title")) continue;
      if (el.classList.contains("p-button") && el.getAttribute("aria-label")) continue;
      const cls = String(el.className?.baseVal ?? el.className).split(" ").filter(Boolean).slice(0, 2).join(".");
      bare.push(`${el.tagName.toLowerCase()}.${cls}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""}`);
    }
    if (bare.length) problems.push(`no hover text: ${[...new Set(bare)].slice(0, 4).join(", ")}`);

    for (const b of document.querySelectorAll(".p-button")) {
      const c = b.className;
      const cs = getComputedStyle(b);
      const bg = cs.backgroundColor;
      const severity = /p-button-(danger|success|warning|secondary|help|info|contrast)/.exec(c)?.[1];
      const variant = /p-button-(text|outlined|link)/.exec(c)?.[1];
      const label = (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 30);
      if (b.closest(".p-selectbutton, .p-inputnumber, .p-paginator")) continue;
      if (severity && !variant && bg === BRAND) {
        problems.push(`"${label}" is ${severity} but painted brand blue`);
      }
      if ((variant === "text" || variant === "link") && bg !== "rgba(0, 0, 0, 0)" && bg === BRAND) {
        problems.push(`"${label}" is a ${variant} button with a solid fill`);
      }
    }
    return problems;
  }, BRAND);
}

const API = config.API;

/** Routes behind buttons rather than links: a plan to view, one to edit. */
async function subRoutes() {
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "unittest-super1@example.com", password: "UnitTest123!" }),
  }).then((r) => r.json());
  const h = { Authorization: `Bearer ${login.accessToken}` };
  const { plans = [] } = await fetch(`${API}/plans`, { headers: h }).then((r) => r.json());
  const approved = plans.find((p) => p.status === "approved");
  const editable = plans.find((p) => p.status === "draft" || p.status === "rejected") || plans.find((p) => p.status === "pending");
  const out = ["/"];
  if (approved) out.push(`/dashboard/plans/${approved.id}`);
  if (editable) out.push(`/dashboard/plans/${editable.id}`, `/dashboard/plans/${editable.id}/edit`);
  return out;
}

/** "/dashboard/plans/12/edit" and ".../34/edit" are the same screen. */
const shape = (p) => p.replace(/\/\d+(?=\/|$)/g, "/:id");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const extra = await subRoutes().catch(() => []);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
  const report = [];

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport(vp);
    let errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));

    for (const route of PUBLIC) {
      errors = [];
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 300));
      const problems = await inspect(page);
      await page.screenshot({ path: path.join(OUT, `${label}-${vp.name}-pub${route.replace(/\//g, "_")}.png`) });
      report.push({ vp: vp.name, route, problems: [...problems, ...errors.map((e) => `error: ${e}`)] });
    }

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
    await page.type("#email", "unittest-super1@example.com");
    await page.type("input[type=password]", "UnitTest123!");
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
    ]);

    // Every listed route, then whatever they link to that is not listed yet
    // (checked once per screen shape, not once per record).
    const queue = [...ROUTES, ...extra];
    const seen = new Set(queue.map(shape));
    for (let i = 0; i < queue.length; i++) {
      const route = queue[i];
      errors = [];
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 500));
      const problems = await inspect(page);
      const name = route.replace(/^\/dashboard\/?/, "").replace(/[\/?=&]/g, "_") || "home";
      await page.screenshot({ path: path.join(OUT, `${label}-${vp.name}-${name}.png`) });
      report.push({ vp: vp.name, route, problems: [...problems, ...errors.map((e) => `error: ${e}`)] });

      const links = await page.$$eval('a[href^="/"]', (as) => as.map((a) => a.getAttribute("href")));
      for (const href of links) {
        const clean = href.split("#")[0];
        if (!clean.startsWith("/dashboard") && !["/login", "/register"].includes(clean)) continue;
        if (seen.has(shape(clean)) || /\/api\//.test(clean)) continue;
        seen.add(shape(clean));
        queue.push(clean);
        console.log(`  found ${clean} (on ${route})`);
      }
    }
    await page.close();
  }
  await browser.close();

  let bad = 0;
  for (const r of report) {
    if (!r.problems.length) continue;
    bad++;
    console.log(`${r.vp.padEnd(5)} ${r.route}`);
    for (const p of [...new Set(r.problems)].slice(0, 6)) console.log(`        ${p}`);
  }
  console.log(`\n${report.length - bad}/${report.length} page views clean`);
})().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
