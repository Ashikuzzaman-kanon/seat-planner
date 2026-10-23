"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropdown } from "primereact/dropdown";
import { SelectButton } from "primereact/selectbutton";
import { Calendar } from "primereact/calendar";
import { InputSwitch } from "primereact/inputswitch";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { TieredMenu } from "primereact/tieredmenu";
import { Tag } from "primereact/tag";
import DataTable from "@/components/ui/DataTable";
import { fetchAllocationRequests, downloadAllocationRequests, when } from "@/lib/allocation";
import RequestChart from "./RequestChart";
import PublicVisits, { journeyText, OUTCOMES } from "./PublicVisits";

const DHAKA = "Asia/Dhaka";
const n = (x) => Number(x || 0).toLocaleString("en-GB");
const pct = (x) => `${Math.round(x * 100)}%`;
const dayOf = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: DHAKA }).format(d);
const addDays = (iso, k) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
/** A day picked in the calendar, as the day it shows — whatever the browser's time zone. */
const shownDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const GROUP_ORDER = ["Who", "Where", "Journey", "Outcome", "Place & device", "Time"];
const TIME = new Set(["hour", "weekday", "day", "week", "month"]);
const NUMERIC = new Set(["hour", "weekday", "train", "person"]);
const RANGES = [
  { label: "Today", value: 1 },
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "Choose…", value: "custom" },
];
const KINDS = { list: "Search", meta: "Opened the page", status: "Checked the page is open", pass: "Bot check" };
// Until the first answer brings the whole list of fields.
const START = [{ key: "channel", group: "Where", label: "Public page or app" }];

/** How a column sorts: numbers as numbers, days in order, the rest by name. */
const sortable = (key, value, label) => (value === null ? null : NUMERIC.has(key) ? Number(value) : TIME.has(key) ? value : label);

/**
 * Who looks at the seat allocation, and for what — on the public page and in
 * the app. Group the requests by one or two fields, narrow them by any value
 * (a row of the table, a bar of the chart), and see them counted: requests,
 * people, visitors, searches that found nothing; and one by one.
 *
 * Loads when first shown (`active`), and again each time it is shown.
 */
