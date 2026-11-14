"use client";

import { useMemo, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";
import { SelectButton } from "primereact/selectbutton";
import { Chips } from "primereact/chips";
import { Checkbox } from "primereact/checkbox";
import { createPlan, submitPlan } from "@/lib/plans";
import * as L from "@/lib/layout";

const PATTERNS = [...L.ROW_PATTERNS.map(([l, r]) => ({ label: `${l} + ${r}`, value: `${l}+${r}` })), { label: "Other…", value: "other" }];

/** Rows of a pattern, many at once: added at the end, or instead of every row there is. */
export function RowBuilderDialog({ visible, onHide, onBuild }) {
  const [pattern, setPattern] = useState("2+2");
  const [left, setLeft] = useState(2);
  const [right, setRight] = useState(2);
  const [count, setCount] = useState(10);
  const [replace, setReplace] = useState(false);
  const [l, r] = pattern === "other" ? [left || 0, right || 0] : pattern.split("+").map(Number);
  let error = null;
  try {
    L.patternRow(l, r);
  } catch (e) {
    error = e.message;
  }
  const build = () => {
    onBuild({ count, left: l, right: r, replace });
    onHide();
  };
  return (
    <Dialog header="Add rows" visible={visible} onHide={onHide} style={{ width: "min(30rem, 95vw)" }} className="pe-dialog">
      <div className="pe-dialog__body">
        <div className="pe-field">
          <label>Seats each side of the corridor</label>
          <SelectButton value={pattern} options={PATTERNS} onChange={(e) => e.value && setPattern(e.value)} className="pe-patterns" />
        </div>
        {pattern === "other" && (
          <div className="pe-inline">
            <span className="pe-field">
              <label htmlFor="pe-left">Left</label>
              <InputNumber inputId="pe-left" value={left} onValueChange={(e) => setLeft(e.value ?? 0)} min={0} max={5} showButtons />
            </span>
            <span className="pe-field">
              <label htmlFor="pe-right">Right</label>
              <InputNumber inputId="pe-right" value={right} onValueChange={(e) => setRight(e.value ?? 0)} min={0} max={5} showButtons />
            </span>
          </div>
        )}
        <div className="pe-field">
          <label htmlFor="pe-rows">How many rows</label>
          <InputNumber inputId="pe-rows" value={count} onValueChange={(e) => setCount(e.value ?? 1)} min={1} max={60} showButtons />
        </div>
        <div className="pe-check">
          <Checkbox inputId="pe-replace" checked={replace} onChange={(e) => setReplace(e.checked)} />
          <label htmlFor="pe-replace">Instead of the rows there are now (start over)</label>
        </div>
        <p className={error ? "pe-problem pe-problem--bad" : "pe-muted"}>
          {error || `${count} rows of ${l} + ${r}: ${count * (l + r)} seats, ${replace ? "replacing every row" : "added at the end"}.`}
        </p>
      </div>
      <div className="pe-dialog__foot">
        <Button label="Cancel" text onClick={onHide} />
        <Button label={replace ? "Start over with these" : "Add them"} icon="pi pi-plus" onClick={build} disabled={Boolean(error)} />
      </div>
    </Dialog>
  );
}

const ORDERS = [
  { label: "Left to right", value: "ltr" },
  { label: "Right to left", value: "rtl" },
  { label: "Snake", value: "snake" },
];

/** How the plan numbers its seats by itself: from which number, with what in front, which way. */
export function NumberingDialog({ visible, onHide, layout, onApply }) {
  const current = L.numberingOf(layout);
  const [start, setStart] = useState(current.start);
  const [prefix, setPrefix] = useState(current.prefix);
  const [order, setOrder] = useState(current.order);
  const preview = useMemo(() => {
    const sample = L.setNumbering({ ...layout, rows: layout.rows.slice(0, 2) }, { start, prefix, order });
    return sample.rows.map((row) => row.cells.map((c) => (c.kind === "seat" ? c.number : "·")).join("  "));
  }, [layout, start, prefix, order]);
  return (
    <Dialog
      header="Numbering"
      visible={visible}
      onHide={onHide}
      style={{ width: "min(30rem, 95vw)" }}
      className="pe-dialog"
    >
      <div className="pe-dialog__body">
        <div className="pe-inline">
          <span className="pe-field">
            <label htmlFor="pe-start">Start at</label>
            <InputNumber inputId="pe-start" value={start} onValueChange={(e) => setStart(e.value ?? 1)} min={0} max={9999} useGrouping={false} />
          </span>
          <span className="pe-field">
            <label htmlFor="pe-prefix">In front of each</label>
            <InputText id="pe-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.slice(0, 6))} placeholder="Nothing" />
          </span>
        </div>
        <div className="pe-field">
          <label>Each row</label>
          <SelectButton value={order} options={ORDERS} onChange={(e) => e.value && setOrder(e.value)} />
        </div>
        <div className="pe-preview" aria-label="The first rows, numbered so">
          {preview.map((line, i) => (
            <code key={i}>{line}</code>
          ))}
        </div>
        <p className="pe-muted">
          Numbers typed in by hand keep theirs. A mirrored row still runs the other way. &ldquo;Renumber all&rdquo; clears the typed-in
          ones.
        </p>
      </div>
      <div className="pe-dialog__foot">
        <Button label="Cancel" text onClick={onHide} />
        <Button
          label="Number them so"
          icon="pi pi-sort-numeric-down"
          onClick={() => {
            onApply({ start, prefix, order });
            onHide();
          }}
        />
      </div>
    </Dialog>
  );
}

/**
 * The same layout for more coaches of the train: a plan each, as a draft —
 * and submitted too, if asked. Each saved on its own, so one coach that has
 * a plan already does not stop the rest.
 */
export function CopiesDialog({ visible, onHide, meta, layout, trainName }) {
  const [coaches, setCoaches] = useState([]);
  const [submit, setSubmit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  const save = async () => {
    setBusy(true);
    const done = [];
    for (const coachNo of coaches) {
      try {
        const plan = await createPlan({ ...meta, coachNo, layout });
        let status = "saved as a draft";
        if (submit) {
          const after = await submitPlan(plan.id);
          status = after.status === "approved" ? "saved and approved" : "saved and sent for approval";
        }
        done.push({ coachNo, ok: true, id: plan.id, status });
      } catch (err) {
        done.push({ coachNo, ok: false, status: err.message });
      }
    }
    setResults(done);
    setBusy(false);
  };

  const close = () => {
    setResults(null);
    setCoaches([]);
    onHide();
  };

  return (
    <Dialog header="Save to more coaches" visible={visible} onHide={close} style={{ width: "min(32rem, 95vw)" }} className="pe-dialog">
      <div className="pe-dialog__body">
        <p className="pe-muted">
          A plan of its own for each coach{trainName ? ` of ${trainName}` : ""}, with this layout as it is now. This plan is not changed.
        </p>
        {!meta.trainNameId && (
          <p className="pe-problem pe-problem--warn">No train is chosen yet: the copies will not have one either.</p>
        )}
        <div className="pe-field">
          <label htmlFor="pe-coaches">Coach numbers</label>
          <Chips
            inputId="pe-coaches"
            value={coaches}
            onChange={(e) => setCoaches([...new Set((e.value || []).map((c) => String(c).trim()).filter(Boolean))])}
            separator=","
            placeholder="Type one, then Enter — KA, KHA, GA…"
            disabled={busy || Boolean(results)}
          />
        </div>
        <div className="pe-check">
          <Checkbox inputId="pe-submit-copies" checked={submit} onChange={(e) => setSubmit(e.checked)} disabled={busy || Boolean(results)} />
          <label htmlFor="pe-submit-copies">Submit them too</label>
        </div>
        {results && (
          <ul className="pe-results">
            {results.map((r) => (
              <li key={r.coachNo} className={r.ok ? "is-ok" : "is-bad"}>
                <i className={`pi ${r.ok ? "pi-check" : "pi-times"}`} aria-hidden="true" />
                <strong>{r.coachNo}</strong> — {r.ok ? <a href={`/dashboard/plans/${r.id}`}>{r.status}</a> : r.status}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="pe-dialog__foot">
        {results ? (
          <Button label="Done" onClick={close} />
        ) : (
          <>
            <Button label="Cancel" text onClick={close} />
            <Button
              label={coaches.length ? `Save ${coaches.length} ${coaches.length === 1 ? "copy" : "copies"}` : "Save copies"}
              icon="pi pi-copy"
              onClick={save}
              loading={busy}
              disabled={!coaches.length}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}
