/**
 * App versions as the subscription check sees them, as pure functions.
 *
 * A caller says which version of its app is making the check: "1.4.2". Each
 * platform may require one, set the oldest it still accepts, and block single
 * versions outright (services/appVersionService). Everything here is the
 * arithmetic of that.
 *
 * A version is one to four numbers joined by dots, with an optional leading
 * "v": "2", "1.4", "1.4.2", "v1.4.2.17". Versions compare number by number, a
 * missing number counting as 0 — so "1.4" and "1.4.0" are the same version,
 * and "1.10" is newer than "1.9".
 */

const VERSION = /^v?(\d{1,6}(?:\.\d{1,6}){0,3})$/i;

/** Why a check was turned away on its version. Logged; the caller gets words, not these. */
const VERSION_REFUSAL = Object.freeze({
  REQUIRED: "version_required",
  INVALID: "version_invalid",
  TOO_OLD: "version_too_old",
  BLOCKED: "version_blocked",
});

/** A version as stored and compared ("v1.4.02" → "1.4.2"), or null if it is not one. */
function cleanVersion(input) {
  if (input === undefined || input === null) return null;
  const match = String(input).trim().match(VERSION);
  if (!match) return null;
  return match[1]
    .split(".")
    .map((n) => String(Number(n)))
    .join(".");
}

/** Whether anything was sent at all (an empty string is nothing). */
const sentAVersion = (input) => input !== undefined && input !== null && String(input).trim() !== "";

/** -1, 0 or 1, comparing two clean versions number by number. */
function compareVersions(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Decide whether a version may make a check, under one platform's rules.
 *
 * `sent` is what the caller sent; `policy` is `{ required, minVersion, blocked }`
 * with `blocked` a list of clean versions. Returns `{ version }` — the clean
 * version, or null when none was sent and none is required — or `{ refusal }`.
 */
function judgeVersion(sent, { required = false, minVersion = null, blocked = [] } = {}) {
  if (!sentAVersion(sent)) return required ? { refusal: VERSION_REFUSAL.REQUIRED } : { version: null };
  const version = cleanVersion(sent);
  if (!version) return { refusal: VERSION_REFUSAL.INVALID };
  if (minVersion && compareVersions(version, minVersion) < 0) return { refusal: VERSION_REFUSAL.TOO_OLD };
  if (blocked.some((b) => compareVersions(b, version) === 0)) return { refusal: VERSION_REFUSAL.BLOCKED };
  return { version };
}

module.exports = { VERSION_REFUSAL, cleanVersion, sentAVersion, compareVersions, judgeVersion };
