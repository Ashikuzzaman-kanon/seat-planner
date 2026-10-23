"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropdown } from "primereact/dropdown";
import { InputSwitch } from "primereact/inputswitch";
import { Button } from "primereact/button";
import { SelectButton } from "primereact/selectbutton";
import { Paginator } from "primereact/paginator";
import { ProgressSpinner } from "primereact/progressspinner";
import { stationLabel, span, daySpan } from "@/lib/allocation";
import { PairList, PairGrid, GridLegend } from "./PairViews";
import "./allocation.css";

const PAGE_SIZE = 50;
const NO_FILTERS = { from: null, to: null, train: null, cls: null };
const n = (x) => Number(x || 0).toLocaleString("en-GB");

/**
 * Searching the seat allocation: one list and four filters — from, to, train,
 * class — each left empty to mean all. From and to together give the trains
 * with seats on that journey; from alone, everywhere a train with seats goes
 * from there; a train alone, its pairs in route order, also as a grid. Only
 * allocated pairs unless asked.
 *
 * The same in the app and on the public page (/seat-allocation); each passes
 * in how to fetch the results. `renderBlocked` shows instead of the results
 * when a search is refused in a way the page explains itself — on the public
 * page, being asked to sign in.
 */
export default function Explorer({ meta, fetchList, canManage = false, onEdit, onError, renderBlocked, onFilters }) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const [all, setAll] = useState(false);
  const [page, setPage] = useState(1);
  const [view, setView] = useState("list");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(null);
  const latest = useRef(0);

  const oneTrain = Boolean(filters.train);
  const grid = oneTrain && view === "grid";
  const params = useMemo(
    () => ({ from: filters.from, to: filters.to, train: filters.train, class: filters.cls }),
    [filters]
  );

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const result = await fetchList(
        grid
          ? { train: filters.train, show: "all", pageSize: 1000 }
          : { ...params, show: all ? "all" : "allocated", page, pageSize: PAGE_SIZE }
      );
      if (ticket !== latest.current) return;
      setBlocked(null);
      setData(result);
    } catch (err) {
      if (ticket !== latest.current) return;
      if (renderBlocked && renderBlocked(err, () => load())) setBlocked(err);
      else onError?.(err);
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, filters.train, params, all, page, fetchList]);

  useEffect(() => {
    if (meta) load();
  }, [meta, load]);

  // The page may want the filters too: the counts sheet is downloaded for them.
  useEffect(() => {
    onFilters?.(params);
  }, [params, onFilters]);

  const choose = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value ?? null }));
    setPage(1);
  };

  const options = useMemo(() => {
    if (!meta) return { stations: [], trains: [], classes: [] };
    return {
      stations: meta.stations.map((s) => ({ label: stationLabel(s), value: s })),
      trains: meta.trains.map((t) => ({ label: `${t.number} · ${t.name}`, value: t.number })),
      classes: meta.classes.map((c) => ({ label: c, value: c })),
    };
  }, [meta]);

  const s = data?.summary;
  const chosen = meta?.trains.find((t) => t.number === filters.train);
  const anyFilter = Object.values(filters).some(Boolean);

  return (
    <>
      <section className="card al-filters" aria-label="Filters">
        <div className="al-filters__grid">
          <label>
            <span>From</span>
            <Dropdown
              value={filters.from}
              options={options.stations}
              onChange={(e) => choose("from", e.value)}
              filter
              showClear
              placeholder="Any station"
              inputId="al-from"
            />
          </label>
          <label>
            <span>To</span>
            <Dropdown
              value={filters.to}
              options={options.stations}
              onChange={(e) => choose("to", e.value)}
              filter
              showClear
              placeholder="Any station"
              inputId="al-to"
            />
          </label>
          <label>
            <span>Train</span>
            <Dropdown
              value={filters.train}
              options={options.trains}
              onChange={(e) => choose("train", e.value)}
              filter
              showClear
              placeholder="Any train"
              inputId="al-train"
            />
          </label>
          <label>
            <span>Class</span>
            <Dropdown
              value={filters.cls}
              options={options.classes}
              onChange={(e) => choose("cls", e.value)}
              showClear
              placeholder="Any class"
              inputId="al-class"
            />
          </label>
        </div>
        <div className="al-filters__more">
          <label className="al-switch" htmlFor="al-all">
            <InputSwitch
              inputId="al-all"
              checked={all}
              onChange={(e) => {
                setAll(e.value);
                setPage(1);
              }}
              disabled={grid}
            />
            Show not allocated and not checked
          </label>
          {anyFilter && (
            <Button
              label="Clear filters"
              icon="pi pi-filter-slash"
              text
              size="small"
              onClick={() => {
                setFilters(NO_FILTERS);
                setPage(1);
              }}
            />
          )}
        </div>
      </section>

      <section className="al-results">
        {blocked ? (
          renderBlocked(blocked, () => load())
        ) : (
          <>
            <div className="al-summary">
              <p className="al-summary__line">
                {s ? (
                  <>
                    {heading(filters, chosen)}
                    {": "}
                    <strong>{n(s.trains)}</strong> train{s.trains === 1 ? "" : "s"} · <strong>{n(s.pairs)}</strong> pair
                    {s.pairs === 1 ? "" : "s"} · <strong>{n(s.stations)}</strong> stations
                    {(all || grid) && (
                      <span className="al-muted">
                        {" "}
                        — {n(s.allocated)} allocated, {n(s.notAllocated)} not allocated, {n(s.notChecked)} not checked
                      </span>
                    )}
                    {s.checkedFrom && (
                      <span className="al-checked">
                        {" "}
                        · railway checked <strong>{span(s.checkedFrom, s.checkedTo)}</strong>
                      </span>
                    )}
                    {s.countsFrom && (
                      <span className="al-checked">
                        {" "}
                        · counts updated <strong>{daySpan(s.countsFrom, s.countsTo)}</strong>
                      </span>
                    )}
                  </>
                ) : (
                  " "
                )}
              </p>
              {/* Seats class by class: there when wanted, folded away by default. */}
              {s?.classes.length > 0 && (
                <details className="al-summary__more">
                  <summary>
                    <i className="pi pi-chevron-right" aria-hidden="true" />
                    Seats by class <span className="al-muted">({s.classes.length})</span>
                  </summary>
                  <ul className="al-summary__classes">
                    {s.classes.map((c) => (
                      <li key={c.code}>
                        <strong>{c.code}</strong> on {n(c.pairs)} pair{c.pairs === 1 ? "" : "s"}
                        <span className="al-muted">
                          {c.counted ? ` · ${n(c.seats)} seats on the ${n(c.counted)} counted` : " · counts not available"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {oneTrain && (
                <SelectButton
                  value={view}
                  options={[
                    { label: "List", value: "list", icon: "pi pi-list" },
                    { label: "Grid", value: "grid", icon: "pi pi-th-large" },
                  ]}
                  onChange={(e) => {
                    if (e.value) setView(e.value);
                  }}
                  className="al-view"
                  itemTemplate={(o) => (
                    <span className="al-view__item">
                      <i className={o.icon} aria-hidden="true" /> {o.label}
                    </span>
                  )}
                />
              )}
            </div>

            {loading && !data ? (
              <div className="al-loading">
                <ProgressSpinner style={{ width: 32, height: 32 }} strokeWidth="4" />
              </div>
            ) : grid ? (
              data?.route ? (
                <>
                  <GridLegend classCode={filters.cls} />
                  <PairGrid
                    route={data.route}
                    items={data.items}
                    classCode={filters.cls}
                    canManage={canManage}
                    onEdit={onEdit}
                  />
                </>
              ) : (
                <p className="al-muted">This train&apos;s route is not known yet, so there is no grid.</p>
              )
            ) : data?.items.length ? (
              <>
                <PairList
                  items={data.items}
                  oneTrain={oneTrain}
                  canManage={canManage}
                  onEdit={onEdit}
                  newestChecked={s?.checkedTo}
                />
                {data.total > PAGE_SIZE && (
                  <Paginator
                    first={(page - 1) * PAGE_SIZE}
                    rows={PAGE_SIZE}
                    totalRecords={data.total}
                    onPageChange={(e) => setPage(e.page + 1)}
                    template="PrevPageLink CurrentPageReport NextPageLink"
                    currentPageReportTemplate="{first}–{last} of {totalRecords}"
                  />
                )}
              </>
            ) : (
              data && (
                <p className="al-none">
                  {all
                    ? "Nothing matches these filters."
                    : "No train has seats allocated for these filters. Switch on “Show not allocated and not checked” to see the rest."}
                </p>
              )
            )}
          </>
        )}
      </section>
    </>
  );
}

/** What the list is of, in words. */
function heading(f, train) {
  const from = f.from && stationLabel(f.from);
  const to = f.to && stationLabel(f.to);
  const where = from && to ? `${from} to ${to}` : from ? `From ${from}` : to ? `To ${to}` : null;
  const parts = [train && `${train.name} (${train.number})`, where, f.cls].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Everything";
}
