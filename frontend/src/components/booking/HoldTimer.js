"use client";

import { useEffect, useState } from "react";

/**
 * The countdown on held seats.
 *
 * Counts down locally from the server's `expiresAt` rather than polling: the
 * seats are already reserved, so the only thing changing is the clock, and a
 * request per second to learn that would be waste. `onExpire` fires once when
 * it runs out, so the step above can send the passenger back to choose again
 * instead of letting them fill in a form for seats they no longer hold.
 */
export default function HoldTimer({ expiresAt, onExpire }) {
  const [remaining, setRemaining] = useState(() => secondsUntil(expiresAt));
  const expired = remaining <= 0;

  useEffect(() => {
    setRemaining(secondsUntil(expiresAt));

    const timer = setInterval(() => {
      const left = secondsUntil(expiresAt);
      setRemaining(left);
      if (left <= 0) clearInterval(timer);
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt]);

  // Separate from the interval so it fires once on the transition, not on every
  // tick after zero.
  useEffect(() => {
    if (expired) onExpire?.();
  }, [expired]); // eslint-disable-line react-hooks/exhaustive-deps

  if (expired) {
    return <span className="hold-timer is-out">Seats released</span>;
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");
  const urgent = remaining <= 60;

  return (
    <span className={`hold-timer${urgent ? " is-urgent" : ""}`} role="timer">
      <i className="pi pi-clock" aria-hidden="true" />
      <strong>
        {minutes}:{seconds}
      </strong>
      <small>{urgent ? "left — finish now" : "to complete payment"}</small>
    </span>
  );
}

function secondsUntil(expiresAt) {
  if (!expiresAt) return 0;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}
