import Link from "next/link";
import config from "@/config";
import { hostnameOf, isLocalHost } from "@/lib/localNetwork";
import "./server.css";

/*
 * Where a switch link lands when the Android app did not take it.
 *
 * A developer's "Open on phone" page shows a QR code for
 * /app/server?url=http://192.168.x.x:3000. On a phone with the app, Android
 * opens the app instead of this page — once it has checked
 * /.well-known/assetlinks.json. Until then, or on a phone without the app,
 * the browser shows this: a button that opens the app another way, and what
 * to do if nothing happens.
 */
export const metadata = {
  title: "Open in the app — Seat Planner",
  robots: { index: false, follow: false },
};

const PACKAGE = "com.seatplanner.app";

function localAddress(url) {
  try {
    const parsed = new URL(url.includes("://") ? url : `http://${url}`);
    return isLocalHost(hostnameOf(parsed.host)) ? parsed.host : null;
  } catch {
    return null;
  }
}

export default async function SwitchLinkPage({ searchParams }) {
  const params = await searchParams;
  const url = typeof params.url === "string" ? params.url : "";
  const missing = params.missing === "1";
  const address = localAddress(url);

  // Chrome opens an intent: link in the app when it is installed, and goes to
  // the fallback — this page, saying so — when it is not.
  const fallback = `${config.productionUrl}/app/server?url=${encodeURIComponent(url)}&missing=1`;
  const intent =
    `intent://server?url=${encodeURIComponent(url)}` +
    `#Intent;scheme=seatplanner;package=${PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;

  return (
    <main className="switch">
      <article className="switch__card">
        <span className="switch__mark" aria-hidden="true">
          <i className="pi pi-mobile" />
        </span>
        <h1>Open in the Seat Planner app</h1>

        {address ? (
          <p>
            This link switches the Android app to a developer&apos;s computer, <code>{address}</code>, for testing. The
            app asks before it switches.
          </p>
        ) : (
          <p className="switch__bad" role="alert">
            This link doesn&apos;t name a computer on a local network, so the app won&apos;t switch to it.
          </p>
        )}

        {missing && (
          <p className="switch__note" role="status">
            <i className="pi pi-info-circle" aria-hidden="true" /> The app isn&apos;t installed on this phone. Install it
            from the computer&apos;s <strong>Open on phone</strong> page first, then scan the code again.
          </p>
        )}

        {address && (
          <a className="switch__button" href={intent}>
            <i className="pi pi-external-link" aria-hidden="true" /> Open in the app
          </a>
        )}

        <Link href="/" className="switch__away">
          Go to the Seat Planner website instead
        </Link>
      </article>
    </main>
  );
}
