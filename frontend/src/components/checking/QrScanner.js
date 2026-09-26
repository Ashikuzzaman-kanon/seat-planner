"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Message } from "primereact/message";

/**
 * Reading a ticket's QR code with the device's camera.
 *
 * ## Two decoders, and why
 *
 * Chromium ships `BarcodeDetector`, a native reader that decodes in the
 * browser's own code rather than in JavaScript on the main thread. Where it
 * exists it is the better choice on the phone a checker is actually holding.
 *
 * It does not exist everywhere, and not where you would guess: it wraps a
 * platform barcode service, so Chrome has it on Android, macOS and ChromeOS —
 * and **not on Windows**, which has no such service. An earlier version of this
 * component assumed "Chrome means BarcodeDetector" and told people on Windows
 * that their browser could not read QR codes, which was both wrong and useless.
 *
 * So `jsQR` is bundled as the fallback: pure JavaScript, no WASM, works
 * anywhere a canvas does. The native path is preferred when present and the
 * fallback is silent — the person scanning should never need to know which one
 * ran.
 *
 * ## Why the camera needs localhost or HTTPS
 *
 * `getUserMedia` only runs in a secure context. `http://localhost` counts, so
 * this works in development with no certificate. Opening the same page from a
 * phone over `http://192.168.x.x` does **not** — the browser refuses the
 * camera, and that is the browser being right rather than something broken
 * here. The message below says so, because the alternative is ten minutes spent
 * wondering why the button does nothing.
 *
 * ## Why it keeps scanning
 *
 * A checker works down a carriage. Stopping after one read would mean pressing
 * start for every passenger, so it runs continuously and reports each new code
 * once — `lastSeen` stops the same ticket firing every frame while it sits in
 * front of the lens.
 */

/** How often the JavaScript decoder looks. Every frame is wasted work. */
const FALLBACK_INTERVAL_MS = 220;

export default function QrScanner({ onCode, disabled }) {
  const video = useRef(null);
  const canvas = useRef(null);
  const stream = useRef(null);
  const raf = useRef(null);
  const timer = useRef(null);
  const lastSeen = useRef({ value: null, at: 0 });

  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [secure, setSecure] = useState(true);
  const [decoder, setDecoder] = useState(null); // "native" | "bundled"

  useEffect(() => {
    // `isSecureContext` is exactly the condition getUserMedia applies.
    setSecure(typeof window !== "undefined" && window.isSecureContext);
  }, []);

  const stop = useCallback(() => {
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (stream.current) {
      stream.current.getTracks().forEach((t) => t.stop());
      stream.current = null;
    }
    if (video.current) video.current.srcObject = null;
    setRunning(false);
  }, []);

  // Releasing the camera on unmount is not optional: a page left without
  // stopping it keeps the light on and the device warm.
  useEffect(() => stop, [stop]);

  /** One place decides what to do with a decoded string. */
  const found = useCallback(
    (value) => {
      if (!value) return;
      const now = Date.now();
      // The same ticket in front of the lens must fire once, not once a frame.
      if (value !== lastSeen.current.value || now - lastSeen.current.at > 4000) {
        lastSeen.current = { value, at: now };
        onCode(value);
      }
    },
    [onCode]
  );

  const start = async () => {
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        // The back camera on a phone; ignored harmlessly on a laptop.
        video: { facingMode: "environment" },
        audio: false,
      });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      setRunning(true);

      if ("BarcodeDetector" in window) {
        setDecoder("native");
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        const read = async () => {
          if (video.current?.readyState === 4) {
            try {
              const codes = await detector.detect(video.current);
              if (codes.length) found(codes[0].rawValue);
            } catch {
              // A frame that will not decode is the ordinary case.
            }
          }
          raf.current = requestAnimationFrame(read);
        };
        raf.current = requestAnimationFrame(read);
        return;
      }

      /*
       * No native reader. Draw frames to a canvas and decode them here.
       *
       * On an interval rather than every frame: decoding in JavaScript costs
       * real time, and four or five looks a second reads a ticket held up to a
       * lens just as reliably as sixty would, without heating the device.
       */
      setDecoder("bundled");
      const { default: jsQR } = await import("jsqr");

      timer.current = setInterval(() => {
        const v = video.current;
        if (!v || v.readyState !== 4) return;

        const c = canvas.current;
        // Decode at the camera's own resolution; scaling down loses the fine
        // detail a dense QR needs.
        const width = v.videoWidth;
        const height = v.videoHeight;
        if (!width || !height) return;

        if (c.width !== width) c.width = width;
        if (c.height !== height) c.height = height;

        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, width, height);

        try {
          const image = ctx.getImageData(0, 0, width, height);
          const code = jsQR(image.data, width, height, {
            // Tickets are printed dark-on-light; not trying the inverse halves
            // the work per frame.
            inversionAttempts: "dontInvert",
          });
          if (code?.data) found(code.data);
        } catch {
          // Same as above: an unreadable frame is normal.
        }
      }, FALLBACK_INTERVAL_MS);
    } catch (err) {
      setError(
        err.name === "NotAllowedError"
          ? "The camera was refused. Allow it in the address bar, then press start again."
          : err.name === "NotFoundError"
            ? "No camera on this device. Type the ticket number instead."
            : err.message
      );
      stop();
    }
  };

  if (!secure) {
    return (
      <Message
        severity="warn"
        className="scanner-note"
        content={
          <div>
            <strong>The camera needs a secure page.</strong>
            <p>
              Browsers only give the camera to <code>https://</code> or{" "}
              <code>http://localhost</code>. Over a network address it will not work — use
              localhost on this machine, put the page behind HTTPS, or type the ticket number
              below.
            </p>
          </div>
        }
      />
    );
  }

  return (
    <div className="scanner">
      <div className={`scanner__frame${running ? " is-live" : ""}`}>
        <video ref={video} playsInline muted className="scanner__video" />
        {/* Never shown; it exists only as somewhere to read pixels from. */}
        <canvas ref={canvas} className="scanner__canvas" />
        {!running && (
          <div className="scanner__idle">
            <i className="pi pi-camera" aria-hidden="true" />
            <span>Camera off</span>
          </div>
        )}
        {running && <div className="scanner__reticle" aria-hidden="true" />}
      </div>

      {error && <Message severity="error" className="scanner-note" text={error} />}

      <div className="scanner__actions">
        {running ? (
          <Button label="Stop camera" icon="pi pi-stop" severity="secondary" outlined onClick={stop} />
        ) : (
          <Button label="Start camera" icon="pi pi-camera" onClick={start} disabled={disabled} />
        )}
        {running && (
          <span className="scanner__hint">
            Hold a ticket QR in the frame
            {decoder === "bundled" && " · using the bundled reader"}
          </span>
        )}
      </div>
    </div>
  );
}
