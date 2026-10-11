// After the API has had time to fall asleep, sign in on the live site and
// record what happens: Render's refusal, the browser's wake-up call, the
// notice, and the final answer. Uses a made-up account, so the expected end
// is "Invalid credentials" — which proves the request reached the app.
const puppeteer = require("puppeteer-core");

const WAIT_MIN = Number(process.argv[2] || 17);
const SITE = "https://seat-planner-sable.vercel.app";

(async () => {
  console.log(`waiting ${WAIT_MIN} minutes for the API to fall asleep…`);
  await new Promise((r) => setTimeout(r, WAIT_MIN * 60_000));

  const browser = await puppeteer.launch({ executablePath: require("../e2e/config").CHROME, headless: "new" });
  const page = await browser.newPage();
  const t0 = Date.now();
  const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/") || u.includes("onrender.com")) {
      const h = r.headers();
      console.log(`${at()}  ${r.request().method()} ${u.replace(SITE, "")} -> ${r.status()}` +
        (h["x-render-routing"] ? `  x-render-routing: ${h["x-render-routing"]}` : "") +
        (h["x-render-origin-server"] ? "  (reached the app)" : ""));
    }
  });
  page.on("requestfailed", (r) => {
    if (r.url().includes("onrender.com")) console.log(`${at()}  wake request failed: ${r.failure()?.errorText}`);
  });

  await page.goto(`${SITE}/login`, { waitUntil: "networkidle0", timeout: 90_000 });
  await page.type("#email", "probe-nobody@example.com");
  await page.type("input[type=password]", "wrong-password");
  await page.click("button[type=submit]");

  let bannerAt = null;
  const end = Date.now() + 100_000;
  let toast = "";
  while (Date.now() < end) {
    if (!bannerAt && (await page.$(".server-waking"))) bannerAt = at();
    toast = await page.$eval(".p-toast-message", (e) => e.innerText.replace(/\s+/g, " ")).catch(() => "");
    if (toast) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`\nnotice shown: ${bannerAt ? `yes, at ${bannerAt}` : "no"}`);
  console.log(`final message after ${at()}: ${toast || "(none)"}`);
  console.log(/Invalid credentials/.test(toast) ? "RESULT: the sign-in reached the app" : "RESULT: did not reach the app");
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
