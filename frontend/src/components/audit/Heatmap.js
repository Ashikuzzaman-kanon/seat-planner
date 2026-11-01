"use client";

const n = (x) => Number(x || 0).toLocaleString("en-GB");
const two = (h) => String(h).padStart(2, "0");
export const hourText = (h) => `${two(h)}:00–${two((h + 1) % 24)}:00`;
/** 11687 → "11.7k": a column total in a narrow column. */
const short = (x) => (x >= 10000 ? `${Math.round(x / 1000)}k` : x >= 1000 ? `${(x / 1000).toFixed(1)}k` : String(x));
const sum = (list) => list.reduce((s, x) => s + x, 0);

/** A square's colour: one hue, light to dark with the count — the brand's own ramp. */
const shade = (count, max) =>
  count ? `color-mix(in oklab, var(--brand-700) ${Math.round(12 + (88 * count) / max)}%, var(--brand-50))` : undefined;

/** The busiest day and hour, in words: "Friday, 11:00–12:00". */
export function busiest(rows) {
  let best = null;
  rows.forEach((r) => r.hours.forEach((c, h) => (!best || c > best.count) && c && (best = { day: r.name, hour: h, count: c })));
  return best ? `${best.day}, ${hourText(best.hour)}` : null;
}

/**
 * Events by day of the week and hour of the day: seven rows (Saturday first,
 * as the week runs here), twenty-four squares each, darker for more. Each
 * square says its count on hover and, given onPick, narrows to that day and
 * hour. Totals at the ends of the rows and under the hours.
 *
 * rows: [{ weekday: 1…7, name, hours: [24 counts] }]
 */
export default function Heatmap({ rows, measure = "events", onPick, compact = false }) {
  if (!rows?.length) return null;
  const max = Math.max(1, ...rows.flatMap((r) => r.hours));
  const byHour = Array.from({ length: 24 }, (_, h) => sum(rows.map((r) => r.hours[h])));
  const peak = busiest(rows);
  return (
    <figure className={`hm${compact ? " hm--compact" : ""}`}>
      {!compact && (
        <figcaption>
          <span>By day of the week and hour</span>
          <small>
            {peak ? `Busiest: ${peak}` : "Nothing in these days"}
            {onPick && peak ? " · Choose a square to see only that day and hour" : ""}
          </small>
        </figcaption>
      )}
      <div className="hm-scroll">
        <div className="hm-grid" role="table" aria-label={`${measure} by day of the week and hour`}>
          <span role="columnheader" />
          {byHour.map((_, h) => (
            <span key={h} role="columnheader" className="hm-hour">
              {h % 3 === 0 ? two(h) : ""}
            </span>
          ))}
          {!compact && <span role="columnheader" className="hm-total">All</span>}
          {rows.map((r) => (
            <div key={r.weekday} role="row" className="hm-row">
              <span role="rowheader" className="hm-day">
                {r.name.slice(0, 3)}
              </span>
              {r.hours.map((count, h) => {
                const text = `${r.name}, ${hourText(h)}: ${n(count)} ${measure}`;
                const style = { background: shade(count, max) };
                return onPick ? (
                  <button
                    key={h}
                    type="button"
                    role="cell"
                    className={`hm-cell${count ? "" : " is-empty"}`}
                    style={style}
                    title={text}
                    aria-label={text}
                    onClick={() => onPick(r.weekday, h)}
                  />
                ) : (
                  <span key={h} role="cell" className={`hm-cell${count ? "" : " is-empty"}`} style={style} title={text} />
                );
              })}
              {!compact && (
                <span role="cell" className="hm-total">
                  {n(sum(r.hours))}
                </span>
              )}
            </div>
          ))}
          {!compact && (
            <div role="row" className="hm-row hm-row--totals">
              <span role="rowheader" className="hm-day">
                All
              </span>
              {byHour.map((c, h) => (
                <span key={h} role="cell" className="hm-colsum" title={`${hourText(h)}: ${n(c)} ${measure}`}>
                  {c ? short(c) : ""}
                </span>
              ))}
              <span role="cell" className="hm-total">
                {n(sum(byHour))}
              </span>
            </div>
          )}
        </div>
      </div>
      {!compact && (
        <div className="hm-legend" aria-hidden="true">
          <span>Fewer</span>
          {[0.12, 0.34, 0.56, 0.78, 1].map((v) => (
            <i key={v} style={{ background: `color-mix(in oklab, var(--brand-700) ${Math.round(v * 100)}%, var(--brand-50))` }} />
          ))}
          <span>More</span>
        </div>
      )}
    </figure>
  );
}
