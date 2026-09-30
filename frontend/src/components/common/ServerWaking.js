"use client";

import { useEffect, useState } from "react";
import { setServerWakingHandler } from "@/lib/api";
import "./server-waking.css";

/**
 * "Starting the server…", shown while requests wait for a sleeping API to
 * wake (see "Waking a sleeping server" in lib/api.js).
 *
 * Without it the page would sit on a spinner for half a minute with no
 * explanation. It appears only after a request has actually been refused, so
 * nobody sees it while the server is awake.
 */
export default function ServerWaking() {
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    setServerWakingHandler(setWaking);
    return () => setServerWakingHandler(null);
  }, []);

  if (!waking) return null;

  return (
    <div className="server-waking" role="status" aria-live="polite">
      <i className="pi pi-spin pi-spinner" aria-hidden="true" />
      <span>
        <strong>Starting the server…</strong> It sleeps when nobody has used it for a while. This takes
        about half a minute; your request carries on by itself.
      </span>
    </div>
  );
}
