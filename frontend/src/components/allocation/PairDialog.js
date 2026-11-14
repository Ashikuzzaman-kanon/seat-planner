"use client";

import { useEffect, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { RadioButton } from "primereact/radiobutton";
import { Dropdown } from "primereact/dropdown";
import { InputNumber } from "primereact/inputnumber";
import { saveAllocationPair, clearAllocationPair, stationLabel } from "@/lib/allocation";

/** The railway's class codes, offered first; any other code can be typed. */
const RAILWAY_CLASSES = ["AC_B", "AC_S", "AC_CHAIR", "F_BERTH", "F_CHAIR", "F_SEAT", "S_CHAIR", "SHOVAN", "SHULOV", "SNIGDHA"];

/**
 * One train and one pair, set by hand: allocated with its classes and their
 * seat counts, or not allocated — or forgotten, back to not checked. A count
 * left empty is "not available", never 0.
 */
export default function PairDialog({ pair, knownClasses = [], onHide, onSaved, toast }) {
  const [status, setStatus] = useState("allocated");
  const [classes, setClasses] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pair) return;
    setStatus(pair.status === "not_allocated" ? "not_allocated" : "allocated");
    setClasses(pair.classes.length ? pair.classes.map((c) => ({ ...c })) : [{ code: "", seats: null }]);
    setBusy(false);
  }, [pair]);

  const options = [...new Set([...RAILWAY_CLASSES, ...knownClasses])]
    .sort((a, b) => a.localeCompare(b))
    .map((c) => ({ label: c, value: c }));
  const set = (i, patch) => setClasses((prev) => prev.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const filled = classes.filter((c) => c.code);
  const codes = filled.map((c) => c.code.toUpperCase());
  const twice = codes.find((c, i) => codes.indexOf(c) !== i);

  const save = async () => {
    setBusy(true);
    try {
      await saveAllocationPair({
        train: pair.train.number,
        from: pair.from,
        to: pair.to,
        status,
        classes: status === "allocated" ? filled.map((c) => ({ code: c.code.toUpperCase(), seats: c.seats ?? null })) : [],
      });
      await onSaved("Saved");
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Not saved", detail: err.message });
      setBusy(false);
    }
  };

  const forget = async () => {
    setBusy(true);
    try {
      await clearAllocationPair({ train: pair.train.number, from: pair.from, to: pair.to });
      await onSaved("Back to not checked");
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Not changed", detail: err.message });
      setBusy(false);
    }
  };

  return (
    <Dialog
      header={pair ? `${pair.train.name} (${pair.train.number})` : ""}
      visible={Boolean(pair)}
      onHide={busy ? () => {} : onHide}
      style={{ width: "34rem", maxWidth: "94vw" }}
      draggable={false}
      footer={
        <div className="al-dialog__actions">
          {pair && pair.status !== "not_checked" && (
            <Button label="Back to not checked" severity="danger" text onClick={forget} disabled={busy} className="al-dialog__forget" />
          )}
          <Button label="Cancel" text onClick={onHide} disabled={busy} />
          <Button label="Save" icon="pi pi-check" onClick={save} loading={busy} disabled={Boolean(twice)} />
        </div>
      }
    >
      {pair && (
        <div className="al-edit">
          <p className="al-edit__pair">
            {stationLabel(pair.from)} <i className="pi pi-arrow-right" aria-hidden="true" /> {stationLabel(pair.to)}
          </p>

          <div className="al-edit__status" role="radiogroup" aria-label="Allocation">
            {[
              ["allocated", "Allocated"],
              ["not_allocated", "Not allocated"],
            ].map(([value, label]) => (
              <label key={value} htmlFor={`al-${value}`} className={status === value ? "is-on" : ""}>
                <RadioButton inputId={`al-${value}`} value={value} checked={status === value} onChange={(e) => setStatus(e.value)} />
                {label}
              </label>
            ))}
          </div>

          {status === "allocated" && (
            <div className="al-edit__classes">
              <div className="al-edit__head">
                <span>Class</span>
                <span>Seats</span>
              </div>
              {classes.map((c, i) => (
                <div key={i} className="al-edit__row">
                  <Dropdown
                    value={c.code}
                    options={options}
                    editable
                    placeholder="Class"
                    onChange={(e) => set(i, { code: String(e.value || "").toUpperCase() })}
                    aria-label="Class"
                  />
                  <InputNumber
                    value={c.seats}
                    onValueChange={(e) => set(i, { seats: e.value ?? null })}
                    min={0}
                    max={10000}
                    useGrouping={false}
                    placeholder="not available"
                    aria-label="Seats"
                    inputStyle={{ width: "100%", minWidth: 0 }}
                  />
                  <Button
                    icon="pi pi-times"
                    text
                    severity="secondary"
                    aria-label="Remove this class"
                    onClick={() => setClasses((prev) => prev.filter((_, k) => k !== i))}
                  />
                </div>
              ))}
              <Button
                label="Add class"
                icon="pi pi-plus"
                text
                size="small"
                onClick={() => setClasses((prev) => [...prev, { code: "", seats: null }])}
              />
              <small className="al-muted">
                Leave seats empty while the count is not known — it shows as &ldquo;count not available&rdquo;, never
                as 0.
              </small>
              {twice && <small className="al-warn">{twice} is listed twice.</small>}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
