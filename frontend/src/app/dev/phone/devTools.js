import os from "node:os";
import path from "node:path";
import { stat } from "node:fs/promises";
import { hostnameOf, isLocalHost } from "@/lib/localNetwork";

/*
 * Server-side helpers for the "Open on phone" page and its APK download.
 *
 * Both exist only on a developer's own computer: the dev server (`next dev`),
 * reached through this machine's own address. Anywhere else — the live site,
 * a production build — they answer 404, so no one outside learns the
 * network's addresses.
 */

export function devToolsAllowed(host) {
  return process.env.NODE_ENV === "development" && isLocalHost(hostnameOf(host));
}

/** The port the site was opened on, which the phone needs too. */
export function portOf(host) {
  try {
    return new URL(`http://${host}`).port || "80";
  } catch {
    return "3000";
  }
}

// Adapters a phone cannot reach: WSL, Docker, Hyper-V, VPNs and the like.
const VIRTUAL = /virtual|vethernet|vmware|vbox|docker|wsl|hyper-v|tailscale|zerotier|vpn|bluetooth|^br-|^veth|^utun|^awdl|^llw/i;
const WIRELESS = /wi-?fi|wlan|wireless|^wl/i;
const WIRED = /ethernet|^eth|^en\d/i;

/**
 * This computer's addresses on its networks, the one a phone on the same
 * Wi-Fi most likely reaches first. A browser cannot see these — it only
 * knows it was opened as `localhost` — which is why this runs on the server.
 */
export function lanAddresses() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      const v4 = a.family === "IPv4" || a.family === 4;
      if (!v4 || a.internal || a.address.startsWith("127.") || !isLocalHost(a.address)) continue;

      const kind = VIRTUAL.test(name) ? "virtual" : WIRELESS.test(name) ? "wifi" : WIRED.test(name) ? "wired" : "other";
      found.push({ name, address: a.address, kind });
    }
  }

  const rank = ({ kind, address }) =>
    ({ wifi: 30, wired: 20, other: 10, virtual: 0 })[kind] + (address.startsWith("192.168.") ? 1 : 0);
  return found.sort((x, y) => rank(y) - rank(x) || x.name.localeCompare(y.name));
}

/*
 * The Android app as last built on this computer (see android/README.md). A
 * signed release is preferred; an unsigned one cannot be installed at all.
 */
const APK_CANDIDATES = [
  { kind: "release", file: "android/app/build/outputs/apk/release/app-release.apk" },
  { kind: "debug", file: "android/app/build/outputs/apk/debug/app-debug.apk" },
];

export async function findApk() {
  for (const { kind, file } of APK_CANDIDATES) {
    const full = path.join(process.cwd(), "..", file);
    try {
      const info = await stat(full);
      if (info.isFile()) return { kind, path: full, size: info.size, builtAt: info.mtime.toISOString() };
    } catch {
      // not built
    }
  }
  return null;
}
