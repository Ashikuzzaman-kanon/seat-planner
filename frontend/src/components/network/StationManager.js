"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { Column } from "primereact/column";
import { InputText } from "primereact/inputtext";
import SearchBox from "@/components/ui/SearchBox";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Tag } from "primereact/tag";
import { Checkbox } from "primereact/checkbox";
import { Toast } from "primereact/toast";
import { confirmDialog } from "primereact/confirmdialog";
import { fetchStations, createStation, updateStation, deleteStation } from "@/lib/network";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";

import { tip } from "@/components/ui/tip";
const EMPTY = { id: null, code: "", name: "", district: "", isActive: true };

export default function StationManager() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);

  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const canManage = hasPermission(PERMISSIONS.STATION_MANAGE);

  const load = useCallback(async (includeInactive) => {
    setLoading(true);
    try {
      setStations(await fetchStations({ includeInactive }));
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(showRetired);
  }, [load, showRetired]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return stations;
    return stations.filter((s) =>
      [s.code, s.name, s.district].filter(Boolean).join(" ").toLowerCase().includes(term)
    );
  }, [stations, search]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        district: form.district.trim() || null,
      };
      if (form.id) {
        const updated = await updateStation(form.id, { ...payload, isActive: form.isActive });
        setStations((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        toast.current?.show({ severity: "success", summary: `Saved ${updated.name}` });
      } else {
        const created = await createStation(payload);
        setStations((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        toast.current?.show({ severity: "success", summary: `Added ${created.name}` });
      }
      setForm(null);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Save failed", detail: err.message });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (station) =>
    confirmDialog({
      message: `Delete ${station.name}? Routes and fares that reference it will block this — retire it instead if it is in use.`,
      header: "Delete station",
      icon: "pi pi-exclamation-triangle",
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          await deleteStation(station.id);
          setStations((prev) => prev.filter((s) => s.id !== station.id));
          toast.current?.show({ severity: "success", summary: `Deleted ${station.name}` });
        } catch (err) {
          toast.current?.show({ severity: "warn", summary: "Not deleted", detail: err.message, life: 6000 });
        }
      },
    });

  const statusBody = (row) =>
    row.isActive ? (
      <Tag value="In service" severity="success" />
    ) : (
      <Tag value="Retired" severity="secondary" />
    );

  const actionBody = (row) => (
    <div style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
      <Button {...tip("Edit station")} icon="pi pi-pencil" rounded text disabled={!canManage} onClick={() => setForm({ ...row, district: row.district || "" })} />
      <Button {...tip("Delete station")} icon="pi pi-trash" rounded text severity="danger" disabled={!canManage} onClick={() => confirmDelete(row)} />
    </div>
  );

  return (
    <div>
      <Toast ref={toast} />

      <div className="net-toolbar">
        <SearchBox
                      value={search}
                      onChange={setSearch}
                      placeholder="Search code, name or district"
                      className="net-search"
                    />
        <div className="net-toolbar-check">
          <Checkbox inputId="retired" checked={showRetired} onChange={(e) => setShowRetired(e.checked)} />
          <label htmlFor="retired">Show retired</label>
        </div>
        <Button label="Add station" icon="pi pi-plus" disabled={!canManage} onClick={() => setForm({ ...EMPTY })} />
      </div>

      <DataTable
        value={filtered}
        loading={loading}
        dataKey="id"
        paginator
        rows={15}
        stripedRows
        emptyMessage="No stations found"
      >
        <Column field="code" header="Code" sortable style={{ width: "7rem" }} />
        <Column field="name" header="Station" sortable />
        <Column field="district" header="District" sortable />
        <Column header="Status" body={statusBody} style={{ width: "9rem" }} />
        <Column header="" body={actionBody} style={{ width: "7rem" }} />
      </DataTable>

      <Dialog
        header={form?.id ? `Edit ${form.name}` : "New station"}
        visible={!!form}
        style={{ width: "26rem" }}
        onHide={() => setForm(null)}
        footer={
          <>
            <Button label="Cancel" text onClick={() => setForm(null)} disabled={saving} />
            <Button
              label="Save"
              icon="pi pi-check"
              loading={saving}
              disabled={!form?.code?.trim() || !form?.name?.trim()}
              onClick={save}
            />
          </>
        }
      >
        {form && (
          <>
            <div className="field-block">
              <label htmlFor="st-code">Code</label>
              <InputText
                id="st-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="DHK"
                style={{ width: "100%", textTransform: "uppercase" }}
              />
            </div>
            <div className="field-block">
              <label htmlFor="st-name">Name</label>
              <InputText
                id="st-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={{ width: "100%" }}
              />
            </div>
            <div className="field-block">
              <label htmlFor="st-district">District</label>
              <InputText
                id="st-district"
                value={form.district}
                onChange={(e) => setForm({ ...form, district: e.target.value })}
                style={{ width: "100%" }}
              />
            </div>
            {form.id && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
                <Checkbox
                  inputId="st-active"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.checked })}
                />
                <label htmlFor="st-active">In service</label>
              </div>
            )}
          </>
        )}
      </Dialog>
    </div>
  );
}
