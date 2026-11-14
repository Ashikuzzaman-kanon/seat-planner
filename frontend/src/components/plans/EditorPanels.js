"use client";

import { useState } from "react";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { InputNumber } from "primereact/inputnumber";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import Select from "@/components/ui/Select";

const field = (label, node, htmlFor) => (
  <div className="pe-field">
    <label htmlFor={htmlFor}>{label}</label>
    {node}
  </div>
);

/** The things to do with what is selected, the same on one seat or several. */
function SelectionActions({ count, onSwapWith, onMirrorRows, onDuplicateRows, onBlank, onRemove }) {
  const several = count > 1;
  return (
    <div className="pe-actions">
      <Button label="Swap with…" icon="pi pi-arrow-right-arrow-left" size="small" outlined onClick={onSwapWith} />
      <Button label={several ? "Mirror their rows" : "Mirror this row"} icon="pi pi-arrows-h" size="small" outlined onClick={onMirrorRows} />
      <Button label={several ? "Duplicate their rows" : "Duplicate this row"} icon="pi pi-clone" size="small" outlined onClick={onDuplicateRows} />
      <Button label="Make blank" icon="pi pi-eraser" size="small" outlined severity="secondary" onClick={onBlank} />
      <Button label={several ? "Remove cells" : "Remove cell"} icon="pi pi-times" size="small" outlined severity="danger" onClick={onRemove} />
    </div>
  );
}

/** One seat: its number and details, as before, and what can be done with it. */
export function SeatPanel({ seat, numberRef, onPatch, ...actions }) {
  return (
    <div className="pe-panel">
      {field("Seat number", (
        <InputText id="pe-number" ref={numberRef} value={seat.number} onChange={(e) => onPatch({ number: e.target.value }, "number")} />
      ), "pe-number")}
      <div className="pe-check">
        <Checkbox inputId="win" checked={seat.isWindow} onChange={(e) => onPatch({ isWindow: e.checked })} />
        <label htmlFor="win">Window seat</label>
      </div>
      {seat.isWindow && field("Window type", (
        <Select value={seat.windowType || "full"} options={[{ label: "Full", value: "full" }, { label: "Half", value: "half" }]}
          onChange={(e) => onPatch({ windowType: e.value })} />
      ))}
      <div className="pe-check">
        <Checkbox inputId="charge" checked={seat.chargingPort} onChange={(e) => onPatch({ chargingPort: e.checked })} />
        <label htmlFor="charge">Charging port</label>
      </div>
      <div className="pe-check">
        <Checkbox inputId="fan" checked={seat.fan} onChange={(e) => onPatch({ fan: e.checked })} />
        <label htmlFor="fan">Fan</label>
      </div>
      {field("Note", (
        <InputTextarea id="pe-note" value={seat.note} rows={2} autoResize onChange={(e) => onPatch({ note: e.target.value }, "note")} />
      ), "pe-note")}
      <SelectionActions count={1} {...actions} />
    </div>
  );
}

/** "3 of 8": how many of the selected seats have a thing. */
const ofThem = (seats, test) => `${seats.filter(test).length} of ${seats.length}`;

/**
 * Several seats: the same change to all of them — window, charging port, fan,
 * a note, numbers from a start — and the rows they are in mirrored,
 * duplicated or repeated.
 */
