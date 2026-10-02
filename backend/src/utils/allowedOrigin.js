// Which browser origins may call the API.
//
// `CORS_ORIGINS` lists them, comma-separated. An entry may hold a `*`, which
// stands for one piece of a host name — letters, digits and hyphens, never a
// dot. That is what a Vercel preview needs: every branch and every deploy gets
// its own address, all of one shape, e.g.
//
//   https://seat-planner-*-ashikuzzaman-kanons-projects.vercel.app
//
// matches `seat-planner-git-my-branch-…` and `seat-planner-4fk2a9-…` but not
// `seat-planner-x.evil.com-…`, a different scheme, or anything with a port.

// Public dev tunnels (cloudflare/localtunnel/ngrok/VS Code) hand out a fresh
// random hostname each run, so allow their domains by suffix in development
// rather than hardcoding a URL that changes every session.
const TUNNEL_SUFFIXES = [
  ".trycloudflare.com",
  ".loca.lt",
  ".ngrok-free.app",
  ".ngrok.app",
  ".devtunnels.ms",
];

/**
 * Addresses that only exist inside somebody's own network.
 *
 * Loopback, the three RFC 1918 ranges, and link-local. A phone on the same
 * Wi-Fi reaching a laptop is the ordinary way this gets tested, and writing one
 * address into `CORS_ORIGINS` breaks the next time the router hands out a
 * different one.
 *
 * Development only — see the guard in `originPolicy`. In production, being
 * on a private address is not a reason to trust an origin: it would let
 * anything sharing a network with the server call the API from a browser.
 */
const PRIVATE_HOSTS = [
  /^localhost$/,
  /^\[?::1\]?$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  // 172.16.0.0 – 172.31.255.255, and not 172.32+ which is public.
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
];

const isPrivateHost = (host) => PRIVATE_HOSTS.some((pattern) => pattern.test(host));

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One `CORS_ORIGINS` entry as a test of an origin. Host names ignore case. */
function entryMatcher(entry) {
  const wanted = entry.toLowerCase();
  if (!wanted.includes("*")) return (origin) => origin === wanted;
  const pattern = new RegExp(`^${wanted.split("*").map(escapeRegExp).join("[a-z0-9-]+")}$`);
  return (origin) => pattern.test(origin);
}

/**
 * The check the CORS middleware runs on each browser request's `Origin`.
 *
 * @param {string[]} entries  `CORS_ORIGINS`, already split
 * @param {{ production: boolean }} options  outside production, dev tunnels
 *   and machines on the same network are let in as well
 */
function originPolicy(entries, { production }) {
  const matchers = entries.map(entryMatcher);
  return function isAllowedOrigin(origin) {
    const candidate = String(origin).toLowerCase();
    if (matchers.some((matches) => matches(candidate))) return true;
    if (production) return false;
    try {
      const host = new URL(candidate).hostname;
      // A dev tunnel, or a machine on the same network as this one.
      return TUNNEL_SUFFIXES.some((s) => host.endsWith(s)) || isPrivateHost(host);
    } catch {
      return false;
    }
  };
}

module.exports = { originPolicy };
