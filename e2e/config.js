/**
 * Where the browser checks look, and which browser they drive.
 *
 * Defaults suit a developer running the API and the web app locally with the
 * development data (README → Running it locally, plus `npm run
 * seed:unittestusers`); every value can be overridden from the environment.
 */
const path = require("path");

function defaultChrome() {
  if (process.platform === "win32") return "C:/Program Files/Google/Chrome/Application/chrome.exe";
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return "/usr/bin/google-chrome";
}

module.exports = {
  WEB: process.env.E2E_WEB || "http://localhost:3000",
  API: process.env.E2E_API || "http://localhost:4000/api/v1",
  CHROME: process.env.CHROME_PATH || defaultChrome(),
  SHOTS: path.join(__dirname, "shots"),
};
