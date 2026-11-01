"use client";

import "./timebars.css";

const DHAKA = "Asia/Dhaka";
const n = (x) => Number(x || 0).toLocaleString("en-GB");

/** "Thu 22 Oct", "22 Oct, 09:00", "22 Oct, 09:35", "Week from 17 Oct" — a bucket of the chart, in words. */
export function bucketText(size, at) {
  const day = (iso) =>
    new Date(`${iso}T00:00:00+06:00`).toLocaleDateString("en-GB", {
      weekday: size === "day" ? "short" : undefined,
      day: "numeric",
      month: "short",
      timeZone: DHAKA,
    });
  if (size === "5min") return `${day(at.slice(0, 10))}, ${at.slice(11, 16)}`;
  if (size === "hour") return `${day(at.slice(0, 10))}, ${at.slice(11, 13)}:00`;
  if (size === "week") return `Week from ${day(at)}`;
  return day(at);
}

const STEP = { "5min": "every 5 minutes", hour: "an hour", day: "a day", week: "a week" };
const UNIT = { "5min": "5 minutes", hour: "hour", day: "day", week: "week" };

/**
 * Counts over time, as bars — one series, so its title names it and there is
 * no legend. By 5 minutes, hour, day or week, as the span suits. Each bar
 * says its count on hover and is a button: choosing one narrows to it.
 *
 * series:   { size: "5min" | "hour" | "day" | "week", points: [{ at, …counts }] }
 * valueKey: which count the bars show ("events", "requests")
 * measure:  its name ("Events", "Searches")
 * detail:   (point) => more words for a bar's label (optional)
 */
export default function TimeBars({ series, valueKey, measure, detail, onPick, compact = false }) {
  const points = series?.points || [];
  if (!points.length) return null;
  const max = Math.max(1, ...points.map((p) => p[valueKey]));
  const middle = points[Math.floor(points.length / 2)];
  return (
    <figure className={`tb${compact ? " tb--compact" : ""}`}>
      {!compact && (
        <figcaption>
          <span>
            {measure} {STEP[series.size]}
          </span>
          {onPick && <small>Choose a bar to see only that {UNIT[series.size]}</small>}
        </figcaption>
      )}
      <div className="tb-plot">
        <span className="tb-max" aria-hidden="true">
          {n(max)}
        </span>
        <div className="tb-bars">
          {points.map((p) => {
            const text = `${bucketText(series.size, p.at)}: ${n(p[valueKey])} ${measure.toLowerCase()}${detail ? ` · ${detail(p)}` : ""}`;
            const style = { "--h": `${(p[valueKey] / max) * 100}%` };
            return onPick ? (
              <button
                key={p.at}
                type="button"
                className={`tb-bar${p[valueKey] ? "" : " is-empty"}`}
                style={style}
                title={text}
                aria-label={text}
                onClick={() => onPick(p)}
              />
            ) : (
              <span key={p.at} className={`tb-bar${p[valueKey] ? "" : " is-empty"}`} style={style} title={text} />
            );
          })}
        </div>
      </div>
      <div className="tb-axis" aria-hidden="true">
        <span>{bucketText(series.size, points[0].at)}</span>
        {!compact && points.length > 4 && <span>{bucketText(series.size, middle.at)}</span>}
        <span>{bucketText(series.size, points[points.length - 1].at)}</span>
      </div>
    </figure>
  );
}
