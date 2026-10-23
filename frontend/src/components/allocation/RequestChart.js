"use client";

const DHAKA = "Asia/Dhaka";
const n = (x) => Number(x || 0).toLocaleString("en-GB");

/** "Thu 22 Oct", "22 Oct, 09:00", "Week from 17 Oct" — a bucket of the chart, in words. */
export function bucketText(size, at) {
  const day = (iso) =>
    new Date(`${iso}T00:00:00+06:00`).toLocaleDateString("en-GB", {
      weekday: size === "day" ? "short" : undefined,
      day: "numeric",
      month: "short",
      timeZone: DHAKA,
    });
  if (size === "hour") return `${day(at.slice(0, 10))}, ${at.slice(11, 13)}:00`;
  if (size === "week") return `Week from ${day(at)}`;
  return day(at);
}

/**
 * The requests over time, as bars: by hour over a day or two, by day up to
 * three months, by week beyond. A bar is a button — choosing one narrows
 * everything to that hour, day or week.
 */
export default function RequestChart({ series, measure, onPick }) {
  const points = series?.points || [];
  if (!points.length) return null;
  const max = Math.max(1, ...points.map((p) => p.requests));
  const every = series.size === "hour" ? "an hour" : series.size === "week" ? "a week" : "a day";
  const middle = points[Math.floor(points.length / 2)];
  return (
    <figure className="rq-chart">
      <figcaption>
        <span>
          {measure} {every}
        </span>
        <small className="al-muted">Choose a bar to see only that {series.size}</small>
      </figcaption>
      <div className="rq-chart__plot">
        <span className="rq-chart__max" aria-hidden="true">
          {n(max)}
        </span>
        <div className="rq-chart__bars">
          {points.map((p) => {
            const text = `${bucketText(series.size, p.at)}: ${n(p.requests)} ${measure.toLowerCase()} · ${n(p.people)} people · ${n(p.visitors)} visitors`;
            return (
              <button
                key={p.at}
                type="button"
                className={`rq-chart__bar${p.requests ? "" : " is-empty"}`}
                style={{ "--h": `${(p.requests / max) * 100}%` }}
                title={text}
                aria-label={text}
                onClick={() => onPick(p)}
              />
            );
          })}
        </div>
      </div>
      <div className="rq-chart__axis" aria-hidden="true">
        <span>{bucketText(series.size, points[0].at)}</span>
        {points.length > 4 && <span>{bucketText(series.size, middle.at)}</span>}
        <span>{bucketText(series.size, points[points.length - 1].at)}</span>
      </div>
    </figure>
  );
}
