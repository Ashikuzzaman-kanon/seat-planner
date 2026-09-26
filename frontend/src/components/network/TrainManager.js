"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { Column } from "primereact/column";
import { InputText } from "primereact/inputtext";
import SearchBox from "@/components/ui/SearchBox";
import { InputTextarea } from "primereact/inputtextarea";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { fetchTrains, fetchStations, createTrain, updateTrain } from "@/lib/network";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import RouteBuilder from "./RouteBuilder";
import CompositionEditor from "@/components/departures/CompositionEditor";
import ScheduleEditor from "@/components/departures/ScheduleEditor";

import { tip } from "@/components/ui/tip";
const EMPTY = { id: null, name: "", code: "", upCode: "", downCode: "", notes: "" };

export default function TrainManager() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);

  const [trains, setTrains] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [routeTrain, setRouteTrain] = useState(null);
  const [compositionTrain, setCompositionTrain] = useState(null);
  const [scheduleTrain, setScheduleTrain] = useState(null);

  const canManageTrain = hasPermission(PERMISSIONS.TRAIN_MANAGE);
  const canManageRoute = hasPermission(PERMISSIONS.ROUTE_MANAGE);
  const canManageComposition = hasPermission(PERMISSIONS.COMPOSITION_MANAGE);
  const canManageSchedule = hasPermission(PERMISSIONS.SCHEDULE_MANAGE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [trainList, stationList] = await Promise.all([fetchTrains(), fetchStations()]);
      setTrains(trainList);
      setStations(stationList);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return trains;
    return trains.filter((t) =>
      [t.name, t.code, t.originStation, t.terminusStation]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [trains, search]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        upCode: form.upCode.trim() || null,
        downCode: form.downCode.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (form.id) {
        await updateTrain(form.id, payload);
        toast.current?.show({ severity: "success", summary: `Saved ${payload.name}` });
      } else {
        await createTrain(payload);
        toast.current?.show({ severity: "success", summary: `Added ${payload.name}` });
      }
      setForm(null);
      load();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Save failed", detail: err.message });
    } finally {
      setSaving(false);
    }
  };

  const routeBody = (row) => {
    if (!row.stopCount) {
      return <Tag value="No route yet" severity="warning" icon="pi pi-exclamation-triangle" />;
    }
    return (
      <div>
        <div style={{ fontWeight: 500 }}>
          {row.originStation} → {row.terminusStation}
        </div>
        <div style={{ fontSize: "0.78rem", color: "#6b7280" }}>
          {row.stopCount} stops · {row.segmentCount} segments
          {row.journeyMinutes != null &&
            ` · ${Math.floor(row.journeyMinutes / 60)}h ${String(row.journeyMinutes % 60).padStart(2, "0")}m`}
        </div>
      </div>
    );
  };

  const codeBody = (row) => (
    <div>
      <div>{row.code || "—"}</div>
      {(row.upCode || row.downCode) && (
        <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
          up {row.upCode || "—"} · down {row.downCode || "—"}
        </div>
      )}
    </div>
  );

  const actionBody = (row) => (
    <div style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
      <Button label="Route" icon="pi pi-map" size="small" outlined onClick={() => setRouteTrain(row)} />
      <Button
        label="Coaches"
        icon="pi pi-box"
        size="small"
        outlined
        onClick={() => setCompositionTrain(row)}
      />
      <Button
        label="Days"
        icon="pi pi-calendar"
        size="small"
        outlined
        onClick={() => setScheduleTrain(row)}
      />
      <Button {...tip("Edit train")}
        icon="pi pi-pencil"
        rounded
        text
        disabled={!canManageTrain}
        onClick={() =>
          setForm({
            id: row.id,
            name: row.name,
            code: row.code || "",
            upCode: row.upCode || "",
            downCode: row.downCode || "",
            notes: row.notes || "",
          })
        }
      />
    </div>
  );

  return (
    <div>
      <Toast ref={toast} />

      <div className="net-toolbar">
        <SearchBox
                      value={search}
                      onChange={setSearch}
                      placeholder="Search name, code or endpoints"
                      className="net-search"
                    />
        <Button label="Add train" icon="pi pi-plus" disabled={!canManageTrain} onClick={() => setForm({ ...EMPTY })} />
      </div>

      <DataTable value={filtered} loading={loading} dataKey="id" paginator rows={15} stripedRows emptyMessage="No trains found">
        <Column field="name" header="Train" sortable />
        <Column header="Code" body={codeBody} style={{ width: "10rem" }} />
        <Column header="Route" body={routeBody} />
        <Column header="" body={actionBody} style={{ width: "23rem" }} />
      </DataTable>

      <Dialog
        header={form?.id ? `Edit ${form.name}` : "New train"}
        visible={!!form}
        style={{ width: "30rem" }}
        onHide={() => setForm(null)}
        footer={
          <>
            <Button label="Cancel" text onClick={() => setForm(null)} disabled={saving} />
            <Button label="Save" icon="pi pi-check" loading={saving} disabled={!form?.name?.trim()} onClick={save} />
          </>
        }
      >
        {form && (
          <>
            <div className="field-block">
              <label htmlFor="tr-name">Name</label>
              <InputText id="tr-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: "100%" }} />
            </div>
            <div className="field-block">
              <label htmlFor="tr-code">Display code</label>
              <InputText id="tr-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="755/756" style={{ width: "100%" }} />
            </div>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <div className="field-block" style={{ flex: 1 }}>
                <label htmlFor="tr-up">Up code</label>
                <InputText id="tr-up" value={form.upCode} onChange={(e) => setForm({ ...form, upCode: e.target.value })} style={{ width: "100%" }} />
              </div>
              <div className="field-block" style={{ flex: 1 }}>
                <label htmlFor="tr-down">Down code</label>
                <InputText id="tr-down" value={form.downCode} onChange={(e) => setForm({ ...form, downCode: e.target.value })} style={{ width: "100%" }} />
              </div>
            </div>
            <div className="field-block">
              <label htmlFor="tr-notes">Operating notes</label>
              <InputTextarea id="tr-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ width: "100%" }} />
            </div>
          </>
        )}
      </Dialog>

      <RouteBuilder
        train={routeTrain}
        stations={stations}
        visible={!!routeTrain}
        canEdit={canManageRoute}
        onHide={() => setRouteTrain(null)}
        onSaved={(_train, message) => {
          toast.current?.show({ severity: "success", summary: "Route saved", detail: message });
          load();
        }}
      />

      <CompositionEditor
        train={compositionTrain}
        visible={!!compositionTrain}
        canEdit={canManageComposition}
        onHide={() => setCompositionTrain(null)}
        onSaved={(message) => {
          toast.current?.show({ severity: "success", summary: "Composition saved", detail: message });
          load();
        }}
      />

      <ScheduleEditor
        train={scheduleTrain}
        visible={!!scheduleTrain}
        canEdit={canManageSchedule}
        onHide={() => setScheduleTrain(null)}
        onSaved={(message) => {
          toast.current?.show({ severity: "success", summary: message });
          load();
        }}
      />
    </div>
  );
}
