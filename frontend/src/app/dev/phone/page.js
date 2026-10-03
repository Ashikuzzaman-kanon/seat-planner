import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import config from "@/config";
import { devToolsAllowed, findApk, lanAddresses, portOf } from "./devTools";
import PhonePage from "./PhonePage";
import "./phone.css";

/*
 * "Open on phone": two QR codes that put this computer's Seat Planner on an
 * Android phone — one downloads the app, one switches it to this computer.
 *
 * A development tool, so it only exists under `next dev` opened through this
 * machine's own address (see devTools.js); anywhere else it is a 404. The QR
 * codes are drawn here, on the server — this network's addresses are never
 * sent to an online QR service.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Open on phone — Seat Planner",
  robots: { index: false, follow: false },
};

const qr = (text) =>
  QRCode.toString(text, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#0f172a", light: "#ffffff" },
  });

/** "3 minutes ago" — worked out here, so the server and the browser cannot disagree about it. */
function ago(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export default async function OpenOnPhonePage() {
  const host = (await headers()).get("host") || "";
  if (!devToolsAllowed(host)) notFound();

  const port = portOf(host);
  const apk = await findApk();

  const addresses = await Promise.all(
    lanAddresses().map(async (a) => {
      const server = `http://${a.address}:${port}`;
      // An App Link on the live site: the phone's camera hands it to the app,
      // which checks the address and asks before switching.
      const switchLink = `${config.productionUrl}/app/server?url=${encodeURIComponent(server)}`;
      const apkLink = `${server}/dev/phone/seat-planner.apk`;
      return {
        ...a,
        server,
        switchQr: await qr(switchLink),
        apkQr: apk ? await qr(apkLink) : null,
      };
    })
  );

  return (
    <PhonePage
      addresses={addresses}
      apk={apk && { kind: apk.kind, megabytes: (apk.size / 1048576).toFixed(1), builtAgo: ago(apk.builtAt) }}
      port={port}
      production={config.productionUrl.replace(/^https?:\/\//, "")}
    />
  );
}
