"use client";

import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { stationLabel, STATUS_LABELS, when, shortDay, cellOf } from "@/lib/allocation";

/**
 * Each class with its seats — or "count not available", never a 0 that is not
 * one — and when a count was last set.
 */
export function ClassChips({ classes }) {
  if (!classes.length) return <span className="al-muted">Classes not given</span>;
  return (
    <span className="al-classes">
      {classes.map((c) => (
        <span
          key={c.code}
          className={`al-class${c.seats === null ? " is-unknown" : ""}`}
          title={c.seats !== null && c.seatsUpdatedAt ? `Count set ${when(c.seatsUpdatedAt)}` : undefined}
        >
          <strong>{c.code}</strong>
          {c.seats === null ? <em>count not available</em> : <span>{c.seats.toLocaleString("en-GB")} seats</span>}
          {c.seats !== null && c.seatsUpdatedAt && <small>updated {shortDay(c.seatsUpdatedAt)}</small>}
        </span>
      ))}
    </span>
  );
}

const SEVERITY = { not_allocated: "secondary", not_checked: "warning" };

/** What the grid's cells mean — for the class chosen, if one is. */
export function GridLegend({ classCode }) {
  return (
    <div className="al-legend" aria-hidden="true">
      {classCode && <strong className="al-legend__class">{classCode}</strong>}
      <span className="al-cell is-allocated">✓</span> allocated, count not known
      <span className="al-cell is-allocated">120</span> seats set aside
      {!classCode && (
        <>
          <span className="al-cell is-allocated">80+</span> more in classes not counted
        </>
      )}
      <span className="al-cell is-zero">0</span> none set aside
      <span className="al-cell is-not_allocated" /> {classCode ? `${classCode} not allocated` : "not allocated"}
      <span className="al-cell is-not_checked" /> not checked
    </div>
  );
}

/** The pairs as a list, one card each. */
export function PairList({ items, oneTrain, canManage, onEdit }) {
  return (
    <ul className="al-list">
      {items.map((p) => (
        <li key={`${p.train.number}|${p.from}|${p.to}`} className={`al-pair is-${p.status}`}>
          <div className="al-pair__head">
            {!oneTrain && (
              <span className="al-train">
                <strong>{p.train.number}</strong> {p.train.name}
              </span>
            )}
            <span className="al-journey">
              {stationLabel(p.from)} <i className="pi pi-arrow-right" aria-hidden="true" /> {stationLabel(p.to)}
            </span>
            {p.status !== "allocated" && <Tag value={STATUS_LABELS[p.status]} severity={SEVERITY[p.status]} />}
            {p.onRoute === false && <Tag value="Not on its route" severity="danger" />}
          </div>
          {p.status === "allocated" && <ClassChips classes={p.classes} />}
          <div className="al-pair__foot">
            <small className="al-muted">
              {p.checkedAt
                ? `Checked ${when(p.checkedAt)}${p.source === "manual" ? " · set by hand" : ""}`
                : p.status === "not_checked"
                ? "Not checked yet"
                : p.source === "manual"
                ? "Set by hand"
                : "From the census"}
            </small>
            {canManage && (
              <Button
                label={p.status === "not_checked" ? "Set" : "Edit"}
                size="small"
                text
                onClick={() => onEdit(p)}
                aria-label={`Edit ${p.train.number} ${stationLabel(p.from)} to ${stationLabel(p.to)}`}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * One train's pairs as a grid: boarding stations down the side, destinations
 * across the top, in route order. A number in a cell is only ever seats: of
 * the class chosen, or of every class added up (see cellOf).
 */
export function PairGrid({ route, items, selected, onSelect, classCode = null }) {
  const cells = new Map(items.map((p) => [`${p.from}|${p.to}`, p]));
  const pos = new Map(route.map((s, i) => [s, i]));
  return (
    <div className="al-grid-wrap">
      <table className="al-grid">
        <thead>
          <tr>
            <th className="al-grid__corner">
              From <i className="pi pi-arrow-down" aria-hidden="true" /> to <i className="pi pi-arrow-right" aria-hidden="true" />
            </th>
            {route.slice(1).map((s) => (
              <th key={s} className="al-grid__to" scope="col">
                <span>{stationLabel(s)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {route.slice(0, -1).map((from, i) => (
            <tr key={from}>
              <th scope="row" className="al-grid__from">
                {stationLabel(from)}
              </th>
              {route.slice(1).map((to) => {
                const j = pos.get(to);
                if (j <= i) return <td key={to} className="al-grid__none" />;
                const p = cells.get(`${from}|${to}`);
                const status = p?.status || "not_checked";
                const cell = cellOf(p, classCode);
                const on = selected && selected.from === from && selected.to === to;
                const label = `${stationLabel(from)} to ${stationLabel(to)}: ${STATUS_LABELS[status]}${
                  cell.note ? ` (${cell.note})` : ""
                }${p?.classes?.length ? ` — ${p.classes.map((c) => `${c.code} ${c.seats ?? "count not available"}`).join(", ")}` : ""}`;
                return (
                  <td key={to}>
                    <button
                      type="button"
                      className={`al-cell is-${cell.tone}${on ? " is-selected" : ""}`}
                      title={label}
                      aria-label={label}
                      onClick={() => onSelect(p || null, from, to)}
                    >
                      {cell.text}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