export default function Requests({ active, onLoaded }) {
  const [by, setBy] = useState(["channel"]);
  const [where, setWhere] = useState([]);
  const [range, setRange] = useState(30);
  const [custom, setCustom] = useState(null);
  const [all, setAll] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState({ field: null, order: null });
  const [picked, setPicked] = useState(null);
  const [latestOpen, setLatestOpen] = useState(false);
  const menu = useRef(null);
  const latestRef = useRef(null);
  const shown = useRef(false);

  const today = dayOf(new Date());
  const span = useMemo(() => {
    if (range !== "custom") return { since: addDays(today, -(range - 1)), until: today };
    if (!custom?.[0]) return null;
    return { since: shownDay(custom[0]), until: shownDay(custom[1] || custom[0]) };
  }, [range, custom, today]);
  const ask = useMemo(() => (span ? { by: by.join(","), where, ...span, all } : null), [by, where, span, all]);

  const load = useCallback(async () => {
    if (!ask) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAllocationRequests(ask));
      onLoaded?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [ask, onLoaded]);

  useEffect(() => {
    if (active) shown.current = true;
    if (shown.current) load();
  }, [active, load]);

  // Times in order of time; anything else biggest first, as the server sends it.
  useEffect(() => {
    setSort(TIME.has(by[0]) ? { field: "s0", order: 1 } : { field: null, order: null });
  }, [by]);

  const dimensions = data?.dimensions || START;
  const nameOf = (key) => dimensions.find((d) => d.key === key)?.label || key;
  const options = GROUP_ORDER.map((group) => ({
    label: group,
    items: dimensions.filter((d) => d.group === group).map((d) => ({ label: d.label, value: d.key })),
  })).filter((g) => g.items.length);
  const thenOptions = [
    { label: "Nothing more", items: [{ label: "— nothing more —", value: "" }] },
    ...options.map((g) => ({ ...g, items: g.items.filter((i) => i.value !== by[0]) })),
  ];

  const measure = (data?.ask.all ?? all) ? "Requests" : "Searches";
  const shownBy = data?.ask.by || by;
  const total = data?.totals.requests || 0;
  const rows = useMemo(
    () =>
      (data?.groups || []).map((g, i) => ({
        ...g,
        id: i,
        s0: sortable(data.ask.by[0], g.values[0], g.labels[0]),
        s1: data.ask.by[1] ? sortable(data.ask.by[1], g.values[1], g.labels[1]) : null,
        share: total ? g.requests / total : 0,
      })),
    [data, total]
  );

  /** Narrow to these values, replacing any filter on the same field. */
  const narrow = (adds) => setWhere((w) => [...w.filter((x) => !adds.some((a) => a.key === x.key)), ...adds]);
  const pickedFilters = picked ? shownBy.map((key, i) => ({ key, value: picked.values[i] })) : [];
  const seeOneByOne = () => {
    setLatestOpen(true);
    setTimeout(() => latestRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  };
  const menuModel = picked
    ? [
        { label: picked.labels.join(" · "), disabled: true, className: "rq-menu__picked" },
        {
          label: `See these ${measure.toLowerCase()} one by one`,
          icon: "pi pi-list",
          command: () => {
            narrow(pickedFilters);
            seeOneByOne();
          },
        },
        {
          label: "Break down by",
          icon: "pi pi-sitemap",
          items: options
            .map((g) => ({
              label: g.label,
              items: g.items
                .filter((i) => !shownBy.includes(i.value))
                .map((i) => ({
                  label: i.label,
                  command: () => {
                    narrow(pickedFilters);
                    setBy([i.value]);
                  },
                })),
            }))
            .filter((g) => g.items.length),
        },
      ]
    : [];

  const pickBucket = (p) => {
    const size = data.series.size;
    if (size === "hour") {
      narrow([
        { key: "day", value: p.at.slice(0, 10) },
        { key: "hour", value: String(Number(p.at.slice(11, 13))) },
      ]);
    } else narrow([{ key: size, value: p.at }]);
  };

  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      await downloadAllocationRequests(ask);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="rq">
      <section className="card rq-controls" aria-label="What to count">
        <div className="rq-controls__row">
          <div className="rq-field">
            <span>Days</span>
            <SelectButton
              value={range}
              options={RANGES}
              onChange={(e) => e.value !== null && e.value !== undefined && setRange(e.value)}
              allowEmpty={false}
              className="rq-range"
            />
          </div>
          {range === "custom" && (
            <label className="rq-field">
              <span>From – to</span>
              <Calendar
                value={custom}
                onChange={(e) => setCustom(e.value)}
                selectionMode="range"
                readOnlyInput
                showIcon
                maxDate={new Date()}
                dateFormat="d M yy"
                placeholder="Choose the days"
                inputId="rq-days"
              />
            </label>
          )}
        </div>
        <div className="rq-controls__row">
          <label className="rq-field">
            <span>Group by</span>
            <Dropdown
              inputId="rq-by"
              value={by[0]}
              options={options}
              optionGroupLabel="label"
              optionGroupChildren="items"
              onChange={(e) => setBy((b) => [e.value, ...(b[1] && b[1] !== e.value ? [b[1]] : [])])}
              filter
              filterPlaceholder="Find a field"
            />
          </label>
          <label className="rq-field">
            <span>Then by</span>
            <Dropdown
              inputId="rq-then"
              value={by[1] || ""}
              options={thenOptions}
              optionGroupLabel="label"
              optionGroupChildren="items"
              onChange={(e) => setBy((b) => (e.value ? [b[0], e.value] : [b[0]]))}
              placeholder="— nothing more —"
              filter
              filterPlaceholder="Find a field"
            />
          </label>
          <label className="al-switch rq-all">
            <InputSwitch checked={all} onChange={(e) => setAll(e.value)} />
            <span>Count page opens and bot checks too</span>
          </label>
        </div>
        {where.length > 0 && (
          <div className="rq-chips" aria-label="Only">
            <span className="al-muted">Only</span>
            {where.map((w, i) => {
              const named = data?.filters?.find((f) => f.key === w.key && f.value === w.value);
              return (
                <span className="rq-chip" key={`${w.key}:${w.value}`}>
                  <span>{named?.field || nameOf(w.key)}:</span>
                  <strong>{named?.label ?? (w.value === null ? "none" : w.value)}</strong>
                  <button
                    type="button"
                    aria-label={`Remove ${named?.field || nameOf(w.key)}`}
                    onClick={() => setWhere((ws) => ws.filter((_, j) => j !== i))}
                  >
                    <i className="pi pi-times" aria-hidden="true" />
                  </button>
                </span>
              );
            })}
            <Button label="Clear all" size="small" text onClick={() => setWhere([])} />
          </div>
        )}
      </section>

      {error && <p className="al-warn">{error}</p>}

      {data && (
        <>
          <section className="rq-totals" aria-label="Counted">
            <div className="rq-total">
              <span>{measure}</span>
              <strong>{n(data.totals.requests)}</strong>
              <small>
                {n(data.totals.public)} on the public page · {n(data.totals.app)} in the app
              </small>
            </div>
            <div className="rq-total" title="Accounts signed in">
              <span>People</span>
              <strong>{n(data.totals.people)}</strong>
              <small>signed in</small>
            </div>
            <div className="rq-total" title="Browsers: each keeps a random number for the page">
              <span>Visitors</span>
              <strong>{n(data.totals.visitors)}</strong>
              <small>browsers</small>
            </div>
            <div className="rq-total">
              <span>Found nothing</span>
              <strong>{n(data.totals.nothing)}</strong>
              <small>searches with no pairs</small>
            </div>
          </section>

          <section className="card">
            <RequestChart series={data.series} measure={measure} onPick={pickBucket} />
          </section>

          <section className="card rq-groups">
            <div className="rq-groups__head">
              <h2>
                {measure} by {shownBy.map(nameOf).join(", then ").toLowerCase()}
                <small className="al-muted">
                  {" "}
                  · {n(rows.length)} group{rows.length === 1 ? "" : "s"}
                  {data.truncated ? " (the largest 500)" : ""}
                </small>
              </h2>
              <span className="rq-groups__actions">
                <Button label="Refresh" icon="pi pi-refresh" size="small" text onClick={load} loading={loading} />
                <Button
                  label="Download CSV"
                  icon="pi pi-download"
                  size="small"
                  outlined
                  onClick={download}
                  loading={downloading}
                  disabled={!rows.length}
                />
              </span>
            </div>
            <p className="al-muted rq-hint">Choose a row to see its {measure.toLowerCase()} one by one, or break it down further.</p>
            <DataTable
              value={rows}
              dataKey="id"
              loading={loading}
              paginator={rows.length > 25}
              rows={25}
              sortField={sort.field}
              sortOrder={sort.order}
              onSort={(e) => setSort({ field: e.sortField, order: e.sortOrder })}
              removableSort
              onRowClick={(e) => {
                setPicked(e.data);
                menu.current?.show(e.originalEvent);
              }}
              rowClassName={() => "rq-row"}
              emptyMessage={`No ${measure.toLowerCase()} in these days.`}
              className="rq-table"
            >
              {shownBy.map((key, i) => (
                <Column
                  key={key}
                  header={nameOf(key)}
                  field={`s${i}`}
                  sortable
                  body={(r) => <span className={r.values[i] === null ? "al-muted" : ""}>{r.labels[i]}</span>}
                />
              ))}
              <Column
                header={measure}
                field="requests"
                sortable
                body={(r) => (
                  <span className="rq-count">
                    <strong>{n(r.requests)}</strong>
                    <span className="rq-share" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, r.share * 100)}%` }} />
                    </span>
                    <small>{pct(r.share)}</small>
                  </span>
                )}
              />
              <Column header="People" headerTooltip="Accounts signed in" field="people" sortable body={(r) => n(r.people)} />
              <Column header="Visitors" headerTooltip="Browsers" field="visitors" sortable body={(r) => n(r.visitors)} />
              <Column header="Found nothing" field="nothing" sortable body={(r) => n(r.nothing)} />
              <Column header="Last" field="lastAt" sortable body={(r) => <span className="al-nowrap">{when(r.lastAt)}</span>} />
            </DataTable>
            <TieredMenu model={menuModel} popup ref={menu} className="rq-menu" />
            <p className="al-muted rq-kept">
              Each request is kept {data.keptDays} days; after that only each day&apos;s totals remain.
              {data.earlier && (
                <>
                  {" "}
                  From {data.earlier.from} to {data.earlier.to}, only those totals are left: {n(data.earlier.searches)}{" "}
                  searches ({n(data.earlier.requests)} requests) — not in the groups above.
                </>
              )}
            </p>
          </section>

          <details
            className="card al-visits rq-latest"
            ref={latestRef}
            open={latestOpen}
            onToggle={(e) => setLatestOpen(e.currentTarget.open)}
          >
            <summary>
              <span>One by one</span>
              <small className="al-muted">
                The latest {Math.min(50, data.latest.length)} {measure.toLowerCase()} {where.length ? "that match" : ""}
              </small>
            </summary>
            <div className="al-visits__latest">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Where</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Outcome</th>
                    <th>From</th>
                    <th>Using</th>
                    <th>Came from</th>
                  </tr>
                </thead>
                <tbody>
                  {data.latest.map((v) => {
                    const [label, severity] =
                      v.kind === "pass" && v.outcome === "shown"
                        ? ["Passed", "success"]
                        : OUTCOMES[v.outcome] || [v.outcome, "secondary"];
                    return (
                      <tr key={v.id}>
                        <td className="al-nowrap">{when(v.at)}</td>
                        <td>
                          <Tag value={v.channel === "app" ? "App" : "Public"} severity={v.channel === "app" ? "info" : "secondary"} />
                        </td>
                        <td className="al-break">
                          {v.user ? (
                            <>
                              {v.user.fullName || v.user.email}
                              <span className="al-muted"> · {v.user.email}</span>
                            </>
                          ) : v.visitorId ? (
                            <span className="al-muted">Browser {v.visitorId.slice(0, 8)}…</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {v.kind === "list" ? journeyText(v.query) : KINDS[v.kind] || v.kind}
                          {v.results != null && <span className="al-muted"> · {n(v.results)} found</span>}
                        </td>
                        <td>
                          <Tag value={label} severity={severity} />
                        </td>
                        <td>
                          {v.ip || "—"}
                          <span className="al-muted">
                            {[v.city, v.country].filter(Boolean).length ? ` · ${[v.city, v.country].filter(Boolean).join(", ")}` : ""}
                          </span>
                        </td>
                        <td>{[v.browser, v.os, v.device].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="al-break">{v.referrer || "—"}</td>
                      </tr>
                    );
                  })}
                  {!data.latest.length && (
                    <tr>
                      <td colSpan={8} className="al-muted">
                        Nothing in these days.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      {!data && !error && <p className="al-muted">Loading…</p>}

      <PublicVisits />
    </div>
  );
}
