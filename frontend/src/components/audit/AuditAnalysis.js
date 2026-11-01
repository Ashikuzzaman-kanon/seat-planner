"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropdown } from "primereact/dropdown";
import { MultiSelect } from "primereact/multiselect";
import { AutoComplete } from "primereact/autocomplete";
import { SelectButton } from "primereact/selectbutton";
import { Calendar } from "primereact/calendar";
import { Checkbox } from "primereact/checkbox";
import { InputSwitch } from "primereact/inputswitch";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { TieredMenu } from "primereact/tieredmenu";
import { Message } from "primereact/message";
import DataTable from "@/components/ui/DataTable";
import TimeBars from "@/components/ui/TimeBars";
import { fetchAuditAnalysis, downloadAuditAnalysis, searchAuditPeople } from "@/lib/audit";
import { whenBody, actionBody, actorBody, entityBody, expansion } from "./eventCells";
import Heatmap, { busiest } from "./Heatmap";
import "./audit.css";

const DHAKA = "Asia/Dhaka";
const REFRESH_MS = 30_000;
const n = (x) => Number(x || 0).toLocaleString("en-GB");
const shareText = (x) => (x > 0 && x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`);
const pct = (x) => (x > 0 && x < 0.01 ? "under 1%" : `${Math.round(x * 100)}%`);
const dayOf = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: DHAKA }).format(d);
const addDays = (iso, k) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
/** A day picked in the calendar, as the day it shows — whatever the browser's time zone. */
const shownDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const two = (h) => String(h).padStart(2, "0");

const RANGES = [
  { label: "Last hour", value: "1h" },
  { label: "Today", value: 1 },
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "Choose…", value: "custom" },
];
// Saturday first, as the week runs here. Values as the server counts them: 1 Sunday … 7 Saturday.
const WEEKDAYS = [
  { label: "Sat", value: 7 },
  { label: "Sun", value: 1 },
  { label: "Mon", value: 2 },
  { label: "Tue", value: 3 },
  { label: "Wed", value: 4 },
  { label: "Thu", value: 5 },
  { label: "Fri", value: 6 },
];
const FROM_HOURS = [{ label: "Any time", value: null }, ...Array.from({ length: 24 }, (_, h) => ({ label: `${two(h)}:00`, value: h }))];
const TO_HOURS = Array.from({ length: 24 }, (_, h) => ({ label: `${two(h + 1)}:00`, value: h + 1 }));
const OUTCOMES = [
  { label: "Any", value: "any" },
  { label: "Succeeded", value: "success" },
  { label: "Failed", value: "failure" },
];
const GROUP_ORDER = ["What", "Who", "Device", "Time"];
const TIME = new Set(["hour", "weekday", "day", "week", "month"]);
const NUMERIC = new Set(["hour", "weekday", "person"]);
const NO_ONE = { id: null, label: "No one signed in" };
// Until the first answer brings the whole list of fields.
const START = [{ key: "action", group: "What", label: "Operation" }];

const sortable = (key, value, label) => (value === null ? null : NUMERIC.has(key) ? Number(value) : TIME.has(key) ? value : label);

/**
 * The audit log analysed. Pick the events — operations or whole groups of
 * them, people, outcome, the last hour or days, hours of the day, days of the
 * week — and see them counted: in all, over time, by weekday and hour, and
 * grouped by one or two fields. Two to five people chosen: each side by side.
 * A row, a bar or a square narrows to itself; the events one by one beneath.
 *
 * Loads when first shown (`active`), and again each time it is shown — and
 * every 30 seconds while "Refresh every 30 s" is on.
 */
export default function AuditAnalysis({ active }) {
  const [range, setRange] = useState(30);
  const [custom, setCustom] = useState(null);
  const [fromHour, setFromHour] = useState(null);
  const [toHour, setToHour] = useState(null);
  const [days, setDays] = useState([]);
  const [ops, setOps] = useState([]);
  const [people, setPeople] = useState([]);
  const [found, setFound] = useState([]);
  const [outcome, setOutcome] = useState("any");
  const [hideTests, setHideTests] = useState(true);
  const [by, setBy] = useState(["action"]);
  const [where, setWhere] = useState([]);
  const [live, setLive] = useState(false);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState({ field: null, order: null });
  const [picked, setPicked] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [latestOpen, setLatestOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const menu = useRef(null);
  const latestRef = useRef(null);
  const shown = useRef(false);

  const today = dayOf(new Date());
  const named = people.filter((p) => p.id !== null);
  const ask = useMemo(() => {
    let span;
    if (range === "1h") span = { last: 60 };
    else if (range === "custom") {
      if (!custom?.[0]) return null;
      span = { since: shownDay(custom[0]), until: shownDay(custom[1] || custom[0]) };
    } else span = { since: addDays(today, -(range - 1)), until: today };
    return {
      ...span,
      actions: ops.filter((v) => !v.startsWith("area:")),
      areas: ops.filter((v) => v.startsWith("area:")).map((v) => v.slice(5)),
      people: people.map((p) => p.id),
      outcome: outcome === "any" ? null : outcome,
      hours: fromHour !== null && toHour !== null && fromHour !== toHour % 24 ? `${fromHour}-${toHour}` : null,
      days,
      tests: !hideTests,
      by,
      where,
      compare: named.length >= 2 && named.length <= 5,
    };
  }, [range, custom, today, ops, people, outcome, fromHour, toHour, days, hideTests, by, where, named.length]);

  const load = useCallback(
    async (quiet = false) => {
      if (!ask) return;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        setData(await fetchAuditAnalysis(ask));
      } catch (err) {
        setError(err.message);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [ask]
  );

  useEffect(() => {
    if (active) shown.current = true;
    if (shown.current) load();
  }, [active, load]);

  useEffect(() => {
    if (!live || !active) return undefined;
    const timer = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, active, load]);

  // Times in order of time; anything else biggest first, as the server sends it.
  useEffect(() => {
    setSort(TIME.has(by[0]) ? { field: "s0", order: 1 } : { field: null, order: null });
  }, [by]);

  const dimensions = data?.dimensions || START;
  const nameOf = (key) => dimensions.find((d) => d.key === key)?.label || key;
  const fieldOptions = GROUP_ORDER.map((group) => ({
    label: group,
    items: dimensions.filter((d) => d.group === group).map((d) => ({ label: d.label, value: d.key })),
  })).filter((g) => g.items.length);
  const thenOptions = [
    { label: "Nothing more", items: [{ label: "— nothing more —", value: "" }] },
    ...fieldOptions.map((g) => ({ ...g, items: g.items.filter((i) => i.value !== by[0]) })),
  ];
  const opOptions = useMemo(() => {
    const all = data?.operations || [];
    const areas = [...new Set(all.map((a) => a.split(".")[0]))];
    return areas.map((area) => ({
      label: area,
      items: [
        { label: `Every ${area} operation`, value: `area:${area}` },
        ...all.filter((a) => a.startsWith(`${area}.`)).map((a) => ({ label: a, value: a })),
      ],
    }));
  }, [data?.operations]);

  const shownBy = data?.ask?.by || by;
  const total = data?.totals?.events || 0;
  const rows = useMemo(
    () =>
      (data?.groups || []).map((g, i) => ({
        ...g,
        id: i,
        s0: sortable(data.ask.by[0], g.values[0], g.labels[0]),
        s1: data.ask.by[1] ? sortable(data.ask.by[1], g.values[1], g.labels[1]) : null,
        share: total ? g.events / total : 0,
      })),
    [data, total]
  );

  /** Narrow to these values, replacing any filter on the same field. */
  const narrow = (adds) => setWhere((w) => [...w.filter((x) => !adds.some((a) => a.key === x.key)), ...adds]);
  const seeOneByOne = () => {
    setLatestOpen(true);
    setTimeout(() => latestRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  };
  const pickedFilters = picked ? shownBy.map((key, i) => ({ key, value: picked.values[i] })) : [];
  const menuModel = picked
    ? [
        { label: picked.labels.join(" · "), disabled: true, className: "aa-menu__picked" },
        {
          label: "See these events one by one",
          icon: "pi pi-list",
          command: () => {
            narrow(pickedFilters);
            seeOneByOne();
          },
        },
        {
          label: "Break down by",
          icon: "pi pi-sitemap",
          items: fieldOptions
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
  const pickSquare = (weekday, hour) =>
    narrow([
      { key: "weekday", value: String(weekday) },
      { key: "hour", value: String(hour) },
    ]);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadAuditAnalysis(ask);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  const findPeople = async (e) => {
    try {
      const list = await searchAuditPeople(e.query);
      const chosen = new Set(people.map((p) => p.id));
      const noOne = !e.query || "no one signed in system".includes(e.query.toLowerCase()) ? [NO_ONE] : [];
      setFound([...noOne, ...list].filter((p) => !chosen.has(p.id)));
    } catch {
      setFound([]);
    }
  };

  if (data && data.available === false) {
    return (
      <Message
        severity="warn"
        style={{ width: "100%" }}
        text="The document store is unavailable, so the audit log cannot be analysed right now."
      />
    );
  }

  return (
    <div className="aa">
      <section className="card aa-controls" aria-label="What to count">
        <div className="aa-row">
          <div className="aa-field">
            <span>When</span>
            <SelectButton
              value={range}
              options={RANGES}
              onChange={(e) => e.value !== null && e.value !== undefined && setRange(e.value)}
              allowEmpty={false}
              className="aa-range"
            />
          </div>
          {range === "custom" && (
            <label className="aa-field">
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
                inputId="aa-days-range"
              />
            </label>
          )}
        </div>
        <div className="aa-row">
          <div className="aa-field">
            <span>Time of day</span>
            <span className="aa-hours">
              <Dropdown
                inputId="aa-from-hour"
                value={fromHour}
                options={FROM_HOURS}
                placeholder="Any time"
                onChange={(e) => {
                  setFromHour(e.value);
                  if (e.value !== null && toHour === null) setToHour(Math.min(e.value + 1, 24));
                  if (e.value === null) setToHour(null);
                }}
              />
              {fromHour !== null && (
                <>
                  <span className="aa-muted">to</span>
                  <Dropdown inputId="aa-to-hour" value={toHour} options={TO_HOURS} onChange={(e) => setToHour(e.value)} />
                </>
              )}
            </span>
          </div>
          <div className="aa-field">
            <span>Days of the week</span>
            <SelectButton value={days} options={WEEKDAYS} onChange={(e) => setDays(e.value || [])} multiple className="aa-weekdays" />
          </div>
          <div className="aa-field">
            <span>Outcome</span>
            <SelectButton value={outcome} options={OUTCOMES} onChange={(e) => e.value && setOutcome(e.value)} allowEmpty={false} />
          </div>
        </div>
        <div className="aa-row">
          <label className="aa-field aa-field--wide">
            <span>Operations</span>
            <MultiSelect
              inputId="aa-ops"
              value={ops}
              options={opOptions}
              optionGroupLabel="label"
              optionGroupChildren="items"
              onChange={(e) => setOps(e.value || [])}
              filter
              filterPlaceholder="Find an operation"
              resetFilterOnHide
              placeholder="Every operation"
              display="chip"
              maxSelectedLabels={6}
              showSelectAll={false}
            />
          </label>
          <label className="aa-field aa-field--wide">
            <span>People</span>
            <AutoComplete
              inputId="aa-people"
              value={people}
              suggestions={found}
              completeMethod={findPeople}
              field="label"
              multiple
              dropdown
              onChange={(e) => setPeople(e.value || [])}
              placeholder={people.length ? "" : "Everyone — type a name or email"}
            />
          </label>
        </div>
        <div className="aa-row">
          <label className="aa-field">
            <span>Group by</span>
            <Dropdown
              inputId="aa-by"
              value={by[0]}
              options={fieldOptions}
              optionGroupLabel="label"
              optionGroupChildren="items"
              onChange={(e) => setBy((b) => [e.value, ...(b[1] && b[1] !== e.value ? [b[1]] : [])])}
              filter
              filterPlaceholder="Find a field"
              resetFilterOnHide
            />
          </label>
          <label className="aa-field">
            <span>Then by</span>
            <Dropdown
              inputId="aa-then"
              value={by[1] || ""}
              options={thenOptions}
              optionGroupLabel="label"
              optionGroupChildren="items"
              onChange={(e) => setBy((b) => (e.value ? [b[0], e.value] : [b[0]]))}
              placeholder="— nothing more —"
              filter
              filterPlaceholder="Find a field"
              resetFilterOnHide
            />
          </label>
          <span className="aa-checks">
            <label className="aa-check">
              <Checkbox inputId="aa-hide-tests" checked={hideTests} onChange={(e) => setHideTests(e.checked)} />
              <span>Hide automated test activity</span>
            </label>
            <label className="aa-check aa-live">
              <InputSwitch checked={live} onChange={(e) => setLive(e.value)} />
              <span>Refresh every 30 s</span>
            </label>
          </span>
        </div>
        {where.length > 0 && (
          <div className="aa-chips" aria-label="Only">
            <span className="aa-muted">Only</span>
            {where.map((w, i) => {
              const f = data?.filters?.find((x) => x.key === w.key && x.value === w.value);
              return (
                <span className="aa-chip" key={`${w.key}:${w.value}`}>
                  <span>{f?.field || nameOf(w.key)}:</span>
                  <strong>{f?.label ?? (w.value === null ? "none" : w.value)}</strong>
                  <button
                    type="button"
                    aria-label={`Remove ${f?.field || nameOf(w.key)}`}
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

      {error && <p className="aa-warn">{error}</p>}
      {!data && !error && <p className="aa-muted">Loading…</p>}

      {data && (
        <>
          <section className="aa-totals" aria-label="Counted">
            <div className="aa-total">
              <span>Events</span>
              <strong>{n(data.totals.events)}</strong>
              <small>{data.ask.span.last ? "in the last hour" : `${n(data.ask.span.days)} day${data.ask.span.days === 1 ? "" : "s"}`}</small>
            </div>
            <div className="aa-total" title="Accounts signed in">
              <span>People</span>
              <strong>{n(data.totals.people)}</strong>
              <small>signed in</small>
            </div>
            <div className="aa-total">
              <span>Internet addresses</span>
              <strong>{n(data.totals.ips)}</strong>
              <small>different ones</small>
            </div>
            <div className="aa-total">
              <span>Failures</span>
              <strong>{n(data.totals.failures)}</strong>
              <small>{total ? `${pct(data.totals.failures / total)} of the events` : "—"}</small>
            </div>
          </section>

          {data.compare && (
            <section className="aa-compare" aria-label="Side by side">
              {data.compare.map((c) => (
                <article key={c.person.id} className="card aa-person">
                  <h3>{c.person.label}</h3>
                  <p className="aa-person__counts">
                    <strong>{n(c.totals.events)}</strong> events · {n(c.totals.failures)} failed · {n(c.totals.ips)} address
                    {c.totals.ips === 1 ? "" : "es"}
                  </p>
                  <p className="aa-muted aa-person__peak">Busiest: {busiest(c.heatmap) || "—"}</p>
                  <TimeBars series={c.series} valueKey="events" measure="Events" compact />
                  <Heatmap rows={c.heatmap} compact />
                </article>
              ))}
            </section>
          )}

          <section className="card">
            <TimeBars
              series={data.series}
              valueKey="events"
              measure="Events"
              detail={(p) => `${n(p.people)} people`}
              onPick={data.series.size === "5min" ? undefined : pickBucket}
            />
          </section>

          <section className="card">
            <Heatmap rows={data.heatmap} onPick={pickSquare} />
          </section>

          <section className="card aa-groups">
            <div className="aa-groups__head">
              <h2>
                Events by {shownBy.map(nameOf).join(", then ").toLowerCase()}
                <small className="aa-muted">
                  {" "}
                  · {n(rows.length)} group{rows.length === 1 ? "" : "s"}
                  {data.truncated ? " (the largest 500)" : ""}
                </small>
              </h2>
              <span className="aa-groups__actions">
                <Button label="Refresh" icon="pi pi-refresh" size="small" text onClick={() => load()} loading={loading} />
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
            <p className="aa-muted aa-hint">Choose a row to see its events one by one, or break it down further.</p>
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
              rowClassName={() => "aa-row-pick"}
              emptyMessage="No events in these days."
              className="aa-table"
            >
              {shownBy.map((key, i) => (
                <Column
                  key={key}
                  header={nameOf(key)}
                  field={`s${i}`}
                  sortable
                  body={(r) => <span className={r.values[i] === null ? "aa-muted" : ""}>{r.labels[i]}</span>}
                />
              ))}
              <Column
                header="Events"
                field="events"
                sortable
                body={(r) => (
                  <span className="aa-count">
                    <strong>{n(r.events)}</strong>
                    <span className="aa-share" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, r.share * 100)}%` }} />
                    </span>
                    <small>{shareText(r.share)}</small>
                  </span>
                )}
              />
              <Column header="People" headerTooltip="Accounts signed in" field="people" sortable body={(r) => n(r.people)} />
              <Column header="Addresses" headerTooltip="Internet addresses" field="ips" sortable body={(r) => n(r.ips)} />
              <Column
                header="Failures"
                field="failures"
                sortable
                body={(r) => <span className={r.failures ? "aa-failed" : ""}>{n(r.failures)}</span>}
              />
              <Column header="Last" field="lastAt" sortable body={(r) => whenBody({ at: r.lastAt })} />
            </DataTable>
            <TieredMenu model={menuModel} popup ref={menu} className="aa-menu" />
          </section>

          <details
            className="card aa-latest"
            ref={latestRef}
            open={latestOpen}
            onToggle={(e) => setLatestOpen(e.currentTarget.open)}
          >
            <summary>
              <span>One by one</span>
              <small className="aa-muted">The latest {Math.min(50, data.latest.length)} events{where.length ? " that match" : ""}</small>
            </summary>
            <DataTable
              value={data.latest}
              dataKey="_id"
              stripedRows
              emptyMessage="No events in these days."
              expandedRows={expanded}
              onRowToggle={(e) => setExpanded(e.data)}
              rowExpansionTemplate={expansion}
            >
              <Column expander style={{ width: "3rem" }} />
              <Column header="When" body={whenBody} style={{ width: "10rem" }} />
              <Column header="Action" body={actionBody} />
              <Column header="Actor" body={actorBody} />
              <Column header="Target" body={entityBody} />
              <Column header="From" body={(r) => r.context?.ipAddress || "—"} />
            </DataTable>
          </details>
        </>
      )}
    </div>
  );
}
