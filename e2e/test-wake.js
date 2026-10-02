// The wake-up gate and the session, against a simulated sleeping Render.
//
// While "asleep", every API request through the proxy is refused the way
// Render refuses them (429, "hibernate-rate-limited", no body of ours). The
// direct wake-up request is held for a few seconds, as Render holds it while
// the server starts, and then the server is "awake".
const config = require("./config");
const puppeteer = require("puppeteer-core");

const BASE = config.WEB;
const WAKE = `${config.API}/health`;

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: config.CHROME, headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setRequestInterception(true);

  const state = { asleep: false, sleepAfterMe: false, wakeFails: false, wakes: 0, refused: 0, bannerSeen: false };
  page.on("request", (r) => {
    const url = r.url();
    if (url.startsWith(WAKE)) {
      state.wakes++;
      if (state.wakeFails) return r.abort("connectionrefused");
      return setTimeout(() => {
        state.asleep = false;
        r.continue();
      }, 3000);
    }
    if (state.sleepAfterMe && url.endsWith("/auth/me")) {
      // Let the session check through, then go to sleep: the requests the
      // page fires next, together, all meet a sleeping server.
      state.sleepAfterMe = false;
      state.asleep = true;
      return r.continue();
    }
    if (state.asleep && url.startsWith(`${BASE}/api/`)) {
      state.refused++;
      return r.respond({ status: 429, contentType: "text/plain", headers: { "x-render-routing": "hibernate-rate-limited" }, body: "Too Many Requests" });
    }
    r.continue();
  });
  const watchBanner = async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await page.$(".server-waking")) state.bannerSeen = true;
      await sleep(200);
    }
  };
  const tokens = () => page.evaluate(() => ({ access: localStorage.getItem("sp_access_token"), refresh: localStorage.getItem("sp_refresh_token") }));
  const path = () => new URL(page.url()).pathname;

  /* 1. Signing in while the server sleeps */
  console.log("== signing in while the server is asleep ==");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  Object.assign(state, { asleep: true, wakes: 0, refused: 0, bannerSeen: false });
  await page.type("#email", "unittest-super1@example.com");
  await page.type("input[type=password]", "UnitTest123!");
  await page.click("button[type=submit]");
  await watchBanner(2500);
  const bannerText = await page.$eval(".server-waking", (e) => e.innerText).catch(() => "");
  await page.waitForFunction(() => location.pathname === "/dashboard", { timeout: 20000 }).catch(() => {});
  check("the refusal is not shown as an error; the sign-in carries on", !(await page.$(".p-toast-message-error")));
  check("\"Starting the server…\" is shown while it waits", state.bannerSeen && /Starting the server/.test(bannerText), bannerText);
  check("the server is woken exactly once", state.wakes === 1, `${state.wakes}`);
  check("and the sign-in succeeds once it is up", path() === "/dashboard", page.url());
  await sleep(800);
  check("the notice goes away afterwards", !(await page.$(".server-waking")));

  /* 2. Reloading a busy page while the server sleeps */
  console.log("\n== the server falls asleep just as the home page asks for several things ==");
  Object.assign(state, { asleep: false, sleepAfterMe: true, wakes: 0, refused: 0, bannerSeen: false });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await watchBanner(1500);
  await page.waitForFunction(() => document.querySelector(".dash-sidebar") && !document.querySelector(".server-waking"), { timeout: 20000 }).catch(() => {});
  await sleep(2000);
  check(`the ${state.refused} refused requests share a single wake-up`, state.refused >= 2 && state.wakes === 1, `${state.refused} refused, ${state.wakes} wakes`);
  check("still signed in, on the home page", path() === "/dashboard" && Boolean(await page.$(".dash-sidebar")), page.url());
  check("with no error shown", !(await page.$(".p-toast-message-error")));

  /* 3. The server cannot be woken at all */
  console.log("\n== reloading while the server cannot be woken ==");
  Object.assign(state, { asleep: true, wakeFails: true, wakes: 0, refused: 0 });
  await page.goto(`${BASE}/dashboard/jobs`, { waitUntil: "domcontentloaded" });
  await sleep(3000);
  const down = await page.evaluate(() => document.body.innerText);
  check("the page says it can't reach the server", /Can't reach the server/.test(down), down.slice(0, 200));
  check("instead of sending you to sign in", path() === "/dashboard/jobs", page.url());
  const kept = await tokens();
  check("and the session is kept", Boolean(kept.access && kept.refresh), JSON.stringify(kept));
  check("it gave up rather than retrying forever", state.refused <= 4 && state.wakes <= 2, `${state.refused} refused, ${state.wakes} wakes`);
  Object.assign(state, { asleep: false, wakeFails: false });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Try again/.test(b.innerText))?.click());
  await page.waitForFunction(() => /Background jobs/.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
  check("\"Try again\" picks up where it left off once the server answers", /Background jobs/.test(await page.evaluate(() => document.body.innerText)));

  /* 4. The short-lived access token has expired */
  console.log("\n== reloading after the access token has expired ==");
  await page.evaluate(() => localStorage.setItem("sp_access_token", "expired-or-invalid-token"));
  const before = (await tokens()).refresh;
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0" });
  await sleep(1000);
  const after = await tokens();
  check("the session is renewed with the refresh token, not ended", path() === "/dashboard" && Boolean(await page.$(".dash-sidebar")), page.url());
  check("with a fresh pair of tokens", after.access && after.access !== "expired-or-invalid-token" && after.refresh !== before, JSON.stringify(after).slice(0, 80));

  /* 5. A wrong password is still just a wrong password */
  console.log("\n== a wrong password ==");
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", "unittest-super1@example.com");
  await page.type("input[type=password]", "not-the-password");
  await page.click("button[type=submit]");
  await page.waitForSelector(".p-toast-message", { timeout: 10000 }).catch(() => {});
  const wrong = await page.$eval(".p-toast-message", (e) => e.innerText.replace(/\s+/g, " ")).catch(() => "");
  check("is refused with the API's own message", /Invalid credentials/.test(wrong), wrong);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
