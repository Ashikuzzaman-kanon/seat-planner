"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { ProgressBar } from "primereact/progressbar";
import { Column } from "primereact/column";
import { confirmDialog, ConfirmDialog } from "primereact/confirmdialog";
import DataTable from "@/components/ui/DataTable";
import SearchBox from "@/components/ui/SearchBox";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { followJob } from "@/lib/jobs";
import { fetchRailwayStatus, loadRailway, runsOnLabel } from "@/lib/railwayData";
import "./railway-data.css";

/** Bytes one seat takes on one departure, indexes included — measured on the real tables. */
const BYTES_PER_SEAT = 210;

const date = (value) =>
  value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const when = (value) =>
  value
    ? `${date(value)}, ${new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : "—";

/**
 * Railway data.
 *
 * Loads Bangladesh Railway's published timetable — every station, train and
 * route — and the seat plans transcribed from coach diagrams, and makes the
 * trains that have plans ready for departures. It says what it will and will
 * not do before anyone presses the button: it fills in what is missing, it
 * never changes what is there, and it never generates departures itself.
 */
export default function RailwayDataPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission(PERMISSIONS.RAILWAY_MANAGE);
  const canSettings = hasPermission(PERMISSIONS.SETTING_MANAGE);
  const canGenerate = hasPermission(PERMISSIONS.TRIP_MANAGE);
  const toast = useRef(null);

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);
  const [search, setSearch] = useState("");
  const following = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchRailwayStatus();
      setStatus(data);
      return data;
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not load the railway status", detail: err.message });
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const follow = useCallback(
    (started) => {
      following.current?.stop();
      setJob(started);
      const watcher = followJob(started.id, { onUpdate: setJob, intervalMs: 1500 });
      following.current = watcher;
      watcher.done.then(async (finished) => {
        if (following.current !== watcher) return;
        following.current = null;
        setJob(null);
        await refresh();
        if (!finished) return;
        if (finished.status === "succeeded") {
          const r = finished.result || {};
          toast.current?.show({
            severity: "success",
            summary: "Railway data loaded",
            detail: `${r.ready ?? 0} trains are ready for departures.`,
            life: 6000,
          });
        } else {
          toast.current?.show({
            severity: "error",
            summary: "Loading stopped",
            detail: finished.lastError || "See Background Jobs for why.",
            life: 10000,
          });
        }
      });
    },
    [refresh]
  );

  useEffect(() => {
    if (!canManage) return undefined;
    refresh().then((data) => {
      if (data?.job) follow(data.job);
    });
    return () => following.current?.stop();
  }, [canManage, refresh, follow]);

  const start = async () => {
    setStarting(true);
    try {
      const { job: started } = await loadRailway();
      follow(started);
    } catch (err) {
      await refresh();
      toast.current?.show({ severity: err.status === 409 ? "warn" : "error", summary: "Could not load", detail: err.message, life: 10000 });
    } finally {
      setStarting(false);
    }
  };

  const ask = () =>
    confirmDialog({
      header: "Load railway data",
      icon: "pi pi-directions",
      message: (
        <div className="rd-confirm">
          <p>In the background, this adds whatever is missing of:</p>
          <ul>
            <li>
              {status?.snapshot.stations} stations and {status?.snapshot.trains} trains with their routes, from the
              timetable published {date(status?.snapshot.fetchedAt)};
            </li>
            <li>
              the transcribed seat plans — approved for the {status?.snapshot.readyTrains} trains their sources name,
              and {status?.snapshot.draftPlans} drafts for sources that name no train;
            </li>
            <li>coaches, running days and per-kilometre fares for those {status?.snapshot.readyTrains} trains.</li>
          </ul>
          <p>
            Anything already there is <strong>left as it is</strong>. No departures are generated.
          </p>
        </div>
      ),
      acceptLabel: "Load",
      rejectLabel: "Cancel",
      accept: start,
    });

  const ready = status?.ready || [];
  const filtered = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return ready;
    return ready.filter((t) => {
      const hay = [t.name, t.code, t.from, t.to, ...Object.keys(t.seatsByClass)].join(" ").toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
  }, [ready, search]);

  if (!canManage) {
    return (
      <div className="card">
        <h1 className="page-title">Railway Data</h1>
        <p className="page-subtitle">Your account cannot load railway data.</p>
      </div>
    );
  }

  const s = status?.snapshot;
  const l = status?.loaded;
  const complete = Boolean(s && l && l.trains === s.trains && l.withRoutes === s.trains);
  const busy = Boolean(job) || starting;
  const last = status?.lastJob;
  const seatsPerDay = ready.reduce((n, t) => n + t.seats * (t.runsOn.length / 7), 0);
  const generation = status?.generation;

  const counts = [
    ["Trains", l ? `${l.trains} / ${s.trains}` : "–", "pi pi-directions", l?.trains],
    ["With routes", l?.withRoutes ?? "–", "pi pi-map", l?.withRoutes],
    ["Stations", l ? `${l.stations} / ${s.stations}` : "–", "pi pi-map-marker", l?.stations],
    ["Approved plans", l?.approvedPlans ?? "–", "pi pi-check-square", l?.approvedPlans],
    ["Draft plans", l ? `${l.draftPlans} / ${s.draftPlans}` : "–", "pi pi-pencil", l?.draftPlans],
    ["Ready trains", status ? `${ready.length}` : "–", "pi pi-bolt", ready.length],
  ];

  return (
    <div className="rd-page">
      <Toast ref={toast} />
      <ConfirmDialog className="rd-confirm-dialog" />

      <div className="page-head">
        <div>
          <h1 className="page-title">Railway Data</h1>
          <p className="page-subtitle">
            Bangladesh Railway&apos;s published timetable, and the seat plans transcribed for its trains. Loading adds
            what is missing and never changes what is already there.
          </p>
        </div>
      </div>

      <section className="card rd-status">
        <div className="rd-status__head">
          <div className="rd-status__state">
            <span className={`rd-dot${complete ? " is-on" : ""}`} aria-hidden="true" />
            <div>
              <strong>
                {loading ? "Loading…" : complete ? "The railway is loaded" : l?.trains ? "Partly loaded" : "Not loaded yet"}
              </strong>
              <small>
                Timetable published {date(s?.fetchedAt)}
                {last ? <> · last loaded {when(last.finishedAt)}{last.status === "failed" ? " (it stopped part-way)" : ""}</> : ""}
              </small>
            </div>
          </div>
          <Button
            label={l?.trains ? "Load again" : "Load railway data"}
            icon="pi pi-cloud-download"
            onClick={ask}
            loading={starting}
            disabled={busy || loading || Boolean(status?.blocker)}
          />
        </div>

        {status?.blocker && !job && (
          <div className="rd-banner rd-banner--warn" role="alert">
            <i className="pi pi-lock" aria-hidden="true" />
            <div>
              <strong>Demo data has to go first</strong>
              <p>
                {status.blocker} <Link href="/dashboard/demo-data">Open Demo Data</Link>
              </p>
            </div>
          </div>
        )}

        {job && <JobProgress job={job} />}

        <div className="rd-counts">
          {counts.map(([label, value, icon, raw]) => (
            <div key={label} className={`rd-count${raw ? "" : " is-zero"}`}>
              <b>{value}</b>
              <span>
                <i className={icon} aria-hidden="true" />
                {label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {generation && ready.length > 0 && (
        <section className={`card rd-banner ${generation.automatic ? "rd-banner--warn" : "rd-banner--info"}`}>
          <i className={`pi ${generation.automatic ? "pi-exclamation-triangle" : "pi-calendar-plus"}`} aria-hidden="true" />
          <div>
            {generation.automatic ? (
              <>
                <strong>Departures are generated automatically</strong>
                <p>
                  Every hour the system keeps {generation.horizonDays} days of departures built for each of these{" "}
                  {ready.length} trains — about {Math.round(seatsPerDay * generation.horizonDays).toLocaleString()} seats,
                  roughly {Math.ceil((seatsPerDay * generation.horizonDays * BYTES_PER_SEAT) / 1_000_000)} MB, and growing
                  by about {Math.ceil((seatsPerDay * BYTES_PER_SEAT) / 1_000_000)} MB a day as departures pass. To build
                  them by hand instead, turn off <em>Generate departures automatically</em>
                  {canSettings ? (
                    <>
                      {" "}in <Link href="/dashboard/settings">Settings</Link>.
                    </>
                  ) : (
                    " in Settings."
                  )}
                </p>
              </>
            ) : (
              <>
                <strong>Departures are generated by hand</strong>
                <p>
                  These trains have coaches and running days, so departures can be built for them — for the trains and
                  days you choose. One day for all of them is about {Math.round(seatsPerDay).toLocaleString()} seats, roughly{" "}
                  {Math.ceil((seatsPerDay * BYTES_PER_SEAT) / 1_000_000)} MB.
                </p>
              </>
            )}
          </div>
          {canGenerate && (
            <Link href="/dashboard/departures?generate=1" className="rd-banner__action">
              <Button label="Generate departures" icon="pi pi-bolt" outlined size="small" />
            </Link>
          )}
        </section>
      )}

      {last && !job && <LastRun job={last} />}

      <section className="card">
        <div className="rd-section-head">
          <div>
            <h2>
              Ready for departures <small>{ready.length} trains</small>
            </h2>
            <p>
              Trains with coaches on approved seat plans and running days. Only trains a seat-plan source names are made
              ready; the rest have their routes and wait for plans.
            </p>
          </div>
          <SearchBox value={search} onChange={setSearch} placeholder="Search train, station or class…" ariaLabel="Search ready trains" />
        </div>

        <DataTable value={filtered} loading={loading} dataKey="id" paginator rows={10} stripedRows emptyMessage={search ? "No train matches" : "No train is ready yet"}>
          <Column
            header="Train"
            sortable
            sortField="name"
            body={(t) => (
              <div className="rd-train">
                <strong>{t.name.replace(/\s*\(\d+\)$/, "")}</strong>
                <span>{t.code || "—"}</span>
              </div>
            )}
          />
          <Column
            header="Route"
            body={(t) => (
              <div className="rd-route">
                <span>{t.from?.replace(/_/g, " ")}</span>
                <i className="pi pi-arrow-right" aria-hidden="true" />
                <span>{t.to?.replace(/_/g, " ")}</span>
              </div>
            )}
          />
          <Column
            header="Times"
            body={(t) => (
              <span className="rd-times">
                {t.departs} – {t.arrives}
                {t.arrivesDayOffset > 0 && <sup title="Arrives the next day">+{t.arrivesDayOffset}</sup>}
              </span>
            )}
          />
          <Column header="Runs" body={(t) => <span className="rd-runs">{runsOnLabel(t.runsOn)}</span>} />
          <Column
            header="Coaches"
            body={(t) => (
              <span className="rd-coaches" title={t.coaches.join(" · ")}>
                {t.coaches.length}
              </span>
            )}
          />
          <Column
            header="Seats by class"
            body={(t) => (
              <div className="rd-classes">
                {Object.entries(t.seatsByClass).map(([name, n]) => (
                  <span key={name} className="rd-chip">
                    {name} <b>{n}</b>
                  </span>
                ))}
              </div>
            )}
          />
          <Column header="Seats" sortable sortField="seats" body={(t) => <strong className="rd-total">{t.seats.toLocaleString()}</strong>} />
        </DataTable>
      </section>
    </div>
  );
}

/** A load in progress. */
function JobProgress({ job }) {
  const p = job.progress;
  const pct = p?.total ? Math.round(((p.done ?? 0) / p.total) * 100) : 0;
  return (
    <div className="rd-job" aria-live="polite">
      <div className="rd-job__line">
        <i className="pi pi-spin pi-spinner" aria-hidden="true" />
        <strong>Loading railway data…</strong>
        <span>
          {job.status === "queued"
            ? "waiting to start"
            : p?.step && p.step !== "Done"
              ? `${p.step}${p.total ? ` — step ${Math.min((p.done ?? 0) + 1, p.total)} of ${p.total}` : ""}`
              : "finishing"}
        </span>
      </div>
      <ProgressBar value={pct} showValue={false} />
      <small>
        Running in the background as <Link href={`/dashboard/jobs?focus=${job.id}`}>job #{job.id}</Link>. You can leave
        this page; it carries on.
      </small>
    </div>
  );
}

/** What the last load did, what it could not, and how the published times were adjusted. */
function LastRun({ job }) {
  const r = job.result || {};
  const failed = job.status === "failed";
  const rows = r.stations
    ? [
        ["Stations", `${r.stations.created} new · ${r.stations.existing} existing`],
        ["Trains", `${r.trains.created} new · ${r.trains.existing} existing`],
        ["Routes", `${r.routes.replaced} saved · ${r.routes.unchanged} unchanged · ${r.routes.skipped} skipped`],
        ["Seat plans", `${r.plans.approved} approved · ${r.plans.drafts} drafts · ${r.plans.existing} existing`],
        ["Coaches", `${r.compositions.set} set · ${r.compositions.existing} kept`],
        ["Running days", `${r.schedules.set} set · ${r.schedules.existing} kept`],
        ["Fare rules", `${r.fareRules.created} new · ${r.fareRules.existing} existing`],
      ]
    : [];

  return (
    <section className={`card rd-last${failed ? " is-failed" : ""}`}>
      <div className="rd-section-head">
        <div>
          <h2>
            {failed ? "The last load stopped" : "Last load"} <small>{when(job.finishedAt)}</small>
          </h2>
        </div>
      </div>

      {failed && <pre className="rd-error">{job.lastError}</pre>}

      {!failed && (
        <dl className="rd-summary">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {r.warnings?.length > 0 && (
        <ul className="rd-notes rd-notes--warn">
          {r.warnings.map((w) => (
            <li key={w}>
              <i className="pi pi-exclamation-triangle" aria-hidden="true" />
              {w}
            </li>
          ))}
        </ul>
      )}

      {r.notes?.length > 0 && (
        <details className="rd-adjustments">
          <summary>
            {r.notes.length} timetable adjustment{r.notes.length === 1 ? "" : "s"} — where the published times needed
            correcting to make a route
          </summary>
          <ul className="rd-notes">
            {r.notes.map((n) => (
              <li key={n}>
                <i className="pi pi-info-circle" aria-hidden="true" />
                {n}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
