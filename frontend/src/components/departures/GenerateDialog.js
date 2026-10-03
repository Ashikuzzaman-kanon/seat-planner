"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "primereact/dialog";
import { MultiSelect } from "primereact/multiselect";
import { InputNumber } from "primereact/inputnumber";
import { ProgressBar } from "primereact/progressbar";
import { Button } from "primereact/button";
import { Message } from "primereact/message";
import { generateHorizon } from "@/lib/departures";

/** Bytes one sold-able seat takes on one departure, with its indexes — measured. */
const BYTES_PER_SEAT = 210;

/**
 * Generate departures for chosen trains, a chosen number of days ahead.
 *
 * One request per train, one after another: a single request for every train
 * at once runs for minutes on a free-tier database and the proxy in front of
 * the API gives up long before it finishes. Train by train, each request is
 * short, the bar moves, and stopping leaves every finished train finished.
 * Generating is idempotent, so a departure that already exists is counted,
 * not duplicated.
 */
export default function GenerateDialog({ visible, onHide, trains, defaultDays = 5, onDone }) {
  const ready = useMemo(() => trains.filter((t) => t.readyForDepartures), [trains]);
  const [chosen, setChosen] = useState([]);
  const [days, setDays] = useState(defaultDays);
  const [run, setRun] = useState(null);
  const stopRef = useRef(false);

  useEffect(() => {
    if (visible && !run) setDays(defaultDays);
  }, [visible, defaultDays, run]);

  const options = ready.map((t) => ({ label: t.name, value: t.id }));
  const running = run?.state === "running";

  const start = async () => {
    stopRef.current = false;
    const queue = ready.filter((t) => chosen.includes(t.id));
    const totals = { created: 0, existing: 0, seats: 0, done: 0, total: queue.length, notes: [], failed: [] };
    setRun({ state: "running", current: queue[0]?.name, ...totals });

    for (const train of queue) {
      if (stopRef.current) break;
      setRun((r) => ({ ...r, current: train.name }));
      try {
        const { report } = await generateHorizon({ trainId: train.id, days });
        totals.created += report.created;
        totals.existing += report.existing;
        totals.seats += report.seatsCreated;
        for (const summary of report.trains) {
          for (const note of summary.notes) totals.notes.push(`${summary.train}: ${note}`);
        }
      } catch (err) {
        totals.failed.push(`${train.name}: ${err.message}`);
      }
      totals.done += 1;
      setRun({ state: "running", current: train.name, ...totals });
    }

    setRun({ state: stopRef.current ? "stopped" : "done", ...totals });
    onDone?.();
  };

  const close = () => {
    if (running) return;
    setRun(null);
    onHide();
  };

  const pct = run?.total ? Math.round((run.done / run.total) * 100) : 0;

  const footer = (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
      {running ? (
        <Button label="Stop after this train" icon="pi pi-stop" outlined severity="secondary" onClick={() => { stopRef.current = true; }} />
      ) : (
        <>
          <Button label={run ? "Close" : "Cancel"} text onClick={close} />
          {!run && (
            <Button
              label={`Generate for ${chosen.length} train${chosen.length === 1 ? "" : "s"}`}
              icon="pi pi-bolt"
              disabled={!chosen.length || !days}
              onClick={start}
            />
          )}
        </>
      )}
    </div>
  );

  return (
    <Dialog
      header="Generate departures"
      visible={visible}
      onHide={close}
      footer={footer}
      style={{ width: "min(36rem, 96vw)" }}
      closable={!running}
      dismissableMask={!running}
    >
      {!run && (
        <div className="gen-form">
          <p className="gen-hint">
            Departures are built from each train&apos;s coaches and running days. A train shows here once it has both.
            Existing departures are left as they are.
          </p>

          <label className="gen-label" htmlFor="gen-trains">Trains</label>
          <MultiSelect
            inputId="gen-trains"
            value={chosen}
            options={options}
            onChange={(e) => setChosen(e.value)}
            filter
            filterPlaceholder="Type a train name or number"
            placeholder={ready.length ? "Choose trains" : "No train is ready yet"}
            maxSelectedLabels={3}
            selectedItemsLabel="{0} trains chosen"
            display="comma"
            style={{ width: "100%" }}
          />
          <div className="gen-quick">
            <Button label={`All ${ready.length} ready trains`} size="small" text onClick={() => setChosen(ready.map((t) => t.id))} disabled={!ready.length} />
            {chosen.length > 0 && <Button label="Clear" size="small" text severity="secondary" onClick={() => setChosen([])} />}
          </div>

          <label className="gen-label" htmlFor="gen-days">Days ahead, starting today</label>
          <InputNumber inputId="gen-days" value={days} onValueChange={(e) => setDays(e.value)} min={1} max={120} showButtons style={{ width: "10rem" }} />

          {chosen.length > 0 && days > 0 && (
            <Message
              severity="info"
              style={{ width: "100%", marginTop: "1rem", justifyContent: "flex-start" }}
              text={`Up to ${(chosen.length * days).toLocaleString()} departures. At about 600 seats each that is roughly ${Math.ceil(
                (chosen.length * days * 600 * BYTES_PER_SEAT) / 1_000_000
              )} MB of the database.`}
            />
          )}
        </div>
      )}

      {run && (
        <div className="gen-run" aria-live="polite">
          <div className="gen-run__line">
            {running ? <i className="pi pi-spin pi-spinner" /> : <i className={`pi ${run.failed.length ? "pi-exclamation-triangle" : "pi-check-circle"}`} />}
            <strong>
              {running
                ? `Generating ${run.current}…`
                : run.state === "stopped"
                  ? `Stopped after ${run.done} of ${run.total} trains`
                  : `Done — ${run.total} train${run.total === 1 ? "" : "s"}`}
            </strong>
            <span>{run.done} / {run.total}</span>
          </div>
          <ProgressBar value={pct} showValue={false} style={{ height: "0.45rem" }} />
          <div className="gen-run__totals">
            <span><b>{run.created.toLocaleString()}</b> new departures</span>
            <span><b>{run.existing.toLocaleString()}</b> already there</span>
            <span><b>{run.seats.toLocaleString()}</b> seats built</span>
          </div>
          {run.failed.length > 0 && (
            <ul className="gen-run__list gen-run__list--bad">{run.failed.map((f) => <li key={f}>{f}</li>)}</ul>
          )}
          {run.notes.length > 0 && (
            <ul className="gen-run__list">{run.notes.slice(0, 20).map((n) => <li key={n}>{n}</li>)}</ul>
          )}
        </div>
      )}
    </Dialog>
  );
}
