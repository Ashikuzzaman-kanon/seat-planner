"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { Message } from "primereact/message";
import { confirmDialog, ConfirmDialog } from "primereact/confirmdialog";
import { coachClassesApi } from "@/lib/reference";

import { TIP } from "@/components/ui/tip";
/**
 * Coach classes, and how many may stand in one.
 *
 * The generic reference manager handles tables that are a name and nothing
 * else. A coach class outgrew that: it decides whether connecting standing is
 * sold at all, and for how many people, which is a fact about the class rather
 * than about any particular train. A Shovon coach has floor space; an AC cabin
 * does not.
 *
 * Zero is the default and means the class sells no standing. That is the safe
 * way round — an administrator opts a class in, rather than having to remember
 * to opt every sleeper out.
 */
export default function CoachClassManager() {
  const toast = useRef(null);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await coachClassesApi.list());
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
        name: editing.name.trim(),
        standingCapacity: Number(editing.standingCapacity) || 0,
      };

      if (editing.id) await coachClassesApi.update(editing.id, payload);
      else await coachClassesApi.create(payload);

      toast.current?.show({
        severity: "success",
        summary: "Saved",
        detail: payload.standingCapacity
          ? `${payload.name} allows ${payload.standingCapacity} standing per coach.`
          : `${payload.name} sells no standing.`,
      });
      setEditing(null);
      await load();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not save", detail: err.message });
    } finally {
      setSaving(false);
    }
  };

  const remove = (row) =>
    confirmDialog({
      message: `Delete the coach class "${row.name}"?`,
      header: "Delete coach class",
      icon: "pi pi-exclamation-triangle",
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          await coachClassesApi.remove(row.id);
          toast.current?.show({ severity: "success", summary: "Deleted" });
          load();
        } catch (err) {
          toast.current?.show({ severity: "error", summary: "Could not delete", detail: err.message });
        }
      },
    });

  const capacityBody = (row) =>
    row.standingCapacity > 0 ? (
      <Tag
        icon="pi pi-users"
        severity="warning"
        value={`${row.standingCapacity} per coach`}
      />
    ) : (
      <span className="class-nostanding">No standing</span>
    );

  return (
    <div>
      <Toast ref={toast} />
      <ConfirmDialog />

      <Message
        severity="info"
        className="class-hint"
        content={
          <span>
            <strong>Standing capacity</strong> is how many passengers may stand in one coach of
            this class, over any given segment. Zero means the class sells no connecting standing
            at all. A departure can also have standing switched off individually, under Departures.
          </span>
        }
      />

      <div className="net-toolbar">
        <Button
          label="Add coach class"
          icon="pi pi-plus"
          size="small"
          onClick={() => setEditing({ name: "", standingCapacity: 0 })}
        />
      </div>

      <DataTable value={rows} loading={loading} stripedRows size="small" dataKey="id"
        emptyMessage="No coach classes yet.">
        <Column field="name" header="Class" sortable />
        <Column header="Standing capacity" body={capacityBody} sortable sortField="standingCapacity" />
        <Column
          header=""
          style={{ width: "7rem" }}
          body={(row) => (
            <div style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
              <Button tooltip="Edit class" tooltipOptions={TIP}
                icon="pi pi-pencil"
                text
                rounded
                aria-label={`Edit ${row.name}`}
                onClick={() => setEditing({ ...row })}
              />
              <Button tooltip="Delete class" tooltipOptions={TIP}
                icon="pi pi-trash"
                text
                rounded
                severity="danger"
                aria-label={`Delete ${row.name}`}
                onClick={() => remove(row)}
              />
            </div>
          )}
        />
      </DataTable>

      <Dialog
        header={editing?.id ? `Edit ${editing.name}` : "New coach class"}
        visible={Boolean(editing)}
        onHide={() => (saving ? null : setEditing(null))}
        style={{ width: "26rem", maxWidth: "94vw" }}
        draggable={false}
      >
        {editing && (
          <>
            <div className="passenger-field" style={{ marginBottom: "1rem" }}>
              <label htmlFor="class-name">Name</label>
              <InputText
                id="class-name"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Shovon, Snigdha, AC Chair…"
              />
            </div>

            <div className="passenger-field">
              <label htmlFor="class-standing">Standing capacity per coach</label>
              <InputNumber
                inputId="class-standing"
                value={editing.standingCapacity ?? 0}
                onValueChange={(e) => setEditing({ ...editing, standingCapacity: e.value ?? 0 })}
                min={0}
                max={200}
                showButtons
                inputStyle={{ width: "5rem" }}
              />
              <small className="class-field-hint">
                {Number(editing.standingCapacity) > 0
                  ? `Up to ${editing.standingCapacity} passengers may stand in each coach of this class, over any one segment.`
                  : "Zero means this class sells no connecting standing."}
              </small>
            </div>

            <div className="return-actions">
              <Button label="Cancel" text onClick={() => setEditing(null)} disabled={saving} />
              <Button
                label="Save"
                icon="pi pi-check"
                onClick={save}
                loading={saving}
                disabled={!editing.name?.trim()}
              />
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
