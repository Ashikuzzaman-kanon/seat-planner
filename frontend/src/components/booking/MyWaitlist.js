"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { confirmDialog } from "primereact/confirmdialog";
import {
  fetchMyWaitlist,
  leaveWaitlist,
  quoteWaitlistOffer,
  confirmWaitlistOffer,
  declineWaitlistOffer,
  formatTaka,
  WAITLIST_STATUS_LABELS,
} from "@/lib/booking";

/**
 * Queue places, and the offers they turn into.
 *
 * Renders nothing when there is nothing open, so it can sit above any page.
 *
 * An offer is the urgent part: a seat is held in this passenger's name and out
 * of sale for everyone else until they answer. So an offered entry is a
 * different-looking card with a countdown, a price, and one button — the whole
 * point of capturing passenger details at join time is that this needs no form.
 */

const SEVERITY = {
  waiting: "info",
  offered: "warning",
  confirmed: "success",
  declined: "secondary",
  lapsed: "secondary",
  withdrawn: "secondary",
  closed: "secondary",
};

function Countdown({ until, onElapse }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((new Date(until) - Date.now()) / 1000)));

  useEffect(() => {
    const tick = setInterval(() => {
      const next = Math.max(0, Math.round((new Date(until) - Date.now()) / 1000));
      setLeft(next);
      if (next === 0) onElapse?.();
    }, 1000);
    return () => clearInterval(tick);
  }, [until, onElapse]);

  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");
  return (
    <span className={`waitlist-clock${left < 300 ? " is-urgent" : ""}`}>
      <i className="pi pi-clock" aria-hidden="true" /> {minutes}:{seconds}
    </span>
  );
}

export default function MyWaitlist({ onChanged, showClosed = false }) {
  const [entries, setEntries] = useState([]);
  const [prices, setPrices] = useState({});
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      setEntries(await fetchMyWaitlist());
    } catch {
      // Not being able to read your queue is not worth an error banner; it is
      // an offer of help, not a feature to fail loudly.
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Price every open offer, so the confirm button can say what it costs. A
  // one-click button that does not name its price is not a fair one.
  useEffect(() => {
    const open = entries.filter((e) => e.status === "offered");
    if (!open.length) return;

    let cancelled = false;
    Promise.all(
      open.map((e) =>
        quoteWaitlistOffer(e.reference)
          .then((q) => [e.reference, q])
          .catch(() => [e.reference, null])
      )
    ).then((pairs) => {
      if (!cancelled) setPrices(Object.fromEntries(pairs));
    });

    return () => {
      cancelled = true;
    };
  }, [entries]);

  const act = async (reference, fn) => {
    setBusy(reference);
    try {
      await fn();
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  };

  const take = (entry) => act(entry.reference, () => confirmWaitlistOffer(entry.reference));

  const turnDown = (entry) =>
    confirmDialog({
      message:
        "The seat goes straight to the next person waiting, and you stay in the queue for another one.",
      header: "Turn this seat down?",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Yes, pass it on",
      rejectLabel: "Keep it",
      accept: () => act(entry.reference, () => declineWaitlistOffer(entry.reference)),
    });

  const leave = (entry) =>
    confirmDialog({
      message:
        entry.status === "offered"
          ? "This gives up the seat being held for you and leaves the queue."
          : "You will lose your place in the queue.",
      header: "Leave the queue?",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Yes, leave",
      rejectLabel: "Stay",
      accept: () => act(entry.reference, () => leaveWaitlist(entry.reference)),
    });

  const shown = showClosed ? entries : entries.filter((e) => e.status === "waiting" || e.status === "offered");
  if (!shown.length) return null;

  return (
    <div className="waitlist-list">
      {shown.map((entry) => {
        const offered = entry.status === "offered" && entry.offer;
        const quote = prices[entry.reference];

        return (
          <article
            key={entry.reference}
            className={`waitlist-card${offered ? " is-offered" : ""}`}
          >
            <div className="waitlist-card__body">
              <div className="waitlist-card__title">
                <strong>
                  {entry.train?.name || "Queued"}
                  {entry.seatCount > 1 ? ` · ${entry.seatCount} seats` : ""}
                </strong>
                <Tag
                  value={WAITLIST_STATUS_LABELS[entry.status] || entry.status}
                  severity={SEVERITY[entry.status] || "info"}
                />
              </div>

              <span className="waitlist-card__journey">
                {entry.fromStation} → {entry.toStation}
                {entry.departureDate && <em> · {entry.departureDate}</em>}
                {entry.coachClass && <em> · {entry.coachClass} only</em>}
              </span>

              {entry.status === "waiting" && (
                <small className="waitlist-card__place">
                  {entry.position === 1
                    ? "You are next in line — the first seat returned is yours"
                    : `Number ${entry.position} in the queue`}
                </small>
              )}

              {offered && (
                <small className="waitlist-card__seats">
                  Held for you:{" "}
                  {entry.offer.seats
                    .map((s) => `${s.coachCode ? `${s.coachCode} ` : ""}${s.seatNumber}`)
                    .join(" · ")}
                </small>
              )}
            </div>

            <div className="waitlist-card__side">
              {offered && (
                <>
                  <Countdown until={entry.offerExpiresAt} onElapse={load} />
                  <div className="waitlist-card__actions">
                    <Button
                      label="Not this one"
                      text
                      size="small"
                      severity="secondary"
                      onClick={() => turnDown(entry)}
                      disabled={busy === entry.reference}
                    />
                    <Button
                      label={
                        quote ? `Take it — ${formatTaka(quote.totalMinor)}` : "Take the seat"
                      }
                      icon="pi pi-check"
                      size="small"
                      onClick={() => take(entry)}
                      loading={busy === entry.reference}
                    />
                  </div>
                  <small className="waitlist-card__paid">Paid from your wallet balance</small>
                </>
              )}

              {entry.status === "waiting" && (
                <Button
                  label="Leave queue"
                  text
                  size="small"
                  severity="secondary"
                  onClick={() => leave(entry)}
                  loading={busy === entry.reference}
                />
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
