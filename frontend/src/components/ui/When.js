/**
 * A moment in a table cell: the date on one line, the time under it, muted.
 *
 * `toLocaleString()` in a narrow column broke "9/23/2026, 11:30:29 PM" over
 * three lines at arbitrary points, and month-first order misreads outside the
 * US. Day-month-year with a named month cannot be misread, and two fixed lines
 * keep every row the same height. The full timestamp is on hover.
 *
 * `extra` is an optional third line (a request id, a reference).
 */
export default function When({ value, time = true, extra }) {
  if (!value) return <span className="ui-when ui-when--none">—</span>;

  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return <span className="ui-when ui-when--none">—</span>;

  const date = at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const clock = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <time className="ui-when" dateTime={at.toISOString()} title={at.toLocaleString("en-GB")}>
      <span>{date}</span>
      {time && <small>{clock}</small>}
      {extra && <small className="ui-when__extra">{extra}</small>}
    </time>
  );
}
