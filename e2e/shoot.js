// Screenshot the app at desktop and phone widths, logged in, so the UI can be
// judged by looking at it rather than by reading CSS.
//
//   node shoot.js <label> [page ...]
const config = require("./config");
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const CHROME = config.CHROME;
const BASE = config.WEB;
const OUT = config.SHOTS;

const label = process.argv[2] || "shot";
const pages = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ["/login", "/dashboard", "/dashboard/book", "/dashboard/bookings", "/dashboard/wallet", "/dashboard/checker"];

const VIEWPORTS = [
  { name: "desk", width: 1440, height: 900, isMobile: false, deviceScaleFactor: 1 },
  { name: "phone", width: 400, height: 860, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport(vp);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // Log in once per viewport through the real form.
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
    if (pages.includes("/login")) {
      await page.screenshot({ path: path.join(OUT, `${label}-${vp.name}-login.png`), fullPage: true });
    }
    await page.type("#email", "superadmin1@example.com");
    await page.type("#password", process.env.PW || "Admin@123");
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
    ]);

    for (const p of pages) {
      if (p === "/login") continue;
      await page.goto(`${BASE}${p}`, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 600));
      const name = p.replace(/^\/dashboard\/?/, "").replace(/\//g, "_") || "home";
      await page.screenshot({ path: path.join(OUT, `${label}-${vp.name}-${name}.png`), fullPage: false });
    }
    if (errors.length) console.log(vp.name, "page errors:", errors.slice(0, 3));
    await page.close();
  }

  await browser.close();
  console.log("saved to", OUT);
})().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
