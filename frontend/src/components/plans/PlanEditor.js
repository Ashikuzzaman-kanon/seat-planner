"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Select from "@/components/ui/Select";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import SeatGrid from "./SeatGrid";
import { SeatPanel, BulkPanel, ChecksPanel } from "./EditorPanels";
import { RowBuilderDialog, NumberingDialog, CopiesDialog } from "./EditorDialogs";
import useHistory from "./useHistory";
import { TIP } from "@/components/ui/tip";
import { fetchAllReferences } from "@/lib/reference";
import { listPlans, getPlan, createPlan, updatePlan, submitPlan, deletePlan, revisePlan } from "@/lib/plans";
import * as L from "@/lib/layout";

const refOptions = (items) => items.map((i) => ({ label: i.name, value: i.id }));
const EMPTY = new Set();
const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

/** Keys typed here belong to the field, not the plan. */
const typingIn = (el) =>
  Boolean(el) &&
  (el.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
    Boolean(el.closest?.(".p-dialog, .p-dropdown-panel, .p-multiselect-panel, .p-overlaypanel")));

/**
 * Drawing a seat plan: its details, its rows and seats, saved as a draft or
 * submitted.
 *
 * Seats are chosen by click; Ctrl-click and Shift-click choose several (or
 * "Select several", on a touch screen); a row's number chooses the row. What
 * is chosen can be changed together, numbered, mirrored, swapped with as many
 * others, made blank or removed, and its rows duplicated, repeated, copied
 * and pasted. Rows come many at once from a pattern ("Add rows…"); numbering
 * has a start, a prefix and a direction ("Numbering…"). Every change can be
 * undone (Ctrl+Z) and redone; the keyboard moves between seats. The checks
 * say what saving would refuse before it does, and the page asks before
 * leaving with changes unsaved. "Save to more coaches" makes the same layout
 * a plan for other coaches of the train.
 */
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
  const history = useHistory(L.createEmptyLayout());
  const layout = history.value;
  const setLayout = history.set;
  // Set when this is an editable copy of an approved plan: the plan's id.
  const [revisionOf, setRevisionOf] = useState(null);

  const [sel, setSel] = useState(EMPTY); // the seats chosen, as "row:cell"
  const [cursor, setCursor] = useState(null); // where the keyboard is
  const anchor = useRef(null); // where Shift-click counts from
  const [swapFrom, setSwapFrom] = useState(null); // the first group of a swap
  const [several, setSeveral] = useState(false); // a tap adds to the choice
  const [clipboard, setClipboard] = useState(null); // rows copied
  const [dialog, setDialog] = useState(null); // "rows" | "numbering" | "copies"
  const [saved, setSaved] = useState(null); // the plan as last saved or loaded
  const numberRef = useRef(null);

  const snapshot = (m, l) => JSON.stringify({ m, l });

  // Initial load: references, (edit) plan, (new) template options.
  useEffect(() => {
    (async () => {
      try {
        const [r, tpls] = await Promise.all([fetchAllReferences(), listPlans({ templates: 1 }).catch(() => [])]);
        setRefs(r);
        setTemplates(tpls);
        if (isEdit) {
          let plan = await getPlan(planId);
          // An approved plan is never edited in place: go to its copy.
          if (plan.status === "approved" && !plan.revisionOfId) {
            plan = await revisePlan(plan.id);
            router.replace(`/dashboard/plans/${plan.id}/edit`);
          }
          setRevisionOf(plan.revisionOfId || null);
          const m = {
            coachNo: plan.coachNo || "",
            trainNameId: plan.trainNameId,
            coachTypeId: plan.coachTypeId,
            coachClassId: plan.coachClassId,
          };
          const l = L.recompute(plan.layout);
          setMeta(m);
          history.reset(l);
          setSaved(snapshot(m, l));
        } else {
          setSaved(snapshot(meta, layout));
        }
      } catch (err) {
        toast.current?.show({ severity: "error", summary: "Load failed", detail: err.message });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, planId, router]);

  const dirty = saved !== null && snapshot(meta, layout) !== saved;

  // Leaving with changes unsaved: the browser asks on reload or close, and a
  // link inside the app asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const beforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e) => {
      const a = e.target.closest?.("a[href]");
      if (!a || a.target === "_blank" || e.button !== 0 || e.ctrlKey || e.metaKey) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm("Leave this plan without saving your changes?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const applyTemplate = useCallback(
    async (id) => {
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
    },
    [setLayout]
  );

  /* ---------------- choosing seats ---------------- */

  const seatAt = (key) => {
    const [r, c] = L.placeOf(key);
    const cell = layout.rows[r]?.cells[c];
    return cell?.kind === "seat" ? cell : null;
  };
  const chosen = useMemo(() => [...sel].filter((k) => seatAt(k)), [sel, layout]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosenSeats = chosen.map(seatAt);
  const chosenRows = L.rowsOf(chosen);

  const clearChoice = () => {
    setSel(EMPTY);
    setCursor(null);
    setSwapFrom(null);
  };
  const choose = (keys, at = keys[0] ?? null) => {
    setSel(new Set(keys));
    setCursor(at);
    if (at) anchor.current = at;
  };

  const onSeatClick = (rowIdx, cellIdx, e) => {
    const key = L.keyOf(rowIdx, cellIdx);
    setCursor(key);
    if (e?.shiftKey && anchor.current) {
      const range = L.seatKeysBetween(layout, anchor.current, key);
      setSel((s) => new Set([...(e.ctrlKey || e.metaKey ? s : []), ...range]));
      return;
    }
    anchor.current = key;
    if (e?.ctrlKey || e?.metaKey || several) {
      setSel((s) => {
        const next = new Set(s);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    } else setSel(new Set([key]));
  };
  const onRowSelect = (rowIdx) => choose(L.allSeatKeys(layout).filter((k) => L.placeOf(k)[0] === rowIdx));
  const selectAll = () => choose(L.allSeatKeys(layout));

  /* ---------------- changing the plan ---------------- */

  /** A change that moves rows or cells about: what was chosen no longer points at the same seats. */
  const restructure = (fn) => {
    setLayout(fn);
    clearChoice();
  };

  const onCellToggle = (rowIdx, cellIdx) => setLayout((l) => L.toggleCellKind(l, rowIdx, cellIdx));
  const onAddCell = (rowIdx) => setLayout((l) => L.addCell(l, rowIdx, "blank"));
  const onAddRow = (rowIdx, pos) => restructure((l) => L.addRowAt(l, rowIdx, pos));
  const onDeleteRow = (rowIdx) => restructure((l) => L.deleteRow(l, rowIdx));
  const onMoveRow = (rowIdx, dir) => restructure((l) => L.moveRow(l, rowIdx, dir));
  const onDuplicateRow = (rowIdx) => restructure((l) => L.duplicateRow(l, rowIdx));
  const onMoveDivider = (dir) => setLayout((l) => L.setSplitRow(l, l.direction.splitRow + dir));

  /** One seat: as before, typed numbers and notes merged into one step each. Several: the same change to all. */
  const patchChosen = (patch, tag = null) => {
    if (chosen.length === 1) {
      const [r, c] = L.placeOf(chosen[0]);
      setLayout((l) => L.updateSeat(l, r, c, patch), tag && `${tag}:${chosen[0]}`);
    } else setLayout((l) => L.patchSeats(l, chosen, patch));
  };
  const numberChosen = (start, prefix) => setLayout((l) => L.renumberSeats(l, chosen, start, prefix));
  // The places stay: the keyboard stays where it was, on what is now a blank.
  const blankChosen = () => {
    setLayout((l) => L.seatsToBlanks(l, chosen));
    setSel(EMPTY);
    setSwapFrom(null);
  };
  const removeChosen = () => restructure((l) => L.removeCells(l, chosen));
  const mirrorChosen = () => restructure((l) => L.mirrorRows(l, chosenRows));
  const duplicateChosen = () => restructure((l) => L.insertRows(l, Math.max(...chosenRows), chosenRows.map((i) => l.rows[i])));
  const repeatChosen = (times) => restructure((l) => L.repeatRows(l, chosenRows, times));
  const mirrorAll = () => restructure((l) => L.mirrorRows(l));

  const copyRows = () => {
    if (!chosenRows.length) return;
    setClipboard(chosenRows.map((i) => layout.rows[i]));
    toast.current?.show({ severity: "info", summary: `${chosenRows.length} row${chosenRows.length === 1 ? "" : "s"} copied`, life: 2000 });
  };
  const pasteRows = () => {
    if (!clipboard) return;
    const after = chosenRows.length ? Math.max(...chosenRows) : layout.rows.length - 1;
    restructure((l) => L.insertRows(l, after, clipboard));
  };

  const startSwap = () => {
    setSwapFrom(chosen);
    setSel(EMPTY);
  };
  const overlap = swapFrom ? chosen.some((k) => swapFrom.includes(k)) : false;
  const doSwap = () => {
    try {
      setLayout(L.swapSeats(layout, swapFrom, chosen));
      toast.current?.show({ severity: "success", summary: `${chosen.length} seat${chosen.length === 1 ? "" : "s"} swapped`, life: 2000 });
      clearChoice();
    } catch (err) {
      toast.current?.show({ severity: "warn", summary: "Cannot swap them", detail: err.message });
    }
  };

  const showSeats = (keys) => {
    choose(keys);
    setTimeout(() => document.querySelector(".seat.selected")?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }), 50);
  };

  /* ---------------- the keyboard ---------------- */

  useEffect(() => {
    if (loading) return undefined;
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (typingIn(e.target)) return;
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        history.redo();
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        selectAll();
        return;
      }
      if (mod && key === "c" && chosen.length) {
        e.preventDefault();
        copyRows();
        return;
      }
      if (mod && key === "v" && clipboard) {
        e.preventDefault();
        pasteRows();
        return;
      }
      if (mod || e.altKey) return;
      if (key === "Escape") {
        clearChoice();
        return;
      }
      if (ARROWS[key]) {
        e.preventDefault();
        const from = cursor || chosen[0] || "0:0";
        const [r, c] = L.placeOf(from);
        const [dr, dc] = ARROWS[key];
        const row = Math.min(Math.max(r + dr, 0), layout.rows.length - 1);
        const cell = Math.min(Math.max(c + dc, 0), Math.max(layout.rows[row]?.cells.length - 1, 0));
        const next = L.keyOf(row, cell);
        setCursor(next);
        if (seatAt(next)) {
          if (e.shiftKey) setSel((s) => new Set([...s, next]));
          else {
            setSel(new Set([next]));
            anchor.current = next;
          }
        } else if (!e.shiftKey) setSel(EMPTY);
        return;
      }
      if (key === " " && cursor) {
        e.preventDefault();
        const [r, c] = L.placeOf(cursor);
        setLayout((l) => L.toggleCellKind(l, r, c));
        setSel(seatAt(cursor) ? EMPTY : new Set([cursor]));
        return;
      }
      if ((key === "Delete" || key === "Backspace") && chosen.length) {
        e.preventDefault();
        blankChosen();
        return;
      }
      // A number typed with one seat chosen becomes its number.
      if (chosen.length === 1 && /^[0-9a-z-]$/i.test(e.key)) {
        e.preventDefault();
        patchChosen({ number: e.key }, "number");
        setTimeout(() => {
          const input = numberRef.current;
          if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
          }
        }, 0);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  /* ---------------- saving ---------------- */

  /**
   * What submitting needs. A draft saves with any of it missing — a layout can
   * be kept before anyone knows its train — so this is only checked on submit.
   */
  const missingForSubmit = () => {
    const missing = [];
    if (!meta.trainNameId) missing.push("a train");
    if (!meta.coachTypeId) missing.push("a coach type");
    if (!meta.coachClassId) missing.push("a coach class");
    if (!meta.coachNo.trim()) missing.push("a coach number");
    return missing;
  };

  const checks = useMemo(() => L.checkLayout(layout), [layout]);
  const problemKeys = useMemo(
    () => new Set([...checks.duplicates.flatMap((d) => d.keys), ...checks.unnumbered]),
    [checks]
  );

  const persist = async () => {
    const payload = {
      coachNo: meta.coachNo.trim() || null,
      trainNameId: meta.trainNameId ?? null,
      coachTypeId: meta.coachTypeId ?? null,
      coachClassId: meta.coachClassId ?? null,
      layout,
    };
    return isEdit ? updatePlan(planId, payload) : createPlan(payload);
  };

  const save = async (thenSubmit = false) => {
    const missing = thenSubmit ? missingForSubmit() : [];
    if (missing.length) {
      return toast.current?.show({
        severity: "warn",
        summary: "Not ready to submit",
        detail: `Add ${missing.join(", ")} first — or save it as a draft for now.`,
      });
    }
    setSaving(true);
    try {
      const plan = await persist();
      setSaved(snapshot(meta, layout));
      if (thenSubmit) {
        const after = await submitPlan(plan.id);
        // An approver's changes go straight into the plan.
        const applied = revisionOf && after.id === revisionOf;
        toast.current?.show({
          severity: "success",
          summary: applied ? "Approved — the plan now has your changes" : "Saved & submitted",
        });
        router.push(applied ? `/dashboard/plans/${after.id}` : "/dashboard/plans");
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

  const discard = async () => {
    setSaving(true);
    try {
      await deletePlan(planId);
      setSaved(snapshot(meta, layout));
      toast.current?.show({ severity: "info", summary: "Changes thrown away" });
      router.push(`/dashboard/plans/${revisionOf}`);
    } catch (e) {
      toast.current?.show({ severity: "error", summary: "Could not throw them away", detail: e.message });
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
  const selectionActions = {
    onSwapWith: startSwap,
    onMirrorRows: mirrorChosen,
    onDuplicateRows: duplicateChosen,
    onBlank: blankChosen,
    onRemove: removeChosen,
  };
  const trainName = refs.trainNames.find((t) => t.id === meta.trainNameId)?.name;

  return (
    <div className="plan-page">
      <Toast ref={toast} />

      <div className="page-head">
        <div>
          <h1 className="page-title">{revisionOf ? "Change Seat Plan" : isEdit ? "Edit Seat Plan" : "New Seat Plan"}</h1>
          <p className="page-subtitle">
            {revisionOf
              ? "These are changes to an approved plan. It keeps being used as it is until they are approved."
              : "A draft saves with anything still unknown. Submitting needs a train, coach type, class and coach number."}
          </p>
        </div>
        {/* Four of them: they may wrap, on a phone, rather than run off the edge. */}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", flexShrink: 1, maxWidth: "100%" }}>
          {dirty && <span className="pe-unsaved">Unsaved changes</span>}
          {revisionOf && (
            <Button label="Throw changes away" icon="pi pi-trash" severity="danger" text disabled={saving} onClick={discard} />
          )}
          <Button label="Save to more coaches…" icon="pi pi-copy" text disabled={saving} onClick={() => setDialog("copies")} />
          <Button label="Save draft" icon="pi pi-save" outlined loading={saving} onClick={() => save(false)} />
          <Button label="Save & submit" icon="pi pi-send" loading={saving} onClick={() => save(true)} />
        </div>
      </div>

      {/* Metadata */}
      <div className="card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
          {field("Train name", (
            <Select value={meta.trainNameId} options={refOptions(refs.trainNames)} filter showClear
              onChange={(e) => setMeta((m) => ({ ...m, trainNameId: e.value ?? null }))} placeholder="Not decided yet" />
          ))}
          {field("Coach type", (
            <Select value={meta.coachTypeId} options={refOptions(refs.coachTypes)} filter showClear
              onChange={(e) => setMeta((m) => ({ ...m, coachTypeId: e.value ?? null }))} placeholder="Not decided yet" />
          ))}
          {field("Coach class", (
            <Select value={meta.coachClassId} options={refOptions(refs.coachClasses)} filter showClear
              onChange={(e) => setMeta((m) => ({ ...m, coachClassId: e.value ?? null }))} placeholder="Not decided yet" />
          ))}
          {field("Coach no", (
            <InputText value={meta.coachNo} onChange={(e) => setMeta((m) => ({ ...m, coachNo: e.target.value }))} placeholder="e.g. KHA" />
          ))}
          {field("From station", (
            <InputText value={layout.fromStation} onChange={(e) => setLayout((l) => ({ ...l, fromStation: e.target.value }), "from")} placeholder="From" />
          ))}
          {field("To station", (
            <InputText value={layout.toStation} onChange={(e) => setLayout((l) => ({ ...l, toStation: e.target.value }), "to")} placeholder="To" />
          ))}
          {!isEdit && field("Start from template", (
            <Select value={templateId} options={[{ label: "— None —", value: null }, ...templates.map((t) => ({ label: `${t.trainName?.name || "No train"} · ${t.coachNo || "untitled draft"}`, value: t.id }))]}
              onChange={(e) => applyTemplate(e.value)} placeholder="Optional" />
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="card pe-toolbar">
        <span className="pe-group">
          <Button label="Undo" icon="pi pi-undo" size="small" text disabled={!history.canUndo} onClick={history.undo}
            tooltip="Ctrl+Z" tooltipOptions={TIP} />
          <Button label="Redo" icon="pi pi-replay" size="small" text disabled={!history.canRedo} onClick={history.redo}
            tooltip="Ctrl+Y" tooltipOptions={TIP} />
        </span>
        <span className="pe-group">
          <Button label="Add rows…" icon="pi pi-th-large" size="small" outlined onClick={() => setDialog("rows")} />
          <Button label="Add row" icon="pi pi-plus" size="small" outlined onClick={() => onAddRow(layout.rows.length - 1, "below")} />
          <Button label="Numbering…" icon="pi pi-sort-numeric-down" size="small" outlined onClick={() => setDialog("numbering")} />
          <Button label="Renumber all" icon="pi pi-sort-numeric-down" size="small" outlined onClick={() => setLayout((l) => L.renumberAll(l))} />
          <Button label="Mirror left ↔ right" icon="pi pi-arrows-h" size="small" outlined onClick={mirrorAll} />
          <Button label="Flip direction" icon="pi pi-sync" size="small" outlined onClick={() => setLayout((l) => L.flipDirection(l))} />
          <Button label="Swap stations" icon="pi pi-arrows-v" size="small" outlined onClick={() => setLayout((l) => L.swapStations(l))} />
        </span>
        <span className="pe-group">
          <Button label="Select all" icon="pi pi-check-square" size="small" text onClick={selectAll} />
          <Button
            label="Select several"
            icon={several ? "pi pi-check" : "pi pi-clone"}
            size="small"
            text={!several}
            outlined={several}
            onClick={() => setSeveral((s) => !s)}
            aria-pressed={several}
          />
          {clipboard && (
            <Button label={`Paste ${clipboard.length} row${clipboard.length === 1 ? "" : "s"}`} icon="pi pi-clipboard" size="small" text onClick={pasteRows} />
          )}
        </span>
        <span className="pe-hint">
          Click a seat to edit it · Ctrl- or Shift-click for several · a row&apos;s number selects the row · arrows move · Ctrl+Z undoes
        </span>
      </div>

      {swapFrom && (
        <div className="pe-swapbar" role="status">
          <span>
            <i className="pi pi-arrow-right-arrow-left" aria-hidden="true" /> Swapping <strong>{swapFrom.length}</strong> seat
            {swapFrom.length === 1 ? "" : "s"} (in purple): now choose <strong>{swapFrom.length}</strong> to swap {swapFrom.length === 1 ? "it" : "them"} with —{" "}
            {chosen.length} chosen.
            {overlap && " A seat cannot be on both sides."}
          </span>
          <span className="pe-swapbar__buttons">
            <Button label={`Swap ${swapFrom.length} ↔ ${chosen.length}`} size="small" onClick={doSwap} disabled={chosen.length !== swapFrom.length || overlap} />
            <Button label="Cancel" size="small" text onClick={() => setSwapFrom(null)} />
          </span>
        </div>
      )}

      {/* Grid + side panels */}
      <div className="pe-body">
        <div className="card pe-grid">
          <SeatGrid
            layout={layout}
            selectedKeys={sel}
            cursor={cursor}
            swapKeys={swapFrom ? new Set(swapFrom) : EMPTY}
            problemKeys={problemKeys}
            onSeatClick={onSeatClick}
            onCellToggle={onCellToggle}
            onAddCell={onAddCell}
            onAddRow={onAddRow}
            onDeleteRow={onDeleteRow}
            onMoveRow={onMoveRow}
            onMoveDivider={onMoveDivider}
            onRowSelect={onRowSelect}
            onDuplicateRow={onDuplicateRow}
          />
        </div>

        <div className="pe-side">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>{chosen.length > 1 ? "Selected seats" : "Seat properties"}</h3>
            {chosen.length === 0 ? (
              <p style={{ color: "#9ca3af" }}>Select a seat to edit its properties — or several, to change them together.</p>
            ) : chosen.length === 1 ? (
              <SeatPanel seat={chosenSeats[0]} numberRef={numberRef} onPatch={patchChosen} {...selectionActions} />
            ) : (
              <BulkPanel
                seats={chosenSeats}
                onPatch={patchChosen}
                onNumber={numberChosen}
                onRepeat={repeatChosen}
                onClear={clearChoice}
                {...selectionActions}
              />
            )}
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Checks</h3>
            <ChecksPanel checks={checks} missing={missingForSubmit()} onShow={showSeats} />
          </div>
        </div>
      </div>

      {/* Each built afresh when opened, from the plan as it is then. */}
      {dialog === "rows" && (
        <RowBuilderDialog visible onHide={() => setDialog(null)} onBuild={(opts) => restructure((l) => L.buildRows(l, opts))} />
      )}
      {dialog === "numbering" && (
        <NumberingDialog
          visible
          onHide={() => setDialog(null)}
          layout={layout}
          onApply={(patch) => setLayout((l) => L.setNumbering(l, patch))}
        />
      )}
      {dialog === "copies" && (
        <CopiesDialog visible onHide={() => setDialog(null)} meta={{ ...meta, coachNo: undefined }} layout={layout} trainName={trainName} />
      )}
    </div>
  );
}
