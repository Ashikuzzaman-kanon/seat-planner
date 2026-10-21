"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropdown } from "primereact/dropdown";
import { InputSwitch } from "primereact/inputswitch";
import { Button } from "primereact/button";
import { SelectButton } from "primereact/selectbutton";
import { Paginator } from "primereact/paginator";
import { ProgressSpinner } from "primereact/progressspinner";
import { Toast } from "primereact/toast";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { fetchAllocation, fetchAllocationMeta, stationLabel, STATUS_LABELS, span } from "@/lib/allocation";
import DataPanel from "@/components/allocation/DataPanel";
import PairDialog from "@/components/allocation/PairDialog";
import { ClassChips, PairList, PairGrid, GridLegend } from "@/components/allocation/PairViews";
import "./allocation.css";

const PAGE_SIZE = 50;
const NO_FILTERS = { from: null, to: null, train: null, cls: null };
const n = (x) => Number(x || 0).toLocaleString("en-GB");

/**
 * Seat Allocation: which station pairs Bangladesh Railway actually sets seats
 * aside for, train by train and class by class.
 *
 * One list and four filters — from, to, train, class — each left empty to mean
 * all. From and to together give the trains with seats on that journey; from
 * alone, everywhere a train with seats goes from there; a train alone, its
 * pairs in route order, also as a grid. Only allocated pairs unless asked.
 *
 * The railway's own data, uploaded here and kept apart from the site's trains,
 * stations and bookings.
 */
export default function AllocationPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission(PERMISSIONS.ALLOCATION_VIEW);
  const canManage = hasPermission(PERMISSIONS.ALLOCATION_MANAGE);
  const toast = useRef(null);

  const [meta, setMeta] = useState(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [all, setAll] = useState(false);
  const [page, setPage] = useState(1);
  const [view, setView] = useState("list");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null);

  const oneTrain = Boolean(filters.train);
  const grid = oneTrain && view === "grid";
  const params = useMemo(
    () => ({ from: filters.from, to: filters.to, train: filters.train, class: filters.cls }),
    [filters]
  );

  const loadMeta = useCallback(async () => {
    try {
      setMeta(await fetchAllocationMeta());
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Seat allocation", detail: err.message });
    }
  }, []);

  const loadPairs = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await fetchAllocation(
          grid
            ? { train: filters.train, show: "all", pageSize: 1000 }
            : { ...params, show: all ? "all" : "allocated", page, pageSize: PAGE_SIZE }
        )
      );
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Seat allocation", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, [grid, filters.train, params, all, page]);

  useEffect(() => {
    if (canView) loadMeta();
  }, [canView, loadMeta]);

  useEffect(() => {
    if (canView && meta) loadPairs();
  }, [canView, meta, loadPairs]);

  const choose = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value ?? null }));
    setPage(1);
    setSelected(null);
  };

  const refresh = async () => {
    await loadMeta();
  };

  const saved = async (message) => {
    toast.current?.show({ severity: "success", summary: message });
    setEditing(null);
    setSelected(null);
    await loadMeta();
  };

  const options = useMemo(() => {
    if (!meta) return { stations: [], trains: [], classes: [] };
    return {
      stations: meta.stations.map((s) => ({ label: stationLabel(s), value: s })),
      trains: meta.trains.map((t) => ({ label: `${t.number} · ${t.name}`, value: t.number })),
      classes: meta.classes.map((c) => ({ label: c, value: c })),
    };
  }, [meta]);

  if (!canView) {
    return (
      <div className="card">
        <h1 className="page-title">Seat Allocation</h1>
        <p className="page-subtitle">Your account cannot see the seat allocation.</p>
      </div>
    );
  }

  const empty = meta && meta.totals.pairs === 0;
  const s = data?.summary;
  const chosen = meta?.trains.find((t) => t.number === filters.train);
  const anyFilter = Object.values(filters).some(Boolean);

  return (
    <div className="al">
      <Toast ref={toast} />
      <div className="al-head">
        <h1 className="page-title">Seat Allocation</h1>
        <p className="page-subtitle">
          Which station pairs Bangladesh Railway actually sets seats aside for — train by train, class by class. The
          railway&apos;s own data, kept apart from this site&apos;s trains and bookings.
        </p>
      </div>

      {meta && <DataPanel meta={meta} canManage={canManage} filters={params} onChanged={refresh} toast={toast} />}

      {!meta ? (
        <div className="al-loading">
          <ProgressSpinner style={{ width: 40, height: 40 }} strokeWidth="4" />
        </div>
      ) : empty ? (
        <section className="card al-empty">
          <i className="pi pi-chart-bar" aria-hidden="true" />
          <h2>No allocation data yet</h2>
          {canManage ? (
            <p>
              Upload the train routes first — <code>train-stoppages.json</code> — so pairs show in travel order. Then
              upload the census file. Each is shown before anything changes.
            </p>
          ) : (
            <p>Nothing has been uploaded yet. Whoever manages the seat allocation can upload it.</p>
          )}
        </section>
      ) : (
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
                <Button label="Clear filters" icon="pi pi-filter-slash" text size="small" onClick={() => {
                  setFilters(NO_FILTERS);
                  setPage(1);
                  setSelected(null);
                }} />
              )}
            </div>
          </section>

          <section className="al-results">
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
                  </>
                ) : (
                  " "
                )}
              </p>
              {s?.classes.length > 0 && (
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
                    setSelected(null);
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
                    selected={selected}
                    onSelect={(p) => setSelected(p)}
                    classCode={filters.cls}
                  />
                  {selected && (
                    <div className="card al-picked">
                      <div className="al-pair__head">
                        <span className="al-journey">
                          {stationLabel(selected.from)} <i className="pi pi-arrow-right" aria-hidden="true" />{" "}
                          {stationLabel(selected.to)}
                        </span>
                        <span className="al-muted">{STATUS_LABELS[selected.status]}</span>
                      </div>
                      {selected.status === "allocated" && <ClassChips classes={selected.classes} />}
                      {canManage && (
                        <Button
                          label={selected.status === "not_checked" ? "Set" : "Edit"}
                          size="small"
                          outlined
                          onClick={() => setEditing(selected)}
                        />
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="al-muted">
                  This train&apos;s route has not been uploaded, so there is no grid. Upload the train routes.
                </p>
              )
            ) : data?.items.length ? (
              <>
                <PairList items={data.items} oneTrain={oneTrain} canManage={canManage} onEdit={setEditing} />
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
          </section>
        </>
      )}

      <PairDialog
        pair={editing}
        knownClasses={meta?.classes || []}
        onHide={() => setEditing(null)}
        onSaved={saved}
        toast={toast}
      />
    </div>
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
