/**
 * Whether a host name is this machine or another one on the same network:
 * `localhost`, or an IPv4 address in a loopback or private range.
 *
 * The Android app's server switch accepts only these (android/…/Servers.kt
 * holds the same rule), and the "Open on phone" page only exists while the
 * site is opened through one — that is, on a developer's own computer.
 */
export function isLocalHost(hostname = "") {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;

  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return false;
  const [a, b] = parts.map(Number);
  if (parts.some((p) => Number(p) > 255)) return false;

  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The host name without its port: `192.168.0.12:3000` → `192.168.0.12`. */
export function hostnameOf(host = "") {
  const text = String(host);
  if (text.startsWith("[")) return text.slice(1, text.indexOf("]"));
  return text.split(":")[0];
}
