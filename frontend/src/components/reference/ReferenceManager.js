"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { confirmDialog } from "primereact/confirmdialog";

/**
 * Generic add / rename / delete manager for one reference list.
 * `apiClient` is one of the objects from lib/reference.js.
 */
export default function ReferenceManager({ title, singular, apiClient }) {
  const toast = useRef(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await apiClient.list());
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const item = await apiClient.create(name);
      setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      toast.current?.show({ severity: "success", summary: "Added", detail: item.name });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Add failed", detail: err.message });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setEditingName(row.name);
  };

  const saveEdit = async (row) => {
    const name = editingName.trim();
    if (!name || name === row.name) {
      setEditingId(null);
      return;
    }
    try {
      const updated = await apiClient.update(row.id, name);
      setItems((prev) => prev.map((i) => (i.id === row.id ? updated : i)));
      toast.current?.show({ severity: "success", summary: "Renamed", detail: updated.name });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Rename failed", detail: err.message });
    } finally {
      setEditingId(null);
    }
  };

  const remove = (row) => {
    confirmDialog({
      message: `Delete ${singular.toLowerCase()} "${row.name}"?`,
      header: "Confirm delete",
      icon: "pi pi-exclamation-triangle",
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          await apiClient.remove(row.id);
          setItems((prev) => prev.filter((i) => i.id !== row.id));
          toast.current?.show({ severity: "success", summary: "Deleted", detail: row.name });
        } catch (err) {
          toast.current?.show({ severity: "error", summary: "Delete failed", detail: err.message });
        }
      },
    });
  };

  const nameBody = (row) =>
    editingId === row.id ? (
      <InputText
        value={editingName}
        autoFocus
        onChange={(e) => setEditingName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") saveEdit(row);
          if (e.key === "Escape") setEditingId(null);
        }}
        style={{ width: "100%" }}
      />
    ) : (
      row.name
    );

  const actionBody = (row) => (
    <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
      {editingId === row.id ? (
        <>
          <Button icon="pi pi-check" rounded text severity="success" onClick={() => saveEdit(row)} />
          <Button icon="pi pi-times" rounded text severity="secondary" onClick={() => setEditingId(null)} />
        </>
      ) : (
        <>
          <Button icon="pi pi-pencil" rounded text onClick={() => startEdit(row)} />
          <Button icon="pi pi-trash" rounded text severity="danger" onClick={() => remove(row)} />
        </>
      )}
    </div>
  );

  return (
    <div>
      <Toast ref={toast} />
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <InputText
          value={newName}
          placeholder={`New ${singular.toLowerCase()} name`}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          style={{ flex: 1 }}
        />
        <Button label="Add" icon="pi pi-plus" loading={saving} onClick={add} disabled={!newName.trim()} />
      </div>

      <DataTable value={items} loading={loading} dataKey="id" emptyMessage={`No ${title.toLowerCase()} yet`} stripedRows paginator rows={10}>
        <Column field="name" header="Name" body={nameBody} sortable />
        <Column header="" body={actionBody} style={{ width: "8rem" }} />
      </DataTable>
    </div>
  );
}
