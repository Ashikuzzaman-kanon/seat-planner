"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "primereact/button";
import { stationLabel, STATUS_LABELS, shortDay, when, cellOf } from "@/lib/allocation";

const GAP = 8;
const EDGE = 8;

/**
 * Where a card goes beside the cell it describes: to the right if it fits,
 * else to the left, else below (or above) — always on the screen. Placed
 * again when the page or the grid scrolls, and when the window resizes.
 */
function usePlacement(anchor, card) {
  const [place, setPlace] = useState(null);

  const measure = useCallback(() => {
    if (!anchor || !card.current) return;
    const a = anchor.getBoundingClientRect();
    const w = card.current.offsetWidth;
    const h = card.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left;
    let top;
    if (a.right + GAP + w <= vw - EDGE) {
      left = a.right + GAP;
      top = a.top;
    } else if (a.left - GAP - w >= EDGE) {
      left = a.left - GAP - w;
      top = a.top;
    } else {
      left = a.left + a.width / 2 - w / 2;
      top = a.bottom + GAP + h <= vh - EDGE ? a.bottom + GAP : a.top - GAP - h;
    }
    left = Math.min(Math.max(left, EDGE), vw - EDGE - w);
    top = Math.min(Math.max(top, EDGE), vh - EDGE - h);
    // Measured after every render: only a real move may render again.
    setPlace((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, [anchor, card]);

  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    if (!anchor) return undefined;
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [anchor, measure]);

  return place;
}

/**
 * Everything about one cell of the grid: its pair, whether it is allocated,
 * every class with its seats (or "count not available") and when each count
 * was last set.
 *
 * Shown at once on hover and gone when the pointer leaves the cell; pinned by
 * a click or a tap, when it stays — with Edit, for whoever manages the data —
 * until it is closed, Escape is pressed, or something else is clicked.
 */
export default function CellCard({ anchor, pair, from, to, classCode, pinned, canManage, onEdit, onClose }) {
  const card = useRef(null);
  const place = usePlacement(anchor, card);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !anchor) return null;

  const status = pair?.status || "not_checked";
  const cell = cellOf(pair, classCode);
  const classes = pair?.classes || [];
  const counted = classes.filter((c) => c.seats !== null);
  const total = counted.reduce((sum, c) => sum + c.seats, 0);

  return createPortal(
    <div
      ref={card}
      className={`al-card is-${status}${pinned ? " is-pinned" : " is-hover"}`}
      style={place ? { left: place.left, top: place.top } : { left: -9999, top: -9999 }}
      role={pinned ? "dialog" : "tooltip"}
      aria-label={`${stationLabel(from)} to ${stationLabel(to)}`}
    >
      <div className="al-card__head">
        <span className="al-card__pair">
          {stationLabel(from)} <i className="pi pi-arrow-right" aria-hidden="true" /> {stationLabel(to)}
        </span>
        {pinned && (
          <button type="button" className="al-card__close" onClick={onClose} aria-label="Close">
            <i className="pi pi-times" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className={`al-card__status tone-${cell.tone}`}>
        {STATUS_LABELS[status]}
        {status === "allocated" && counted.length > 0 && (
          <span>
            {" "}
            · {total.toLocaleString("en-GB")} seats{counted.length < classes.length ? " counted so far" : ""}
          </span>
        )}
      </div>

      {status === "allocated" &&
        (classes.length ? (
          <ul className="al-card__classes">
            {classes.map((c) => (
              <li key={c.code} className={classCode === c.code ? "is-chosen" : ""}>
                <strong>{c.code}</strong>
                {c.seats === null ? (
                  <em>count not available</em>
                ) : (
                  <span className={c.seats === 0 ? "is-zero" : ""}>
                    {c.seats.toLocaleString("en-GB")} seats
                    {c.seatsUpdatedAt && <small title={when(c.seatsUpdatedAt)}> · {shortDay(c.seatsUpdatedAt)}</small>}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="al-card__note">Classes not given</p>
        ))}
      {classCode && status === "allocated" && !classes.some((c) => c.code === classCode) && (
        <p className="al-card__note">{classCode} is not allocated on this pair.</p>
      )}
      {pair?.checkedAt && <p className="al-card__note">Railway checked {when(pair.checkedAt)}</p>}

      {pinned
        ? canManage && (
            <Button
              label={status === "not_checked" ? "Set" : "Edit"}
              size="small"
              outlined
              onClick={onEdit}
              className="al-card__edit"
            />
          )
        : <p className="al-card__hint">Click to keep it open</p>}
    </div>,
    document.body
  );
}
