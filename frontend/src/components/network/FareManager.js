"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { Column } from "primereact/column";
import Select from "@/components/ui/Select";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { Message } from "primereact/message";
import { confirmDialog } from "primereact/confirmdialog";
import {
  fetchFareRules,
  createFareRule,
  updateFareRule,
  deleteFareRule,
  saveFareTable,
  fetchFareMatrix,
  fetchTrains,
  fetchTrain,
} from "@/lib/network";
import { coachClassesApi } from "@/lib/reference";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";

import { tip } from "@/components/ui/tip";
const KINDS = [
  { label: "Station-pair table", value: "table" },
  { label: "Per kilometre", value: "distance" },
];

const EMPTY_RULE = {
  id: null,
  name: "",
  kind: "distance",
  priority: 100,
  trainId: null,
  coachClassId: null,
  ratePerKm: 1.5,
  minFare: 50,
};

export default function FareManager() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);

  const [rules, setRules] = useState([]);
  const [trains, setTrains] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const [tableRule, setTableRule] = useState(null);
  const [entries, setEntries] = useState([]);
  const [routeStops, setRouteStops] = useState([]);

  const [matrixTrain, setMatrixTrain] = useState(null);
  const [matrixClass, setMatrixClass] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [matrixLoading, setMatrixLoading] = useState(false);

  const canManage = hasPermission(PERMISSIONS.FARE_MANAGE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ruleList, trainList, classList] = await Promise.all([
        fetchFareRules(),
        fetchTrains(),
        coachClassesApi.list(),
      ]);
      setRules(ruleList);
      setTrains(trainList);
      setClasses(classList);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const trainOptions = [
    { label: "All trains", value: null },
    ...trains.map((t) => ({ label: t.name, value: t.id })),
  ];
  const classOptions = classes.map((c) => ({ label: c.name, value: c.id }));

  const saveRule = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        kind: form.kind,
        priority: form.priority,
        trainId: form.trainId,
        coachClassId: form.coachClassId,
        ...(form.kind === "distance" ? { ratePerKm: form.ratePerKm, minFare: form.minFare } : {}),
      };
      if (form.id) await updateFareRule(form.id, payload);
      else await createFareRule(payload);
      toast.current?.show({ severity: "success", summary: "Rule saved" });
      setForm(null);
      load();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Save failed", detail: err.message });
    } finally {
      setSaving(false);
    }
  };

  const openTable = async (rule) => {
    setTableRule(rule);
    setEntries((rule.entries || []).map((e) => ({ ...e })));
    if (rule.trainId) {
      try {
        const train = await fetchTrain(rule.trainId);
        setRouteStops(train.stops || []);
      } catch {
        setRouteStops([]);
      }
    } else {
      setRouteStops([]);
    }
  };

  const saveTable = async () => {
    setSaving(true);
    try {
      await saveFareTable(
        tableRule.id,
        entries.map((e) => ({
          fromStationId: e.fromStationId,
          toStationId: e.toStationId,
          amount: e.amount,
        }))
      );
      toast.current?.show({ severity: "success", summary: "Price table saved" });
      setTableRule(null);
      load();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Save failed", detail: err.message });
    } finally {
      setSaving(false);
    }
  };

  const loadMatrix = async () => {
    if (!matrixTrain || !matrixClass) return;
    setMatrixLoading(true);
    try {
      setMatrix(await fetchFareMatrix({ trainId: matrixTrain, coachClassId: matrixClass }));
    } catch (err) {
      setMatrix(null);
      toast.current?.show({ severity: "warn", summary: "No matrix", detail: err.message });
    } finally {
      setMatrixLoading(false);
    }
  };

  const kindBody = (row) => (
    <Tag
      value={row.kind === "table" ? "Table" : "Per km"}
      severity={row.kind === "table" ? "success" : "info"}
    />
  );

  const scopeBody = (row) => (row.train ? row.train.name : <em style={{ color: "#6b7280" }}>All trains</em>);

  const detailBody = (row) =>
    row.kind === "distance" ? (
      <span>
        {row.ratePerKm} / km{row.minFare ? ` · min ${row.minFare}` : ""}
      </span>
    ) : (
      <span>{row.entryCount ?? 0} pairs priced</span>
    );

  const ruleActions = (row) => (
    <div style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
      {row.kind === "table" && (
        <Button label="Prices" icon="pi pi-table" size="small" outlined onClick={() => openTable(row)} />
      )}
      <Button {...tip("Edit fare rule")}
        icon="pi pi-pencil"
        rounded
        text
        disabled={!canManage}
        onClick={() =>
          setForm({
            id: row.id,
            name: row.name,
            kind: row.kind,
            priority: row.priority,
            trainId: row.trainId,
            coachClassId: row.coachClassId,
            ratePerKm: row.ratePerKm ?? 1.5,
            minFare: row.minFare ?? 0,
          })
        }
      />
      <Button {...tip("Delete fare rule")}
        icon="pi pi-trash"
        rounded
        text
        severity="danger"
        disabled={!canManage}
        onClick={() =>
          confirmDialog({
            message: `Delete "${row.name}"? Journeys it priced will fall through to the next rule.`,
            header: "Delete fare rule",
            icon: "pi pi-exclamation-triangle",
            acceptClassName: "p-button-danger",
            accept: async () => {
              try {
                await deleteFareRule(row.id);
                toast.current?.show({ severity: "success", summary: "Deleted" });
                load();
              } catch (err) {
                toast.current?.show({ severity: "error", summary: "Delete failed", detail: err.message });
              }
            },
          })
        }
      />
    </div>
  );

  return (
    <div>
      <Toast ref={toast} />

      <Message
        severity="info"
        style={{ width: "100%", marginBottom: "1rem" }}
        content={
          <span>
            Rules run in <strong>priority order — lowest first</strong> — and the first that produces
            an amount wins. A table rule produces nothing for a pair it does not list, which is what
            lets it override the per-kilometre rate on some journeys and not others.
          </span>
        }
      />

      <div className="net-toolbar">
        <h3 style={{ margin: 0, flex: 1 }}>Rule chain</h3>
        <Button label="Add rule" icon="pi pi-plus" disabled={!canManage} onClick={() => setForm({ ...EMPTY_RULE })} />
      </div>

      <DataTable value={rules} loading={loading} dataKey="id" stripedRows emptyMessage="No fare rules yet">
        <Column field="priority" header="Priority" sortable style={{ width: "6rem" }} />
        <Column field="name" header="Rule" sortable />
        <Column header="Kind" body={kindBody} style={{ width: "8rem" }} />
        <Column header="Applies to" body={scopeBody} />
        <Column header="Class" body={(r) => r.coachClass?.name || "—"} />
        <Column header="Detail" body={detailBody} />
        <Column header="" body={ruleActions} style={{ width: "12rem" }} />
      </DataTable>

      {/* ---- Matrix ---- */}
      <h3 style={{ marginTop: "2rem" }}>What every journey costs</h3>
      <p style={{ color: "#6b7280", marginTop: 0, fontSize: "0.9rem" }}>
        Prices every forward station pair on a train, showing which rule produced each — so the gaps
        a fallback is covering are visible rather than implied.
      </p>

      <div className="net-toolbar">
        <Select
          value={matrixTrain}
          options={trains.map((t) => ({ label: t.name, value: t.id }))}
          onChange={(e) => setMatrixTrain(e.value)}
          placeholder="Train"
          filter
          style={{ minWidth: 220 }}
        />
        <Select
          value={matrixClass}
          options={classOptions}
          onChange={(e) => setMatrixClass(e.value)}
          placeholder="Class"
          style={{ minWidth: 180 }}
        />
        <Button
          label="Price them"
          icon="pi pi-calculator"
          onClick={loadMatrix}
          loading={matrixLoading}
          disabled={!matrixTrain || !matrixClass}
        />
      </div>

      {matrix && (
        <DataTable value={matrix.pairs} dataKey={(r) => `${r.fromStation.id}-${r.toStation.id}`} stripedRows paginator rows={12}>
          <Column header="From" body={(r) => r.fromStation.name} sortable />
          <Column header="To" body={(r) => r.toStation.name} sortable />
          <Column header="Km" body={(r) => (r.distanceKm ?? "—")} style={{ width: "6rem" }} />
          <Column
            header="Fare"
            body={(r) => (r.amount == null ? <Tag value="Unpriced" severity="danger" /> : <strong>{r.amount}</strong>)}
            style={{ width: "7rem" }}
          />
          <Column
            header="Priced by"
            body={(r) =>
              r.basis === "table" ? (
                <Tag value="Published table" severity="success" />
              ) : r.basis === "distance" ? (
                <Tag value="Per km" severity="info" />
              ) : (
                <Tag value="No rule" severity="danger" />
              )
            }
            style={{ width: "11rem" }}
          />
          <Column header="Why" body={(r) => <span style={{ fontSize: "0.82rem", color: "#6b7280" }}>{r.explanation}</span>} />
        </DataTable>
      )}

      {/* ---- Rule dialog ---- */}
      <Dialog
        header={form?.id ? `Edit "${form.name}"` : "New fare rule"}
        visible={!!form}
        style={{ width: "30rem" }}
        onHide={() => setForm(null)}
        footer={
          <>
            <Button label="Cancel" text onClick={() => setForm(null)} disabled={saving} />
            <Button
              label="Save"
              icon="pi pi-check"
              loading={saving}
              disabled={!form?.name?.trim() || !form?.coachClassId}
              onClick={saveRule}
            />
          </>
        }
      >
        {form && (
          <>
            <div className="field-block">
              <label htmlFor="fr-name">Name</label>
              <InputText id="fr-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: "100%" }} />
            </div>
            <div className="field-block">
              <label>Kind</label>
              <Select
                value={form.kind}
                options={KINDS}
                onChange={(e) => setForm({ ...form, kind: e.value })}
                disabled={!!form.id}
                style={{ width: "100%" }}
              />
              {form.id && <small style={{ color: "#6b7280" }}>A rule's kind cannot change after creation.</small>}
            </div>
            <div className="field-block">
              <label>Coach class</label>
              <Select value={form.coachClassId} options={classOptions} onChange={(e) => setForm({ ...form, coachClassId: e.value })} style={{ width: "100%" }} />
            </div>
            <div className="field-block">
              <label>Applies to</label>
              <Select value={form.trainId} options={trainOptions} onChange={(e) => setForm({ ...form, trainId: e.value })} style={{ width: "100%" }} />
            </div>
            <div className="field-block">
              <label>Priority</label>
              <InputNumber value={form.priority} onValueChange={(e) => setForm({ ...form, priority: e.value })} min={0} max={10000} style={{ width: "100%" }} />
              <small style={{ color: "#6b7280" }}>Lower runs first. Put fallbacks high.</small>
            </div>
            {form.kind === "distance" && (
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <div className="field-block" style={{ flex: 1 }}>
                  <label>Rate per km</label>
                  <InputNumber value={form.ratePerKm} onValueChange={(e) => setForm({ ...form, ratePerKm: e.value })} minFractionDigits={2} maxFractionDigits={4} min={0} />
                </div>
                <div className="field-block" style={{ flex: 1 }}>
                  <label>Minimum fare</label>
                  <InputNumber value={form.minFare} onValueChange={(e) => setForm({ ...form, minFare: e.value })} min={0} maxFractionDigits={2} />
                </div>
              </div>
            )}
          </>
        )}
      </Dialog>

      {/* ---- Price table dialog ---- */}
      <Dialog
        header={tableRule ? `Prices — ${tableRule.name}` : ""}
        visible={!!tableRule}
        style={{ width: "44rem", maxWidth: "95vw" }}
        onHide={() => setTableRule(null)}
        footer={
          <>
            <Button label="Cancel" text onClick={() => setTableRule(null)} disabled={saving} />
            <Button label="Save prices" icon="pi pi-check" loading={saving} disabled={!canManage} onClick={saveTable} />
          </>
        }
      >
        <p style={{ marginTop: 0, color: "#6b7280", fontSize: "0.88rem" }}>
          Only the pairs listed here are overridden. Everything else falls through to the next rule
          in the chain.
        </p>

        {routeStops.length === 0 && tableRule?.trainId && (
          <Message severity="warn" style={{ width: "100%", marginBottom: "0.75rem" }} text="This train has no route yet, so there are no station pairs to price." />
        )}

        <div className="route-table-scroll">
          <table className="route-table">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th style={{ width: "9rem" }}>Amount</th>
                <th style={{ width: "3rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr key={i}>
                  <td>
                    <Select
                      value={entry.fromStationId}
                      options={routeStops.map((s) => ({ label: s.station.name, value: s.stationId }))}
                      onChange={(e) => setEntries((prev) => prev.map((x, idx) => (idx === i ? { ...x, fromStationId: e.value } : x)))}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <Select
                      value={entry.toStationId}
                      options={routeStops.map((s) => ({ label: s.station.name, value: s.stationId }))}
                      onChange={(e) => setEntries((prev) => prev.map((x, idx) => (idx === i ? { ...x, toStationId: e.value } : x)))}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <InputNumber
                      value={entry.amount}
                      onValueChange={(e) => setEntries((prev) => prev.map((x, idx) => (idx === i ? { ...x, amount: e.value } : x)))}
                      min={0}
                      maxFractionDigits={2}
                      inputStyle={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <Button {...tip("Remove this price")} icon="pi pi-trash" rounded text severity="danger" size="small" onClick={() => setEntries((prev) => prev.filter((_, idx) => idx !== i))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button
          label="Add pair"
          icon="pi pi-plus"
          outlined
          style={{ marginTop: "0.75rem" }}
          disabled={routeStops.length < 2}
          onClick={() => setEntries((prev) => [...prev, { fromStationId: null, toStationId: null, amount: 0 }])}
        />
      </Dialog>
    </div>
  );
}