export function BulkPanel({ seats, onPatch, onNumber, onRepeat, onClear, ...actions }) {
  const [note, setNote] = useState("");
  const [start, setStart] = useState(1);
  const [prefix, setPrefix] = useState("");
  const [times, setTimes] = useState(1);
  const toggle = (label, key, test) => (
    <div className="pe-toggle">
      <span>
        {label} <small>{ofThem(seats, test)}</small>
      </span>
      <span>
        <Button label="All" size="small" text onClick={() => onPatch({ [key]: true })} aria-label={`${label}: all`} />
        <Button label="None" size="small" text onClick={() => onPatch({ [key]: false })} aria-label={`${label}: none`} />
      </span>
    </div>
  );
  return (
    <div className="pe-panel">
      <p className="pe-count">
        <strong>{seats.length} seats selected</strong>
        <Button label="Clear" size="small" text onClick={onClear} />
      </p>
      {toggle("Window", "isWindow", (s) => s.isWindow)}
      {toggle("Charging port", "chargingPort", (s) => s.chargingPort)}
      {toggle("Fan", "fan", (s) => s.fan)}
      {field("Note for all of them", (
        <span className="pe-inline">
          <InputText id="pe-bulk-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Leave empty to clear" />
          <Button label="Set" size="small" outlined onClick={() => onPatch({ note })} />
        </span>
      ), "pe-bulk-note")}
      {field("Number them, in order, from", (
        <span className="pe-inline">
          <InputText value={prefix} onChange={(e) => setPrefix(e.target.value.slice(0, 6))} placeholder="Prefix" className="pe-prefix" aria-label="Prefix" />
          <InputNumber inputId="pe-bulk-start" value={start} onValueChange={(e) => setStart(e.value ?? 1)} min={0} max={9999} useGrouping={false} />
          <Button label="Number" size="small" outlined onClick={() => onNumber(start, prefix)} />
        </span>
      ), "pe-bulk-start")}
      {field("Repeat their rows below them", (
        <span className="pe-inline">
          <InputNumber inputId="pe-repeat" value={times} onValueChange={(e) => setTimes(e.value ?? 1)} min={1} max={50} useGrouping={false} suffix=" ×" />
          <Button label="Repeat" size="small" outlined onClick={() => onRepeat(times)} />
        </span>
      ), "pe-repeat")}
      <SelectionActions count={seats.length} {...actions} />
    </div>
  );
}

/**
 * What saving would refuse, and what is worth a look — with a way to the
 * seats concerned — and the plan summed up.
 */
export function ChecksPanel({ checks, missing, onShow }) {
  const rowsText = Object.entries(checks.byRow)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([seats, rows]) => `${rows} × ${seats} seat${seats === "1" ? "" : "s"}`)
    .join(" · ");
  const fine = !checks.duplicates.length && !checks.unnumbered.length;
  return (
    <div className="pe-checks" aria-label="Checks">
      <p className="pe-sum">
        <strong>{checks.seats}</strong> seats · <strong>{checks.windows}</strong> windows · <strong>{checks.rows}</strong> rows
        {rowsText && <span className="pe-muted"> ({rowsText})</span>}
      </p>
      {checks.duplicates.map((d) => (
        <p key={d.number} className="pe-problem pe-problem--bad">
          <i className="pi pi-times-circle" aria-hidden="true" /> Seat <strong>{d.number}</strong> is on {d.keys.length} seats — it cannot be
          submitted so.
          <Button label="Show" size="small" text onClick={() => onShow(d.keys)} />
        </p>
      ))}
      {checks.unnumbered.length > 0 && (
        <p className="pe-problem pe-problem--warn">
          <i className="pi pi-exclamation-triangle" aria-hidden="true" /> {checks.unnumbered.length} seat
          {checks.unnumbered.length === 1 ? " has" : "s have"} no number — nobody can book {checks.unnumbered.length === 1 ? "it" : "them"}.
          <Button label="Show" size="small" text onClick={() => onShow(checks.unnumbered)} />
        </p>
      )}
      {checks.gaps.length > 0 && (
        <p className="pe-problem">
          <i className="pi pi-info-circle" aria-hidden="true" /> Numbers skipped: {checks.gaps.slice(0, 12).join(", ")}
          {checks.gaps.length > 12 ? ` and ${checks.gaps.length - 12} more` : ""}.
        </p>
      )}
      {missing.length > 0 && (
        <p className="pe-problem">
          <i className="pi pi-info-circle" aria-hidden="true" /> To submit, it still needs {missing.join(", ")}.
        </p>
      )}
      {fine && !missing.length && (
        <p className="pe-problem pe-problem--ok">
          <i className="pi pi-check-circle" aria-hidden="true" /> Ready to submit.
        </p>
      )}
    </div>
  );
}
