"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import SearchBox from "@/components/ui/SearchBox";
import { Column } from "primereact/column";
import { Checkbox } from "primereact/checkbox";
import Select from "@/components/ui/Select";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { Dialog } from "primereact/dialog";
import { Message } from "primereact/message";
import { confirmDialog, ConfirmDialog } from "primereact/confirmdialog";
import {
  fetchTrips,
  fetchTripSeats,
  generateHorizon,
  rebuildTrip,
  cancelTrip,
  reinstateTrip,
  setTripStanding,
  fetchJobs,
  DAY_SHORT,
} from "@/lib/departures";
import { fetchTrains } from "@/lib/network";
import { setRefundOptions } from "@/lib/postSale";
import "@/components/postsale/postsale.css";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import "@/components/network/network.css";

import { TIP } from "@/components/ui/tip";
import { followJob } from "@/lib/jobs";
import CancelWithReason from "@/components/departures/CancelWithReason";
import RefundJobBanner from "@/components/departures/RefundJobBanner";
import TripCoachesDialog from "@/components/departures/TripCoachesDialog";
const STATUS_FILTER = [
  { label: "All statuses", value: "" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Cancelled", value: "cancelled" },
];

const STATUS_SEVERITY = {
  scheduled: "success",
  cancelled: "danger",
  departed: "info",
  completed: "secondary",
};

const dayOf = (date) => DAY_SHORT[new Date(`${date}T00:00:00Z`).getUTCDay()];

export default function DeparturesPage() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);

  const [trips, setTrips] = useState([]);
  const [trains, setTrains] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [trainFilter, setTrainFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState(null);
  const [seatsFor, setSeatsFor] = useState(null);
  const [seats, setSeats] = useState([]);
  const [seatSearch, setSeatSearch] = useState("");
  const [cancelFor, setCancelFor] = useState(null);
  const [coachesFor, setCoachesFor] = useState(null);
  // Refunds that outlived the request that started them — see RefundJobBanner.
  const [refundWatch, setRefundWatch] = useState(null);

  const canView = hasPermission(PERMISSIONS.TRIP_VIEW);
  const canManage = hasPermission(PERMISSIONS.TRIP_MANAGE);
  // Cancelling moves money for everyone aboard, so since 8A it is its own
  // permission; offering the button on trip:manage alone would offer a refusal.
  const canCancel = hasPermission(PERMISSIONS.TRIP_CANCEL);
  const canSeeJobs = hasPermission(PERMISSIONS.JOB_VIEW);
  const canConfigureRefunds = hasPermission(PERMISSIONS.REFUND_CONFIGURE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tripList, trainList, jobList] = await Promise.all([
        fetchTrips({ limit: 500 }),
        fetchTrains(),
        fetchJobs().catch(() => []),
      ]);
      setTrips(tripList);
      setTrains(trainList);
      setJobs(jobList);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canView) load();
    else setLoading(false);
  }, [canView, load]);

  const filtered = useMemo(
    () =>
      trips.filter(
        (t) =>
          (!trainFilter || t.trainId === trainFilter) &&
          (!statusFilter || t.status === statusFilter)
      ),
    [trips, trainFilter, statusFilter]
  );

  const metrics = useMemo(() => {
    const live = trips.filter((t) => t.status === "scheduled");
    const dates = trips.map((t) => t.departureDate).sort();
    return {
      departures: live.length,
      seats: live.reduce((n, t) => n + t.seatCount, 0),
      trains: new Set(live.map((t) => t.trainId)).size,
      window: dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "None",
      unbuilt: live.filter((t) => t.seatCount === 0).length,
    };
  }, [trips]);

  const generate = async () => {
    setGenerating(true);
    try {
      const result = await generateHorizon({});
      setReport(result.report);
      toast.current?.show({ severity: "success", summary: result.message });
      load();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Generation failed", detail: err.message });
    } finally {
      setGenerating(false);
    }
  };

  const doRebuild = async (trip) => {
    try {
      const result = await rebuildTrip(trip.id);
      toast.current?.show({ severity: "success", summary: result.message });
      load();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Rebuild failed", detail: err.message });
    }
  };

  const notify = useCallback(
    (severity, summary, detail, life = 6000) => toast.current?.show({ severity, summary, detail, life }),
    []
  );

  /**
   * Follow a refund job that was still running when its request returned, and
   * say so again when it finishes. It runs whether or not anyone watches.
   */
  const watchRefunds = useCallback(
    ({ label, job }) => {
      if (!job) return;
      setRefundWatch({ label, job });
      followJob(job.id, { onUpdate: (j) => setRefundWatch((w) => (w && w.job?.id === j.id ? { ...w, job: j } : w)) })
        .done.then((finished) => {
          if (finished?.status === "succeeded") {
            const n = finished.result?.refunded ?? 0;
            notify(
              "success",
              "Refunds done",
              n ? `${n} ticket(s) on ${label} refunded in full.` : `Nobody was aboard ${label}, so nothing was refunded.`,
              8000
            );
          } else if (finished?.status === "failed") {
            notify("error", "Refunds stopped", `The refund job for ${label} failed. Open it on the Background Jobs screen.`, 10000);
          }
          load();
        });
    },
    [notify, load]
  );

  const doCancel = (trip) => setCancelFor(trip);

  const confirmCancel = async (reason) => {
    const trip = cancelFor;
    try {
      const result = await cancelTrip(trip.id, reason);
      setCancelFor(null);
      if (result?.refunds) {
        const refunded = result.refunds.refunded ?? 0;
        notify(
          "success",
          "Departure cancelled",
          refunded
            ? `${refunded} ticket(s) refunded in full. Each passenger is being emailed the reason.`
            : "Nobody was aboard, so there was nothing to refund.",
          8000
        );
      } else {
        notify(
          "info",
          "Departure cancelled",
          `Refunds are being issued in the background (job #${result?.job?.id}).`,
          8000
        );
        watchRefunds({ label: `${trip.train.name}, ${trip.departureDate}`, job: result?.job });
      }
      load();
    } catch (err) {
      notify("error", "Cancel failed", err.message);
    }
  };

  const doReinstate = (trip) =>
    confirmDialog({
      message:
        `Put ${trip.train.name} on ${trip.departureDate} back into service? ` +
        "Its seats go on sale again. Passengers refunded when it was cancelled keep that money " +
        "and are not re-booked, so it comes back empty.",
      header: "Reinstate departure",
      icon: "pi pi-replay",
      acceptLabel: "Put it back",
      accept: async () => {
        try {
          const result = await reinstateTrip(trip.id, "Reinstated from the departure board");
          const lost = result?.refundedOnCancellation ?? 0;
          toast.current?.show({
            severity: "success",
            summary: "Running again",
            detail: lost
              ? `${lost} ticket(s) were refunded on cancellation and do not come back.`
              : undefined,
            life: 7000,
          });
          load();
        } catch (err) {
          toast.current?.show({ severity: "error", summary: "Could not reinstate", detail: err.message });
        }
      },
    });

  /**
   * Turn connecting standing on or off for a departure.
   *
   * Capacity itself lives on the coach class, under Reference Data — this only
   * decides whether standing happens on this particular service.
   */
  const toggleStanding = async (trip, enabled) => {
    try {
      const result = await setTripStanding(trip.id, enabled);
      toast.current?.show({ severity: "success", summary: "Updated", detail: result.message });
      load();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not update", detail: err.message });
    }
  };

  /** Turn one of the two return policies on or off for a departure. */
  const toggleRefund = async (trip, which, enabled) => {
    try {
      const result = await setRefundOptions(trip.id, { [which]: enabled });
      toast.current?.show({ severity: "success", summary: "Updated", detail: result.message });
      load();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not update", detail: err.message });
    }
  };

  const openSeats = async (trip) => {
    setSeatsFor(trip);
    setSeatSearch("");
    try {
      setSeats(await fetchTripSeats(trip.id));
    } catch (err) {
      setSeats([]);
      toast.current?.show({ severity: "error", summary: "Could not load seats", detail: err.message });
    }
  };

  const visibleSeats = useMemo(() => {
    const term = seatSearch.trim().toLowerCase();
    if (!term) return seats;
    return seats.filter((s) =>
      [s.seatNumber, s.coachCode, s.coachClass, s.windowType, s.note, JSON.stringify(s.attributes)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [seats, seatSearch]);

  if (!canView) {
    return (
      <div className="card">
        <h1 className="page-title">Departures</h1>
        <p className="page-subtitle">You do not have permission to view departures.</p>
      </div>
    );
  }

  const dateBody = (row) => (
    <div>
      <div className="dep-date">{row.departureDate}</div>
      <div className="dep-day">{dayOf(row.departureDate)}</div>
    </div>
  );

  const seatsBody = (row) => {
    if (row.status === "cancelled") return <span style={{ color: "#9ca3af" }}>None</span>;
    if (row.seatCount === 0) {
      return <Tag value="No seats built" severity="warning" icon="pi pi-exclamation-triangle" />;
    }
    return (
      <div className="dep-seats">
        <strong>{row.seatCount}</strong>
        <ul className="dep-classes">
          {Object.entries(row.seatsByClass || {}).map(([name, count]) => (
            <li key={name}>
              <span>{name}</span>
              <b>{count}</b>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const actionBody = (row) => (
    <div className="dep-actions">
      <Button aria-label="View seats" tooltipOptions={TIP} icon="pi pi-th-large" rounded text tooltip="View seats" onClick={() => openSeats(row)} />
      <Button
        aria-label="Coaches — add, cancel or reinstate one"
        tooltipOptions={TIP}
        tooltip="Coaches — add, cancel or reinstate one"
        icon="pi pi-box"
        rounded
        text
        onClick={() => setCoachesFor(row)}
      />
      <Button aria-label="Rebuild from the current composition" tooltipOptions={TIP}
        icon="pi pi-refresh"
        rounded
        text
        tooltip="Rebuild from the current composition"
        disabled={!canManage || row.status === "cancelled"}
        onClick={() => doRebuild(row)}
      />
      {row.status === "cancelled" ? (
        <Button aria-label="Put back into service" tooltipOptions={TIP}
          icon="pi pi-replay"
          rounded
          text
          severity="success"
          tooltip="Put back into service"
          disabled={!canCancel}
          onClick={() => doReinstate(row)}
        />
      ) : (
        <Button aria-label="Cancel departure — refunds everyone aboard" tooltipOptions={TIP}
          icon="pi pi-times-circle"
          rounded
          text
          severity="danger"
          tooltip="Cancel departure — refunds everyone aboard"
          disabled={!canCancel}
          onClick={() => doCancel(row)}
        />
      )}
    </div>
  );

  /**
   * Which returns this departure offers.
   *
   * Shown as two switches in the row rather than behind a dialog: it is a
   * commercial setting an operator scans down a list of departures to check,
   * and hiding it a click away would make that impossible.
   */
  const returnsBody = (row) => {
    if (row.status === "cancelled") return <span className="request-readonly">—</span>;

    return (
      <div className="refund-switches">
        <label className="refund-switch">
          <Checkbox
            inputId={`conv-${row.id}`}
            checked={row.convenientReturnEnabled !== false}
            disabled={!canConfigureRefunds}
            onChange={(e) => toggleRefund(row, "convenient", e.checked)}
          />
          <span>Convenient</span>
        </label>
        <label className="refund-switch">
          <Checkbox
            inputId={`dem-${row.id}`}
            checked={row.demandReturnEnabled !== false}
            disabled={!canConfigureRefunds}
            onChange={(e) => toggleRefund(row, "demand", e.checked)}
          />
          <span>Demand</span>
        </label>
      </div>
    );
  };

  /**
   * Whether this departure sells connecting standing.
   *
   * Held under TRIP_MANAGE rather than the refund permission: deciding a train
   * is too crowded to carry standing passengers is an operational call, not a
   * commercial one.
   */
  const standingBody = (row) => {
    if (row.status === "cancelled") return <span className="request-readonly">—</span>;

    return (
      <label className="refund-switch">
        <Checkbox
          inputId={`std-${row.id}`}
          checked={row.standingEnabled !== false}
          disabled={!canManage}
          onChange={(e) => toggleStanding(row, e.checked)}
        />
        <span>{row.standingEnabled !== false ? "On sale" : "Off"}</span>
      </label>
    );
  };

  const horizonJob = jobs.find((j) => j.name === "trip.horizon");

  return (
    <div>
      <Toast ref={toast} />
      <ConfirmDialog />

      <div className="page-head">
        <div>
          <h1 className="page-title">Departures</h1>
          <p className="page-subtitle">
            A departure is a train on a date, and it is what tickets will attach to. Generation keeps
            a rolling window of them topped up, and repeating it changes nothing.
          </p>
        </div>
        <Button
          label="Generate"
          icon="pi pi-bolt"
          loading={generating}
          disabled={!canManage}
          onClick={generate}
        />
      </div>

      <div className="dep-metrics">
        <div className="dep-metric">
          <div className="dep-metric-value">{metrics.departures}</div>
          <div className="dep-metric-label">Scheduled departures</div>
        </div>
        <div className="dep-metric">
          <div className="dep-metric-value">{metrics.seats.toLocaleString()}</div>
          <div className="dep-metric-label">Seats materialised</div>
        </div>
        <div className="dep-metric">
          <div className="dep-metric-value">{metrics.trains}</div>
          <div className="dep-metric-label">Trains running</div>
        </div>
        <div className="dep-metric">
          <div className="dep-metric-value" style={{ fontSize: "0.95rem", paddingTop: "0.35rem" }}>
            {metrics.window}
          </div>
          <div className="dep-metric-label">Horizon</div>
        </div>
      </div>

      {metrics.unbuilt > 0 && (
        <Message
          severity="warn"
          style={{ width: "100%", marginBottom: "1rem" }}
          content={
            <span>
              <strong>{metrics.unbuilt} departures have no seats.</strong> Seats are only built from
              approved layouts. Approve the plans under Approvals, then Generate again or rebuild a
              departure.
            </span>
          }
        />
      )}

      <RefundJobBanner watch={refundWatch} canSeeJobs={canSeeJobs} onDismiss={() => setRefundWatch(null)} />

      <div className="card">
        <div className="net-toolbar">
          <Select
            value={trainFilter}
            options={[{ label: "All trains", value: null }, ...trains.map((t) => ({ label: t.name, value: t.id }))]}
            onChange={(e) => setTrainFilter(e.value)}
            placeholder="All trains"
            style={{ minWidth: 200 }}
          />
          <Select
            value={statusFilter}
            options={STATUS_FILTER}
            onChange={(e) => setStatusFilter(e.value)}
            style={{ minWidth: 170 }}
          />
          <div className="ui-toolbar__spacer" />
          {horizonJob && (
            <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
              Auto-generates every {horizonJob.everyMinutes} min
              {horizonJob.lastRun ? `, last run ${horizonJob.lastRun.ok ? "ok" : "failed"}` : ""}
            </span>
          )}
          <Button icon="pi pi-refresh" label="Refresh" outlined onClick={load} />
        </div>

        <DataTable
          value={filtered}
          loading={loading}
          dataKey="id"
          paginator
          rows={15}
          stripedRows
          emptyMessage="No departures in the horizon"
        >
          <Column header="Date" body={dateBody} sortable sortField="departureDate" style={{ width: "9rem" }} />
          <Column header="Train" body={(r) => r.train?.name} sortable sortField="train.name" />
          <Column header="Coaches" body={(r) => r.coachCount} style={{ width: "7rem" }} />
          <Column header="Seats" body={seatsBody} />
          <Column
            header="Status"
            body={(r) => <Tag value={r.status} severity={STATUS_SEVERITY[r.status]} />}
            style={{ width: "8rem" }}
          />
          <Column header="Returns offered" body={returnsBody} style={{ width: "13rem" }} />
          <Column header="Standing" body={standingBody} style={{ width: "8rem" }} />
          <Column header="" body={actionBody} bodyClassName="dep-actions-cell" style={{ width: "11rem" }} />
        </DataTable>
      </div>

      <Dialog
        header="Generation report"
        visible={!!report}
        style={{ width: "40rem", maxWidth: "95vw" }}
        onHide={() => setReport(null)}
      >
        {report && (
          <>
            <p style={{ marginTop: 0 }}>
              {report.from} to {report.to} ({report.horizonDays} days):{" "}
              <strong>{report.created}</strong> created, <strong>{report.existing}</strong> already
              existed, <strong>{report.seatsCreated}</strong> seats materialised.
            </p>
            <div className="route-table-scroll">
              <table className="route-table">
                <thead>
                  <tr>
                    <th>Train</th>
                    <th style={{ width: "5rem" }}>New</th>
                    <th style={{ width: "5rem" }}>Existing</th>
                    <th style={{ width: "5rem" }}>Seats</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {report.trains.map((t) => (
                    <tr key={t.train}>
                      <td>{t.train}</td>
                      <td>{t.created}</td>
                      <td>{t.existing}</td>
                      <td>{t.seats}</td>
                      <td style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                        {t.notes.join("; ") || "None"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Dialog>

      <CancelWithReason
        visible={Boolean(cancelFor)}
        onHide={() => setCancelFor(null)}
        title={cancelFor ? `Cancel ${cancelFor.train.name}, ${cancelFor.departureDate}` : "Cancel departure"}
        intro={
          "Every passenger aboard is refunded their full fare, with nothing deducted, and emailed " +
          "the reason below. The refunds run in the background and survive a restart. You can put " +
          "the departure back afterwards, but the refunds stay paid."
        }
        onConfirm={confirmCancel}
      />

      <TripCoachesDialog
        trip={coachesFor}
        visible={Boolean(coachesFor)}
        onHide={() => {
          setCoachesFor(null);
          load();
        }}
        canManage={canManage}
        canCancel={canCancel}
        onRefundJob={watchRefunds}
        notify={notify}
      />

      <Dialog
        header={seatsFor ? `Seats: ${seatsFor.train.name}, ${seatsFor.departureDate}` : "Seats"}
        visible={!!seatsFor}
        style={{ width: "52rem", maxWidth: "95vw" }}
        onHide={() => setSeatsFor(null)}
      >
        <p className="dep-seats-intro">
          The flattened rows, one per physical seat, that seat inventory is sold against.{" "}
          <strong>{seats.length}</strong> seats on this departure.
        </p>
        <div className="ui-toolbar">
          <SearchBox
            value={seatSearch}
            onChange={setSeatSearch}
            placeholder="Seat, coach, class, window type, note or attribute"
            resultCount={seatSearch ? visibleSeats.length : undefined}
            noun="seat"
          />
        </div>
        <DataTable value={visibleSeats} dataKey="id" paginator rows={12} stripedRows emptyMessage="No seats match">
          <Column field="seatNumber" header="Seat" sortable style={{ width: "5.5rem" }} />
          <Column
            header="Coach"
            sortable
            sortField="coachPosition"
            body={(r) => (
              <span className="dep-seat-coach">
                <strong>{r.coachCode || `#${r.tripCoachId}`}</strong>
                {r.coachClass && <small>{r.coachClass}</small>}
              </span>
            )}
          />
          <Column
            header="Features"
            body={(r) => (
              <span className="dep-seat-features">
                {r.isWindow && (
                  <span title={`Window (${r.windowType || "full"})`}>
                    <i className="pi pi-window-maximize" aria-hidden="true" />
                    {r.windowType === "half" ? "Half window" : "Window"}
                  </span>
                )}
                {r.chargingPort && (
                  <span title="Charging port">
                    <i className="pi pi-bolt" aria-hidden="true" />
                    Port
                  </span>
                )}
                {r.fan && (
                  <span title="Fan">
                    <i className="pi pi-sun" aria-hidden="true" />
                    Fan
                  </span>
                )}
                {!r.isWindow && !r.chargingPort && !r.fan && <span className="dep-seat-none">—</span>}
              </span>
            )}
          />
          <Column
            header="Position"
            body={(r) => (
              <span className="dep-seat-pos">
                Row {r.rowIndex + 1} · place {r.cellIndex + 1}
              </span>
            )}
          />
          <Column header="Note" body={(r) => (r.note ? <span className="dep-seat-note">{r.note}</span> : "")} />
        </DataTable>
      </Dialog>
    </div>
  );
}
