/**
 * The two decisions made when a job fails: whether to try again, and when.
 *
 * Kept pure and in their own file so they are unit-tested without a database.
 */

/**
 * How long a failed job waits before its next attempt.
 *
 * Doubling from a base: 30s, 1m, 2m, 4m, 8m… capped at half an hour. The
 * failures this exists for are a database blip or a mail server refusing
 * connections for a minute — waiting a little longer each time gives those room
 * to clear without hammering them, and the cap keeps a job from vanishing into
 * a wait so long that nobody connects the eventual run with the incident.
 */
const CAP_SECONDS = 30 * 60;

function backoffSeconds(attempt, baseSeconds = 30) {
  const n = Math.max(1, Math.floor(Number(attempt) || 1));
  const base = Math.max(1, Number(baseSeconds) || 30);
  return Math.min(CAP_SECONDS, base * 2 ** (n - 1));
}

/**
 * Whether a failure should end the job now rather than be retried.
 *
 * A refusal — a 4xx, like "this departure no longer exists" — will refuse
 * again however long it waits, and retrying it only delays the moment a person
 * sees it. A handler can also say so explicitly with `retryable: false`.
 * Everything else (a dropped connection, a mail server saying "try later") is
 * worth another attempt.
 */
function isPermanent(err) {
  if (err?.retryable === false) return true;
  const code = err?.statusCode ?? err?.status;
  return Number.isInteger(code) && code >= 400 && code < 500;
}

module.exports = { backoffSeconds, isPermanent, CAP_SECONDS };
