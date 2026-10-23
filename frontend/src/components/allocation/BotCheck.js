"use client";

import { useEffect, useRef, useState } from "react";

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading = null;

function loadTurnstile() {
  if (typeof window === "undefined") return Promise.reject(new Error("No browser"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve(window.turnstile);
      s.onerror = () => {
        loading = null;
        reject(new Error("The check that you are not a robot could not load. Check your connection and reload."));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/**
 * The check that a visitor is not a robot: Cloudflare Turnstile. Most people
 * never see it — it decides on its own and calls back with a token. Only when
 * unsure does it show a box to tick.
 */
export default function BotCheck({ siteKey, onToken, onError }) {
  const box = useRef(null);
  const widget = useRef(null);
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    let alive = true;
    loadTurnstile()
      .then((turnstile) => {
        if (!alive || !box.current) return;
        widget.current = turnstile.render(box.current, {
          sitekey: siteKey,
          appearance: "interaction-only",
          callback: (token) => onToken(token),
          "error-callback": () => {
            setFailed("The check that you are not a robot did not work. Reload the page to try again.");
            onError?.();
          },
          "expired-callback": () => turnstile.reset(widget.current),
        });
      })
      .catch((err) => {
        if (alive) {
          setFailed(err.message);
          onError?.();
        }
      });
    return () => {
      alive = false;
      try {
        if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      } catch {
        /* already gone */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  return (
    <div className="pub-botcheck">
      <div ref={box} />
      {failed && <p className="al-warn">{failed}</p>}
    </div>
  );
}
