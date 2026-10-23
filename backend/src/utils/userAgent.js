/**
 * A browser's own description of itself, boiled down to what is worth
 * counting: which browser, which operating system, phone or computer — and
 * whether it says it is a robot. Rough on purpose: no library, and nothing
 * is decided by it except what the records show.
 */
const BROWSERS = [
  ["Edge", /Edg(?:e|A|iOS)?\/([\d]+)/],
  ["Opera", /(?:OPR|Opera)\/([\d]+)/],
  ["Samsung Internet", /SamsungBrowser\/([\d]+)/],
  ["UC Browser", /UCBrowser\/([\d]+)/],
  ["Firefox", /(?:Firefox|FxiOS)\/([\d]+)/],
  ["Chrome", /(?:Chrome|CriOS)\/([\d]+)/],
  ["Safari", /Version\/([\d]+).*Safari/],
];

const SYSTEMS = [
  ["Android", /Android/],
  ["iOS", /iPhone|iPad|iPod/],
  ["Windows", /Windows/],
  ["macOS", /Mac OS X|Macintosh/],
  ["Linux", /Linux/],
];

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|curl|wget|python|axios|node-fetch|go-http|java\//i;

function parseUserAgent(ua = "") {
  const text = String(ua || "");
  if (!text) return { browser: null, os: null, device: null, bot: false };
  const bot = BOT.test(text);
  let browser = null;
  for (const [name, re] of BROWSERS) {
    const m = re.exec(text);
    if (m) {
      browser = `${name} ${m[1]}`;
      break;
    }
  }
  const os = SYSTEMS.find(([, re]) => re.test(text))?.[0] || null;
  const device = bot ? "bot" : /iPad|Tablet/i.test(text) ? "tablet" : /Mobi|iPhone|Android/i.test(text) ? "phone" : "computer";
  return { browser, os, device, bot };
}

module.exports = { parseUserAgent };
