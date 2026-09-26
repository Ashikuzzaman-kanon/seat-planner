"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { Column } from "primereact/column";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import Select from "@/components/ui/Select";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { Message } from "primereact/message";
import { confirmDialog } from "primereact/confirmdialog";
import {
  fetchSeatAttributes,
  createSeatAttribute,
  updateSeatAttribute,
  deleteSeatAttribute,
} from "@/lib/network";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";

import { tip } from "@/components/ui/tip";
const VALUE_TYPES = [
  { label: "Yes / no", value: "boolean" },
  { label: "Choice from a list", value: "enum" },
];

const EMPTY = {
  id: null,
  key: "",
  label: "",
  description: "",
  valueType: "boolean",
  options: [],
  icon: "",
  isFilterable: true,
  isActive: true,
  sortOrder: 100,
};

export default function SeatAttributeManager() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);

  const [attributes, setAttributes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const canManage = hasPermission(PERMISSIONS.SEAT_ATTRIBUTE_MANAGE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAttributes(await fetchSeatAttributes({ includeInactive: true }));
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        key: form.key.trim(),
        label: form.label.trim(),
        description: form.description.trim() || null,
        valueType: form.valueType,
        options: form.valueType === "enum" ? form.options : null,
        icon: form.icon.trim() || null,
        isFilterable: form.isFilterable,
        sortOrder: form.sortOrder,
        ...(form.id ? { isActive: form.isActive } : {}),
      };
      if (form.id) await updateSeatAttribute(form.id, payload);
      else await createSeatAttribute(payload);
      toast.current?.show({ severity: "success", summary: "Attribute saved" });
      setForm(null);
      load();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Save failed", detail: err.message });
    } finally {
      setSaving(false);
    }
  };

  const typeBody = (row) =>
    row.valueType === "enum" ? (
      <div>
        <Tag value="Choice" severity="warning" />
        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.2rem" }}>
          {(row.options || []).map((o) => o.label).join(" · ")}
        </div>
      </div>
    ) : (
      <Tag value="Yes / no" severity="info" />
    );

  const actions = (row) => (
    <div style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
      <Button {...tip("Edit attribute")}
        icon="pi pi-pencil"
        rounded
        text
        disabled={!canManage}
        onClick={() =>
          setForm({
            ...row,
            description: row.description || "",
            icon: row.icon || "",
            options: row.options || [],
          })
        }
      />
      <Button {...tip("Delete attribute")}
        icon="pi pi-trash"
        rounded
        text
        severity="danger"
        disabled={!canManage}
        onClick={() =>
          confirmDialog({
            message: `Delete "${row.label}"? Seats already carrying this attribute keep the value in their layout, but nothing will describe it. Deactivating is usually safer.`,
            header: "Delete attribute",
            icon: "pi pi-exclamation-triangle",
            acceptClassName: "p-button-danger",
            accept: async () => {
              try {
                await deleteSeatAttribute(row.id);
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
            Auto-select builds its filters from this catalogue, so anything added here becomes
            something a passenger can search for — without a code change.
          </span>
        }
      />

      <div className="net-toolbar">
        <h3 style={{ margin: 0, flex: 1 }}>Seat attributes</h3>
        <Button label="Add attribute" icon="pi pi-plus" disabled={!canManage} onClick={() => setForm({ ...EMPTY })} />
      </div>

      <DataTable value={attributes} loading={loading} dataKey="id" stripedRows emptyMessage="No attributes defined">
        <Column field="sortOrder" header="Order" sortable style={{ width: "6rem" }} />
        <Column field="label" header="Attribute" sortable />
        <Column field="key" header="Key" body={(r) => <code>{r.key}</code>} />
        <Column header="Type" body={typeBody} />
        <Column field="description" header="Description" bodyClassName="ui-cell--text" />
        <Column
          header="Filterable"
          body={(r) => (r.isFilterable ? <Tag value="Yes" severity="success" /> : <Tag value="No" severity="secondary" />)}
          style={{ width: "8rem" }}
        />
        <Column
          header="Status"
          body={(r) => (r.isActive ? <Tag value="Active" severity="success" /> : <Tag value="Off" severity="secondary" />)}
          style={{ width: "7rem" }}
        />
        <Column header="" body={actions} style={{ width: "7rem" }} />
      </DataTable>

      <Dialog
        header={form?.id ? `Edit ${form.label}` : "New seat attribute"}
        visible={!!form}
        style={{ width: "32rem" }}
        onHide={() => setForm(null)}
        footer={
          <>
            <Button label="Cancel" text onClick={() => setForm(null)} disabled={saving} />
            <Button
              label="Save"
              icon="pi pi-check"
              loading={saving}
              disabled={!form?.key?.trim() || !form?.label?.trim()}
              onClick={save}
            />
          </>
        }
      >
        {form && (
          <>
            <div className="field-block">
              <label htmlFor="sa-label">Label</label>
              <InputText id="sa-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} style={{ width: "100%" }} />
            </div>
            <div className="field-block">
              <label htmlFor="sa-key">Key</label>
              <InputText id="sa-key" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="charging_port" style={{ width: "100%" }} />
              <small style={{ color: "#6b7280" }}>Stored on every seat. Punctuation becomes underscores.</small>
            </div>
            <div className="field-block">
              <label htmlFor="sa-desc">Description</label>
              <InputText id="sa-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ width: "100%" }} />
            </div>
            <div className="field-block">
              <label>Type</label>
              <Select value={form.valueType} options={VALUE_TYPES} onChange={(e) => setForm({ ...form, valueType: e.value })} style={{ width: "100%" }} />
            </div>

            {form.valueType === "enum" && (
              <div className="field-block">
                <label>Choices</label>
                {form.options.map((option, i) => (
                  <div key={i} style={{ display: "flex", gap: "0.4rem", marginBottom: "0.35rem" }}>
                    <InputText
                      value={option.value}
                      placeholder="value"
                      onChange={(e) =>
                        setForm({
                          ...form,
                          options: form.options.map((o, idx) => (idx === i ? { ...o, value: e.target.value } : o)),
                        })
                      }
                      style={{ flex: 1 }}
                    />
                    <InputText
                      value={option.label}
                      placeholder="label"
                      onChange={(e) =>
                        setForm({
                          ...form,
                          options: form.options.map((o, idx) => (idx === i ? { ...o, label: e.target.value } : o)),
                        })
                      }
                      style={{ flex: 1 }}
                    />
                    <Button {...tip("Remove this option")}
                      icon="pi pi-trash"
                      rounded
                      text
                      severity="danger"
                      onClick={() => setForm({ ...form, options: form.options.filter((_, idx) => idx !== i) })}
                    />
                  </div>
                ))}
                <Button
                  label="Add choice"
                  icon="pi pi-plus"
                  text
                  size="small"
                  onClick={() => setForm({ ...form, options: [...form.options, { value: "", label: "" }] })}
                />
              </div>
            )}

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <div className="field-block" style={{ flex: 1 }}>
                <label htmlFor="sa-icon">Icon class</label>
                <InputText id="sa-icon" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="pi pi-bolt" style={{ width: "100%" }} />
              </div>
              <div className="field-block" style={{ flex: 1 }}>
                <label>Sort order</label>
                <InputNumber value={form.sortOrder} onValueChange={(e) => setForm({ ...form, sortOrder: e.value })} min={0} max={10000} style={{ width: "100%" }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: "1.25rem", marginTop: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                <Checkbox inputId="sa-filter" checked={form.isFilterable} onChange={(e) => setForm({ ...form, isFilterable: e.checked })} />
                <label htmlFor="sa-filter">Passengers can filter on it</label>
              </div>
              {form.id && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                  <Checkbox inputId="sa-active" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.checked })} />
                  <label htmlFor="sa-active">Active</label>
                </div>
              )}
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
