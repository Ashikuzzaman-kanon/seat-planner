"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Select from "@/components/ui/Select";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { Message } from "primereact/message";
import { Dialog } from "primereact/dialog";
import DataTable from "@/components/ui/DataTable";
import When from "@/components/ui/When";
import { Column } from "primereact/column";
import { Checkbox } from "primereact/checkbox";
import { ProgressSpinner } from "primereact/progressspinner";
import { InputNumber } from "primereact/inputnumber";
import {
  fetchMatrix,
  fetchAvailability,
  fetchTripQuota,
  releaseTripQuota,
  setSeatQuota,
  clearSeatQuota,
  fetchTripSeats,
  WITHHELD_LABELS,
} from "@/lib/inventory";
import { fetchTrips } from "@/lib/departures";
import SeatOccupancy from "@/components/inventory/SeatOccupancy";
import PairMatrix, { PairMatrixLegend } from "@/components/ui/PairMatrix";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import "@/components/network/network.css";
import "./inventory.css";

import { TIP } from "@/components/ui/tip";
export default function InventoryPage() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);

  const [trips, setTrips] = useState([]);
  const [tripId, setTripId] = useState(null);
  const [classId, setClassId] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [quota, setQuota] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [filters, setFilters] = useState({});
  const [seats, setSeats] = useState([]);
  const [hold, setHold] = useState({ seatId: null, fromStationId: null, toStationId: null, hours: 24 });
  const [holding, setHolding] = useState(false);

  const canView = hasPermission(PERMISSIONS.INVENTORY_VIEW);
  const canManageQuota = hasPermission(PERMISSIONS.QUOTA_MANAGE);

  useEffect(() => {
    if (!canView) return;
    fetchTrips({ limit: 500 })
      .then((list) => {
        const sellable = list.filter((t) => t.status === "scheduled" && t.seatCount > 0);
        setTrips(sellable);
        if (sellable.length) setTripId(sellable[0].id);
      })
      .catch((err) => toast.current?.show({ severity: "error", summary: "Error", detail: err.message }));
  }, [canView]);

  const load = useCallback(async () => {
    if (!tripId) return;
    setLoading(true);
    try {
      const [m, q, s] = await Promise.all([
        fetchMatrix({ tripId, coachClassId: classId }),
        fetchTripQuota(tripId).catch(() => []),
        fetchTripSeats(tripId).catch(() => []),
      ]);
      setMatrix(m);
      setQuota(q);
      setSeats(s);
    } catch (err) {
      setMatrix(null);
      toast.current?.show({ severity: "error", summary: "Could not load", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, [tripId, classId]);

  useEffect(() => {
    load();
  }, [load]);

  const openPair = async (pair) => {
    try {
      const result = await fetchAvailability({
        tripId,
        fromStationId: pair.fromStationId,
        toStationId: pair.toStationId,
        coachClassId: classId,
        filters,
      });
      setDetail({ pair, result });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Lookup failed", detail: err.message });
    }
  };

  const doHold = async () => {
    setHolding(true);
    try {
      const result = await setSeatQuota({
        tripId,
        seatId: hold.seatId,
        fromStationId: hold.fromStationId,
        toStationId: hold.toStationId,
        releaseHoursBefore: hold.hours,
      });
      toast.current?.show({ severity: "success", summary: result.message });
      setHold({ ...hold, seatId: null });
      load();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not hold that seat", detail: err.message, life: 6000 });
    } finally {
      setHolding(false);
    }
  };

  const doClearSeat = async (row) => {
    try {
      const result = await clearSeatQuota({ tripId, seatId: row.tripSeatId });
      toast.current?.show({ severity: "success", summary: result.message });
      load();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not release", detail: err.message });
    }
  };

  const doRelease = async () => {
    try {
      const result = await releaseTripQuota(tripId);
      toast.current?.show({ severity: "success", summary: result.message });
      load();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Release failed", detail: err.message });
    }
  };

  if (!canView) {
    return (
      <div className="card">
        <h1 className="page-title">Seat Inventory</h1>
        <p className="page-subtitle">You do not have permission to view seat availability.</p>
      </div>
    );
  }

  const heldCount = quota.filter((q) => !q.isReleased).length;

  return (
    <div>
      <Toast ref={toast} />

      <h1 className="page-title">Seat Inventory</h1>
      <p className="page-subtitle">
        A seat is sold for the stretch of route a passenger occupies, not for the whole departure.
        Sell the middle of a route and both ends stay on sale, on the same seat.
      </p>

      <div className="card">
        <div className="net-toolbar">
          <Select
            value={tripId}
            options={trips.map((t) => ({
              label: `${t.train.name} — ${t.departureDate} (${t.seatCount} seats)`,
              value: t.id,
            }))}
            onChange={(e) => setTripId(e.value)}
            placeholder="Choose a departure"
            filter
            style={{ minWidth: 320 }}
          />
          <Select
            value={classId}
            options={[
              { label: "All classes", value: null },
              ...(matrix?.classes || []).map((c) => ({ label: c.name, value: c.id })),
            ]}
            onChange={(e) => setClassId(e.value)}
            style={{ minWidth: 180 }}
          />
          <div className="ui-toolbar__spacer" />
          <Button icon="pi pi-refresh" label="Refresh" outlined onClick={load} />
        </div>

        {loading && (
          <div style={{ display: "flex", justifyContent: "center", padding: "2rem" }}>
            <ProgressSpinner style={{ width: 40, height: 40 }} />
          </div>
        )}

        {!loading && matrix && (
          <>
            <dl className="inv-stats">
              <div>
                <dt>Seats</dt>
                <dd>{matrix.totalSeats}</dd>
              </div>
              <div>
                <dt>Stops</dt>
                <dd>{matrix.stops.length}</dd>
              </div>
              <div>
                <dt>Segments</dt>
                <dd>{matrix.segmentCount}</dd>
              </div>
              <div>
                <dt>Sellable pairs</dt>
                <dd>{matrix.pairs.length}</dd>
              </div>
              {heldCount > 0 && (
                <div className="is-warn">
                  <dt>
                    <i className="pi pi-lock" aria-hidden="true" /> Held for pairs
                  </dt>
                  <dd>{heldCount}</dd>
                </div>
              )}
            </dl>

            <PairMatrix
              stops={matrix.stops}
              pairs={matrix.pairs}
              // An operator opens any pair, sold out or not: which seats went,
              // and to whom, is exactly what they came to find out.
              canPick={() => true}
              onPick={openPair}
              caption="Seats free between each pair of stations on this departure"
            />
            <PairMatrixLegend note="Open any cell to see which seats, and why the rest are withheld." />
          </>
        )}

        {!loading && !matrix && tripId && (
          <Message severity="warn" style={{ width: "100%" }} text="This departure has no seats to sell yet." />
        )}
      </div>

      {matrix && canManageQuota && (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h3 style={{ marginTop: 0 }}>Hold one specific seat</h3>
          <p style={{ marginTop: 0, color: "#6b7280", fontSize: "0.88rem", maxWidth: "62ch" }}>
            Name the seat and the station pair yourself. The standing rules hold a{" "}
            <em>quantity</em> and let the system choose which seats; this is for when the
            particular seat matters. A hold placed here survives a rule rebuild.
          </p>

          <div className="net-toolbar">
            <Select
              value={hold.seatId}
              options={seats.map((s) => ({
                label: `Seat ${s.seatNumber}${s.isWindow ? " (window)" : ""}`,
                value: s.id,
              }))}
              onChange={(e) => setHold({ ...hold, seatId: e.value })}
              placeholder="Seat"
              filter
              style={{ minWidth: 180 }}
            />
            <Select
              value={hold.fromStationId}
              options={matrix.stops.slice(0, -1).map((s) => ({ label: s.station?.name, value: s.stationId }))}
              onChange={(e) => setHold({ ...hold, fromStationId: e.value })}
              placeholder="From"
              style={{ minWidth: 190 }}
            />
            <Select
              value={hold.toStationId}
              options={matrix.stops.slice(1).map((s) => ({ label: s.station?.name, value: s.stationId }))}
              onChange={(e) => setHold({ ...hold, toStationId: e.value })}
              placeholder="To"
              style={{ minWidth: 190 }}
            />
            <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <InputNumber
                value={hold.hours}
                onValueChange={(e) => setHold({ ...hold, hours: e.value })}
                min={0}
                max={8760}
                inputStyle={{ width: "5rem" }}
              />
              <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>h before departure, release</span>
            </span>
            <Button
              label="Hold seat"
              icon="pi pi-lock"
              loading={holding}
              disabled={!hold.seatId || !hold.fromStationId || !hold.toStationId}
              onClick={doHold}
            />
          </div>
        </div>
      )}

      {quota.length > 0 && (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <div className="net-toolbar">
            <h3 style={{ margin: 0, flex: 1 }}>Seats held for specific station pairs</h3>
            <Button
              label="Release all now"
              icon="pi pi-unlock"
              outlined
              disabled={!canManageQuota || heldCount === 0}
              onClick={doRelease}
            />
          </div>
          <p style={{ marginTop: 0, color: "#6b7280", fontSize: "0.88rem" }}>
            A held seat sells only as exactly its own pair, until its release time passes. Without
            that release, exact matching would simply strand the seat.
          </p>
          <DataTable value={quota} dataKey="id" paginator rows={10} stripedRows>
            <Column header="Seat" body={(r) => r.seatNumber} style={{ width: "6rem" }} />
            <Column header="Held for" body={(r) => `${r.fromStation?.name} to ${r.toStation?.name}`} />
            <Column
              header="Releases"
              body={(r) => (r.releaseAt ? <When value={r.releaseAt} /> : "never")}
            />
            <Column
              header="Set by"
              body={(r) =>
                r.ruleId ? (
                  <Tag value="Standing rule" severity="info" />
                ) : (
                  <Tag value="By hand" severity="contrast" icon="pi pi-user" />
                )
              }
              style={{ width: "10rem" }}
            />
            <Column
              header="Status"
              body={(r) =>
                r.isReleased ? (
                  <Tag value="Open again" severity="success" />
                ) : (
                  <Tag value="Held" severity="warning" />
                )
              }
              style={{ width: "9rem" }}
            />
            <Column
              header=""
              body={(r) => (
                <Button aria-label="Return this seat to open sale" tooltipOptions={TIP}
                  icon="pi pi-unlock"
                  rounded
                  text
                  tooltip="Return this seat to open sale"
                  disabled={!canManageQuota}
                  onClick={() => doClearSeat(r)}
                />
              )}
              style={{ width: "4rem" }}
            />
          </DataTable>
        </div>
      )}

      <Dialog
        header={
          detail
            ? `${detail.pair.fromStation?.name} to ${detail.pair.toStation?.name}`
            : "Availability"
        }
        visible={!!detail}
        style={{ width: "52rem", maxWidth: "96vw" }}
        onHide={() => setDetail(null)}
      >
        {detail && (
          <>
            <div className="inv-summary">
              <Tag value={`${detail.result.availableCount} of ${detail.result.totalSeats} free`} severity="success" />
              <Tag
                value={`${detail.result.segments.length} segment${detail.result.segments.length === 1 ? "" : "s"} of route`}
                severity="info"
              />
            </div>

            <div style={{ margin: "1rem 0" }}>
              <div style={{ fontWeight: 600, marginBottom: "0.4rem" }}>Filter by feature</div>
              <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
                {[
                  ["window", "Window"],
                  ["charging_port", "Charging port"],
                  ["fan", "Fan"],
                ].map(([key, label]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <Checkbox
                      inputId={`f-${key}`}
                      checked={!!filters[key]}
                      onChange={(e) => {
                        const next = { ...filters, [key]: e.checked };
                        if (!e.checked) delete next[key];
                        setFilters(next);
                        fetchAvailability({
                          tripId,
                          fromStationId: detail.pair.fromStationId,
                          toStationId: detail.pair.toStationId,
                          coachClassId: classId,
                          filters: next,
                        }).then((result) => setDetail({ ...detail, result }));
                      }}
                    />
                    <label htmlFor={`f-${key}`}>{label}</label>
                  </div>
                ))}
              </div>
            </div>

            {Object.keys(detail.result.withheld).length > 0 && (
              <>
                <div style={{ fontWeight: 600, marginBottom: "0.4rem" }}>Why the rest are not offered</div>
                <ul style={{ marginTop: 0 }}>
                  {Object.entries(detail.result.withheld).map(([reason, count]) => (
                    <li key={reason}>
                      <strong>{count}</strong> — {WITHHELD_LABELS[reason] || reason}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/*
              Every seat over this stretch, not only the sellable ones. Which
              seats are gone — and to whom — is the question an operator opens
              this dialog to answer.
            */}
            <div style={{ fontWeight: 600, margin: "1rem 0 0.5rem" }}>Every seat on this stretch</div>
            <SeatOccupancy
              tripId={tripId}
              fromStationId={detail.pair.fromStationId}
              toStationId={detail.pair.toStationId}
              coachClassId={classId}
              classes={matrix?.classes}
            />
          </>
        )}
      </Dialog>
    </div>
  );
}
