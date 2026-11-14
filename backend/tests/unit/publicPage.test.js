const test = require("node:test");
const assert = require("node:assert/strict");

const { parseUserAgent } = require("../../src/utils/userAgent");
const { createLimiter } = require("../../src/utils/rateLimiter");
const { issuePass, checkPass } = require("../../src/utils/publicPass");
const { readVisitor } = require("../../src/utils/publicRequest");
const { queryKeyOf } = require("../../src/services/publicAllocationService");

test("a browser's description, boiled down", () => {
  assert.deepEqual(
    parseUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"),
    { browser: "Chrome 141", os: "Android", device: "phone", bot: false }
  );
  assert.deepEqual(
    parseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"),
    { browser: "Safari 18", os: "iOS", device: "phone", bot: false }
  );
  assert.deepEqual(
    parseUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0"),
    { browser: "Edge 141", os: "Windows", device: "computer", bot: false }
  );
  const google = parseUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");
  assert.equal(google.bot, true);
  assert.equal(google.device, "bot");
  assert.deepEqual(parseUserAgent(""), { browser: null, os: null, device: null, bot: false });
});

test("the limiter counts within a window, then asks to wait until it ends", () => {
  const limiter = createLimiter();
  const t0 = 1_000_000_040_000; // 20 s into a minute (they start at multiples of 60,000 ms)
  assert.equal(limiter.hit("ip:a", 2, 60_000, t0).ok, true);
  assert.equal(limiter.hit("ip:a", 2, 60_000, t0 + 1).ok, true);
  const over = limiter.hit("ip:a", 2, 60_000, t0 + 2);
  assert.equal(over.ok, false);
  assert.equal(over.retryAfterSeconds, 40);
  assert.equal(limiter.hit("ip:b", 2, 60_000, t0 + 3).ok, true, "another key has its own count");
  assert.equal(limiter.hit("ip:a", 2, 60_000, t0 + 40_000).ok, true, "a new window starts again");
});

test("a bot-check pass belongs to one browser, and runs out", () => {
  const now = Date.now();
  const { pass } = issuePass("visitor-aaaaaaaaaaaaaaaa", 60, now);
  assert.equal(checkPass(pass, "visitor-aaaaaaaaaaaaaaaa", now + 1000), true);
  assert.equal(checkPass(pass, "visitor-bbbbbbbbbbbbbbbb", now + 1000), false, "another browser");
  assert.equal(checkPass(pass, "visitor-aaaaaaaaaaaaaaaa", now + 61 * 60_000), false, "run out");
  const [expires, sig] = pass.split(".");
  assert.equal(checkPass(`${Number(expires) + 3600_000}.${sig}`, "visitor-aaaaaaaaaaaaaaaa", now), false, "stretched");
  assert.equal(checkPass("", "visitor-aaaaaaaaaaaaaaaa", now), false);
});

test("a search in a fixed form: paging is the same search, the opening view is the empty one", () => {
  assert.equal(queryKeyOf({ from: "Dhaka", to: "Rajshahi" }), "Dhaka|Rajshahi|||");
  assert.equal(queryKeyOf({ train: "753", show: "all", page: 3 }), "||753||all");
  assert.equal(queryKeyOf({}), "||||");
});

test("a visitor, as the web app's server passes them on", () => {
  // No PUBLIC_EDGE_SECRET in unit tests: the headers are taken as they come (not in production).
  const v = readVisitor({
    headers: {
      "x-sp-client-ip": "203.0.113.5",
      "x-sp-country": "BD",
      "x-sp-city": "Chattogram%20City",
      "x-sp-visitor": "abcdef12-3456-7890-abcd-ef1234567890",
      "x-sp-referrer": "https://www.facebook.com/",
      "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/141.0 Mobile Safari/537.36",
      "accept-language": "bn-BD,bn;q=0.9",
      referer: "https://seat-planner.example/seat-allocation",
    },
    ip: "10.0.0.1",
  });
  assert.equal(v.ip, "203.0.113.5");
  assert.equal(v.country, "BD");
  assert.equal(v.city, "Chattogram City");
  assert.equal(v.visitorId, "abcdef12-3456-7890-abcd-ef1234567890");
  assert.equal(v.referrer, "https://www.facebook.com/", "the page they came from, not this site's own");
  assert.equal(v.language, "bn-BD");
  assert.equal(v.device, "phone");
  assert.equal(v.vouched, null);
  assert.equal(readVisitor({ headers: { "x-sp-visitor": "bad id!" }, ip: "10.0.0.1" }).visitorId, null);
  assert.equal(readVisitor({ headers: {}, ip: "10.0.0.1" }).ip, "10.0.0.1");
});
