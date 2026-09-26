"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "primereact/button";
import { fetchMyHolds, releaseHold } from "@/lib/booking";
import HoldTimer from "./HoldTimer";

/**
 * "You still have seats held."
 *
 * Seats are held for ten minutes while someone pays. Until now that hold lived
 * only in the booking page's memory, so closing the tab, following a link, or
 * signing out stranded a passenger with seats they still owned and no way back
 * to them — they waited out the timer, or bought the same seats again.
 *
 * The seats were never lost. Only the door was missing.
 *
 * Renders nothing when there is nothing to resume, so it can sit on any page
 * without making an empty box.
 */
export default function OpenCheckouts({ onChanged }) {
  const router = useRouter();
  const [holds, setHolds] = useState([]);
  const [releasing, setReleasing] = useState(null);

  const load = useCallback(async () => {
    try {
      setHolds(await fetchMyHolds());
    } catch {
      // A passenger who cannot read their holds simply sees no banner; this is
      // an offer of help, not a feature to fail loudly.
      setHolds([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const giveUp = async (hold) => {
    setReleasing(hold.reference);
    try {
      await releaseHold(hold.reference);
      await load();
      onChanged?.();
    } finally {
      setReleasing(null);
    }
  };

  if (!holds.length) return null;

  return (
    <div className="open-checkouts">
      {holds.map((hold) => (
        <article key={hold.reference} className="open-checkout">
          <div className="open-checkout__body">
            <strong>
              {hold.seats.length} seat{hold.seats.length === 1 ? "" : "s"} still held
              {hold.train ? ` on ${hold.train.name}` : ""}
            </strong>
            <span>
              {hold.fromStation} → {hold.toStation}
              {hold.departureDate && <em> · {hold.departureDate}</em>}
            </span>
            {hold.seats.length > 0 && (
              <small>
                {hold.seats
                  .map((s) => `${s.coachCode ? `${s.coachCode} ` : ""}${s.seatNumber}`)
                  .join(" · ")}
              </small>
            )}
          </div>

          <div className="open-checkout__side">
            {/* The countdown is the whole reason to act now. */}
            <HoldTimer expiresAt={hold.expiresAt} onExpire={load} />

            <div className="open-checkout__actions">
              <Button
                label="Give up"
                text
                size="small"
                severity="secondary"
                loading={releasing === hold.reference}
                onClick={() => giveUp(hold)}
              />
              <Button
                label="Finish paying"
                icon="pi pi-angle-right"
                iconPos="right"
                size="small"
                onClick={() => router.push(`/dashboard/book?resume=${hold.reference}`)}
              />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
