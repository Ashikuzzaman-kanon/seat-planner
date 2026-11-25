"use client";

import Link from "next/link";

/**
 * What a switched-off tab shows in place of its page (Settings → Features).
 *
 * The tab is already gone from the menu; this is for the other ways in — a
 * bookmark, a link in an email or a notification, a button on another page.
 * It says only that the page is unavailable for now, with whatever message the
 * super admin left, never who it is off for.
 */
export default function FeatureUnavailable({ label, message, homeHref }) {
  return (
    <div className="feature-off" role="status">
      <div className="feature-off__card">
        <i className="pi pi-pause-circle" aria-hidden="true" />
        <h1>{label ? `${label} is unavailable` : "Temporarily unavailable"}</h1>
        <p>This part of Seat Planner is switched off for now.</p>
        {message && <p className="feature-off__message">{message}</p>}
        {homeHref && (
          <Link href={homeHref} className="feature-off__home">
            <i className="pi pi-arrow-left" aria-hidden="true" /> Back to Seat Planner
          </Link>
        )}
      </div>
    </div>
  );
}
