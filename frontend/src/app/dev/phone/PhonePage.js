"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "primereact/button";

const KIND = { wifi: "Wi-Fi", wired: "Wired", other: "Network", virtual: "Virtual adapter" };

/** The "Open on phone" page — see page.js for where its data comes from. */
export default function PhonePage({ addresses, apk, port, production }) {
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const chosen = addresses[index];

  const copy = async () => {
    try {
      // As it is typed on the app's server screen.
      await navigator.clipboard.writeText(chosen.server.replace(/^http:\/\//, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The address is on screen to type instead.
    }
  };

  return (
    <main className="phone">
      <div className="phone__wrap">
        <header className="phone__head">
          <Link href="/dashboard" className="phone__back">
            <i className="pi pi-arrow-left" aria-hidden="true" /> Seat Planner
          </Link>
          <span className="phone__badge">
            <i className="pi pi-code" aria-hidden="true" /> Development only
          </span>
          <h1>Open on phone</h1>
          <p>
            Try this computer&apos;s Seat Planner in the Android app. The live site has no such page — it only
            appears while <code>npm run dev</code> runs here.
          </p>
        </header>

        {!chosen ? (
          <div className="phone__empty" role="alert">
            <i className="pi pi-wifi" aria-hidden="true" />
            <p>
              This computer isn&apos;t on a network a phone could reach. Connect it to the same Wi-Fi as the phone,
              then reload.
            </p>
          </div>
        ) : (
          <>
            <section className="phone__addresses" aria-labelledby="phone-addresses">
              <span id="phone-addresses" className="phone__label">
                This computer on the network
              </span>
              <div className="phone__chips" role="radiogroup" aria-labelledby="phone-addresses">
                {addresses.map((a, i) => (
                  <button
                    key={`${a.name}-${a.address}`}
                    type="button"
                    role="radio"
                    aria-checked={i === index}
                    className={`phone__chip${i === index ? " is-on" : ""}`}
                    onClick={() => setIndex(i)}
                  >
                    <strong>{a.address}</strong>
                    <span>
                      {KIND[a.kind]} · {a.name}
                    </span>
                  </button>
                ))}
              </div>
              {chosen.kind === "virtual" && (
                <p className="phone__warn">
                  <i className="pi pi-exclamation-triangle" aria-hidden="true" /> That one belongs to a virtual adapter
                  (WSL, Docker, a VPN) — a phone usually can&apos;t reach it.
                </p>
              )}
            </section>

            <div className="phone__steps">
              <article className="phone__step">
                <span className="phone__num" aria-hidden="true">
                  1
                </span>
                <h2>Install the app</h2>
                {apk ? (
                  <>
                    <div
                      className="phone__qr"
                      role="img"
                      aria-label="QR code that downloads the app from this computer"
                      dangerouslySetInnerHTML={{ __html: chosen.apkQr }}
                    />
                    <p>
                      Scan with the phone&apos;s camera and open the download. Android asks once to allow installs from
                      your browser.
                    </p>
                    <p className="phone__meta">
                      {apk.kind === "release" ? "Signed release" : "Debug build"} · {apk.megabytes} MB · built{" "}
                      {apk.builtAgo}
                    </p>
                  </>
                ) : (
                  <p className="phone__none">
                    The app hasn&apos;t been built on this computer yet. Build it with{" "}
                    <code>cd android &amp;&amp; gradlew assembleRelease</code> — see android/README.md.
                  </p>
                )}
                <p className="phone__meta">Already installed? Go to step 2.</p>
              </article>

              <article className="phone__step">
                <span className="phone__num" aria-hidden="true">
                  2
                </span>
                <h2>Switch it to this computer</h2>
                <div
                  className="phone__qr"
                  role="img"
                  aria-label={`QR code that switches the app to ${chosen.server}`}
                  dangerouslySetInnerHTML={{ __html: chosen.switchQr }}
                />
                <p>
                  Scan with the phone&apos;s camera and choose <strong>Seat Planner</strong>. The app asks before it
                  switches, then shows a <span className="phone__dev">DEV</span> strip — tap it to go back to{" "}
                  {production}.
                </p>
                <div className="phone__addr">
                  <code>{chosen.server.replace(/^http:\/\//, "")}</code>
                  <Button
                    type="button"
                    label={copied ? "Copied" : "Copy"}
                    icon={copied ? "pi pi-check" : "pi pi-copy"}
                    size="small"
                    text
                    onClick={copy}
                  />
                </div>
              </article>
            </div>
          </>
        )}

        <section className="phone__help" aria-labelledby="phone-help">
          <h2 id="phone-help">If the phone can&apos;t reach it</h2>
          <ul>
            <li>
              <strong>Same Wi-Fi.</strong> The phone must be on the same network as this computer — not mobile data,
              not a guest network.
            </li>
            <li>
              <strong>Windows Firewall.</strong> Allow Node.js on <em>private</em> networks (Windows asks the first
              time; otherwise Windows Security → Firewall &amp; network protection → Allow an app), and set this
              Wi-Fi to Private.
            </li>
            <li>
              <strong>No QR code?</strong> Hold three fingers on the app&apos;s screen for three seconds to open its
              server screen, then type the address.
            </li>
            <li>
              <strong>The ticket scanner&apos;s camera</strong> only works on https or <code>localhost</code>. Plug the
              phone in by USB, run <code>adb reverse tcp:{port} tcp:{port}</code>, and choose &ldquo;over USB&rdquo; on
              the server screen{port !== "3000" ? ` (or type localhost:${port})` : ""}.
            </li>
            <li>
              <strong>Inspecting the page.</strong> While the app is on this computer, desktop Chrome can inspect it at{" "}
              <code>chrome://inspect</code> with the phone plugged in.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
