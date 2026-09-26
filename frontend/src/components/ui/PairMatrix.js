"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "./pair-matrix.css";

/**
 * Seats free between every pair of stations on one departure.
 *
 * Boarding station down the side, alighting station across the top; a cell is
 * "how many seats can be sold from here to there". Only the upper triangle has
 * cells, because a train only runs one way.
 *
 * ## Shared
 *
 * The operator's inventory screen and the passenger's "every pair" view drew
 * this separately, with two copies of the same colour rules. They disagree on
 * nothing except what a click does, so that is the only thing passed in.
 *
 * ## How it reads
 *
 * - **Colour is continuous**, red through amber to green by the share of the
 *   train still free. Four fixed bands made 394 of 404 and 250 of 404 the same
 *   green; a smooth scale shows where a train starts to fill.
 * - **A bar under each number** shows the same share as a length, for anyone
 *   who does not read colour well.
 * - **The hovered row and column light up**, so a cell in the middle of a
 *   ten-by-ten grid can be traced back to both its stations.
 * - **Headers stay put** while the grid scrolls, and a fade at the edge says
 *   there is more to the right — without it a phone showed four columns and no
 *   hint of the other six.
 * - **Every cell is a button**, so the grid works from a keyboard and a screen
 *   reader hears the whole sentence, not a bare number.
 */

/** Red (none free) through amber to green (all free). */
export function heatStyle(available, total) {
  if (!total) return {};
  const ratio = Math.max(0, Math.min(1, available / total));
  if (available === 0) {
    return { "--pm-bg": "#fee2e2", "--pm-ink": "#991b1b", "--pm-bar": "#ef4444", "--pm-fill": "0" };
  }
  // A gentle curve: the colour moves early as a train starts to fill, rather
  // than staying green until it is nearly gone.
  const hue = Math.round(6 + Math.pow(ratio, 1.6) * 132);
  return {
    "--pm-bg": `hsl(${hue} 78% 93%)`,
    "--pm-ink": `hsl(${hue} 70% 24%)`,
    "--pm-bar": `hsl(${hue} 62% 44%)`,
    "--pm-fill": ratio.toFixed(3),
  };
}

const labelOf = (stop) => stop?.station?.code || stop?.station?.name || "—";
const nameOf = (stop) => stop?.station?.name || stop?.station?.code || "";

export default function PairMatrix({
  stops = [],
  pairs = [],
  onPick,
  /** Whether a cell can be chosen. Defaults to "has a seat". */
  canPick = (pair) => pair.available > 0,
  /** Highlights one cell, e.g. the journey the passenger searched for. */
  chosen,
  /** Extra words for a cell that cannot be chosen, for its tooltip. */
  whyNot,
  caption = "Seats free between each pair of stations",
}) {
  const [hover, setHover] = useState(null);
  const frame = useRef(null);
  const scroller = useRef(null);

  const byPair = useMemo(() => {
    const map = new Map();
    for (const p of pairs) map.set(`${p.fromStationId}-${p.toStationId}`, p);
    return map;
  }, [pairs]);

  const froms = stops.slice(0, -1);
  const tos = stops.slice(1);

  /*
   * The edge fade. Set as data attributes rather than state, because it
   * changes on every scroll event and nothing else needs to re-render.
   */
  useEffect(() => {
    const el = scroller.current;
    const box = frame.current;
    if (!el || !box) return undefined;
    const update = () => {
      box.toggleAttribute("data-more-left", el.scrollLeft > 4);
      box.toggleAttribute("data-more-right", el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [stops.length]);

  if (stops.length < 2) return null;

  return (
    <div className="pm-frame" ref={frame}>
      <div className="pm-scroll" ref={scroller} onMouseLeave={() => setHover(null)}>
        <table className="pm">
          <caption className="pm-caption">{caption}</caption>
          <thead>
            <tr>
              <th className="pm-corner" scope="col">
                <span>From</span>
                <i className="pi pi-arrow-down" aria-hidden="true" />
                <span className="pm-corner__to">
                  To <i className="pi pi-arrow-right" aria-hidden="true" />
                </span>
              </th>
              {tos.map((to) => (
                <th
                  key={to.stationId}
                  scope="col"
                  title={nameOf(to)}
                  className={`pm-colhead${hover?.to === to.stationId ? " is-lit" : ""}`}
                >
                  {labelOf(to)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {froms.map((from) => (
              <tr key={from.stationId}>
                <th
                  scope="row"
                  title={nameOf(from)}
                  className={`pm-rowhead${hover?.from === from.stationId ? " is-lit" : ""}`}
                >
                  <strong>{labelOf(from)}</strong>
                  <small>{nameOf(from)}</small>
                </th>
                {tos.map((to) => {
                  const pair = byPair.get(`${from.stationId}-${to.stationId}`);
                  if (!pair) return <td key={to.stationId} className="pm-void" aria-hidden="true" />;

                  const isChosen =
                    chosen &&
                    Number(chosen.fromStationId) === from.stationId &&
                    Number(chosen.toStationId) === to.stationId;
                  const open = canPick(pair);
                  const lit = hover && (hover.from === from.stationId || hover.to === to.stationId);
                  const sentence = `${nameOf(from)} to ${nameOf(to)}: ${pair.available} of ${pair.total} seats free${
                    !open && whyNot ? ` — ${whyNot(pair)}` : ""
                  }`;

                  return (
                    <td key={to.stationId} className={lit ? "is-lit" : undefined}>
                      <button
                        type="button"
                        className={`pm-cell${pair.available === 0 ? " is-none" : ""}${
                          isChosen ? " is-chosen" : ""
                        }`}
                        style={heatStyle(pair.available, pair.total)}
                        disabled={!open || !onPick}
                        onClick={() => open && onPick?.(pair)}
                        onMouseEnter={() => setHover({ from: from.stationId, to: to.stationId })}
                        onFocus={() => setHover({ from: from.stationId, to: to.stationId })}
                        aria-label={sentence}
                        title={sentence}
                      >
                        <span className="pm-cell__n">{pair.available}</span>
                        <span className="pm-cell__bar" aria-hidden="true" />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** What the colours mean. A gradient, because the scale is one. */
export function PairMatrixLegend({ total, note, chosenLabel }) {
  return (
    <div className="pm-legend">
      <span className="pm-legend__scale">
        <small>Sold out</small>
        <i aria-hidden="true" />
        <small>All free</small>
      </span>
      {chosenLabel && (
        <span className="pm-legend__chosen">
          <i aria-hidden="true" /> {chosenLabel}
        </span>
      )}
      {note && <span className="pm-legend__note">{note}</span>}
      {total != null && <span className="pm-legend__total">{total} seats on this train</span>}
    </div>
  );
}
