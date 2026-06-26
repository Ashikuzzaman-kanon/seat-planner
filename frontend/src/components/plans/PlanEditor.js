"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import SeatGrid from "./SeatGrid";
import { fetchAllReferences } from "@/lib/reference";
import { listPlans, getPlan, createPlan, updatePlan, submitPlan } from "@/lib/plans";
import * as L from "@/lib/layout";

const refOptions = (items) => items.map((i) => ({ label: i.name, value: i.id }));

export default function PlanEditor({ planId }) {
  const router = useRouter();
  const toast = useRef(null);
  const isEdit = !!planId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refs, setRefs] = useState({ trainNames: [], coachTypes: [], coachClasses: [] });
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState(null);

  const [meta, setMeta] = useState({ coachNo: "", trainNameId: null, coachTypeId: null, coachClassId: null });
  const [layout, setLayout] = useState(() => L.createEmptyLayout());
  const [selected, setSelected] = useState(null); // { rowIdx, cellIdx }

  // Initial load: references, (edit) plan, (new) template options.
  useEffect(() => {
    (async () => {
      try {
        const [r, tpls] = await Promise.all([
          fetchAllReferences(),
          listPlans({ templates: 1 }).catch(() => []),
        ]);
        setRefs(r);
        setTemplates(tpls);
        if (isEdit) {
          const plan = await getPlan(planId);
          setMeta({
            coachNo: plan.coachNo,
            trainNameId: plan.trainNameId,
            coachTypeId: plan.coachTypeId,
            coachClassId: plan.coachClassId,
          });
          setLayout(L.recompute(plan.layout));
        }
      } catch (err) {
        toast.current?.show({ severity: "error", summary: "Load failed", detail: err.message });
      } finally {
        setLoading(false);
      }
    })();
  }, [isEdit, planId]);

  const applyTemplate = useCallback(async (id) => {
    setTemplateId(id);
    if (!id) return;
    try {
      const plan = await getPlan(id);
      setLayout(L.recompute(plan.layout));
      setMeta((m) => ({
        ...m,
        coachTypeId: plan.coachTypeId,
        coachClassId: plan.coachClassId,
        trainNameId: plan.trainNameId,
      }));
      toast.current?.show({ severity: "info", summary: "Template loaded", detail: "Adjust and save as a new plan." });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Template load failed", detail: err.message });
    }
  }, []);

  const selectedSeat =
    selected && layout.rows[selected.rowIdx]?.cells[selected.cellIdx]?.kind === "seat"
      ? layout.rows[selected.rowIdx].cells[selected.cellIdx]
      : null;

  // --- grid callbacks ---
  const onSeatClick = (rowIdx, cellIdx) => setSelected({ rowIdx, cellIdx });
  const onCellToggle = (rowIdx, cellIdx) => setLayout((l) => L.toggleCellKind(l, rowIdx, cellIdx));
  const onAddCell = (rowIdx) => setLayout((l) => L.addCell(l, rowIdx, "blank"));
  const onAddRow = (rowIdx, pos) => setLayout((l) => L.addRowAt(l, rowIdx, pos));
  const onDeleteRow = (rowIdx) => {
    setLayout((l) => L.deleteRow(l, rowIdx));
    setSelected(null);
  };
  const onMoveRow = (rowIdx, dir) => setLayout((l) => L.moveRow(l, rowIdx, dir));
  const onMoveDivider = (dir) => setLayout((l) => L.setSplitRow(l, l.direction.splitRow + dir));

  const patchSeat = (patch) =>
    setLayout((l) => L.updateSeat(l, selected.rowIdx, selected.cellIdx, patch));
  const seatToBlank = () => {
    setLayout((l) => L.toggleCellKind(l, selected.rowIdx, selected.cellIdx));
    setSelected(null);
  };
  const removeSelectedCell = () => {
    setLayout((l) => L.removeCell(l, selected.rowIdx, selected.cellIdx));
    setSelected(null);
  };

  const validate = () => {
    if (!meta.trainNameId) return "Select a train name";
    if (!meta.coachTypeId) return "Select a coach type";
    if (!meta.coachClassId) return "Select a coach class";
    if (!meta.coachNo.trim()) return "Enter a coach number";
    return null;
  };

  const persist = async () => {
    const payload = { ...meta, coachNo: meta.coachNo.trim(), layout };
    return isEdit ? updatePlan(planId, payload) : createPlan(payload);
  };

  const save = async (thenSubmit = false) => {
    const err = validate();
    if (err) return toast.current?.show({ severity: "warn", summary: "Missing info", detail: err });
    setSaving(true);
    try {
      const plan = await persist();
      if (thenSubmit) {
        await submitPlan(plan.id);
        toast.current?.show({ severity: "success", summary: "Saved & submitted" });
        router.push("/dashboard/plans");
      } else {
        toast.current?.show({ severity: "success", summary: "Saved as draft" });
        if (!isEdit) router.replace(`/dashboard/plans/${plan.id}/edit`);
      }
    } catch (e) {
      toast.current?.show({ severity: "error", summary: "Save failed", detail: e.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: "center", padding: "3rem" }}><ProgressSpinner /></div>;
  }

  const field = (label, node) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: 180 }}>
      <label style={{ fontSize: "0.8rem", color: "#6b7280", fontWeight: 600 }}>{label}</label>
      {node}
    </div>
  );

  return (
    <div>
      <Toast ref={toast} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
        <h1 className="page-title">{isEdit ? "Edit Seat Plan" : "New Seat Plan"}</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button label="Save draft" icon="pi pi-save" outlined loading={saving} onClick={() => save(false)} />
          <Button label="Save & submit" icon="pi pi-send" loading={saving} onClick={() => save(true)} />
        </div>
      </div>

      {/* Metadata */}
      <div className="card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
          {field("Train name", (
            <Dropdown value={meta.trainNameId} options={refOptions(refs.trainNames)} filter
              onChange={(e) => setMeta((m) => ({ ...m, trainNameId: e.value }))} placeholder="Select train" />
          ))}
          {field("Coach type", (
            <Dropdown value={meta.coachTypeId} options={refOptions(refs.coachTypes)} filter
              onChange={(e) => setMeta((m) => ({ ...m, coachTypeId: e.value }))} placeholder="Select type" />
          ))}
          {field("Coach class", (
            <Dropdown value={meta.coachClassId} options={refOptions(refs.coachClasses)} filter
              onChange={(e) => setMeta((m) => ({ ...m, coachClassId: e.value }))} placeholder="Select class" />
          ))}
          {field("Coach no", (
            <InputText value={meta.coachNo} onChange={(e) => setMeta((m) => ({ ...m, coachNo: e.target.value }))} placeholder="e.g. KHA" />
          ))}
          {field("From station", (
            <InputText value={layout.fromStation} onChange={(e) => setLayout((l) => ({ ...l, fromStation: e.target.value }))} placeholder="From" />
          ))}
          {field("To station", (
            <InputText value={layout.toStation} onChange={(e) => setLayout((l) => ({ ...l, toStation: e.target.value }))} placeholder="To" />
          ))}
          {!isEdit && field("Start from template", (
            <Dropdown value={templateId} options={[{ label: "— None —", value: null }, ...templates.map((t) => ({ label: `${t.trainName?.name || "?"} · ${t.coachNo}`, value: t.id }))]}
              onChange={(e) => applyTemplate(e.value)} placeholder="Optional" />
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="card" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <Button label="Add row" icon="pi pi-plus" size="small" outlined onClick={() => onAddRow(layout.rows.length - 1, "below")} />
        <Button label="Renumber all" icon="pi pi-sort-numeric-down" size="small" outlined onClick={() => setLayout((l) => L.renumberAll(l))} />
        <Button label="Flip direction" icon="pi pi-sync" size="small" outlined onClick={() => setLayout((l) => L.flipDirection(l))} />
        <Button label="Swap stations" icon="pi pi-arrows-v" size="small" outlined onClick={() => setLayout((l) => L.swapStations(l))} />
        <span style={{ fontSize: "0.8rem", color: "#9ca3af", marginLeft: "auto" }}>
          Click a blank (+) to add a seat · click a seat to edit it
        </span>
      </div>

      {/* Grid + seat panel */}
      <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div className="card" style={{ overflowX: "auto" }}>
          <SeatGrid
            layout={layout}
            selected={selected}
            onSeatClick={onSeatClick}
            onCellToggle={onCellToggle}
            onAddCell={onAddCell}
            onAddRow={onAddRow}
            onDeleteRow={onDeleteRow}
            onMoveRow={onMoveRow}
            onMoveDivider={onMoveDivider}
          />
        </div>

        <div className="card" style={{ minWidth: 260, flex: 1 }}>
          <h3 style={{ marginTop: 0 }}>Seat properties</h3>
          {!selectedSeat ? (
            <p style={{ color: "#9ca3af" }}>Select a seat to edit its properties.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {field("Seat number", (
                <InputText value={selectedSeat.number} onChange={(e) => patchSeat({ number: e.target.value })} />
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Checkbox inputId="win" checked={selectedSeat.isWindow} onChange={(e) => patchSeat({ isWindow: e.checked })} />
                <label htmlFor="win">Window seat</label>
              </div>
              {selectedSeat.isWindow && field("Window type", (
                <Dropdown value={selectedSeat.windowType || "full"} options={[{ label: "Full", value: "full" }, { label: "Half", value: "half" }]}
                  onChange={(e) => patchSeat({ windowType: e.value })} />
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Checkbox inputId="charge" checked={selectedSeat.chargingPort} onChange={(e) => patchSeat({ chargingPort: e.checked })} />
                <label htmlFor="charge">Charging port</label>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Checkbox inputId="fan" checked={selectedSeat.fan} onChange={(e) => patchSeat({ fan: e.checked })} />
                <label htmlFor="fan">Fan</label>
              </div>
              {field("Note", (
                <InputTextarea value={selectedSeat.note} rows={2} autoResize onChange={(e) => patchSeat({ note: e.target.value })} />
              ))}
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <Button label="Make blank" icon="pi pi-eraser" size="small" outlined severity="secondary" onClick={seatToBlank} />
                <Button label="Remove cell" icon="pi pi-times" size="small" outlined severity="danger" onClick={removeSelectedCell} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
