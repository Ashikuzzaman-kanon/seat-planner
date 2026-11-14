"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Message } from "primereact/message";
import {
  uploadAllocation,
  downloadCountsSheet,
  fetchAllocationUploads,
  stationLabel,
  when,
  span,
} from "@/lib/allocation";

const n = (x) => Number(x || 0).toLocaleString("en-GB");
/** "1 line", "2 lines". */
const count = (x, one, many = `${one}s`) => `${n(x)} ${Number(x) === 1 ? one : many}`;
const byWhom = (x) => (x?.by?.fullName ? ` by ${x.by.fullName}` : "");

const UPLOADS = {
  stops: { label: "Upload routes", icon: "pi pi-directions", accept: ".json,application/json", title: "Train routes" },
  census: { label: "Upload census", icon: "pi pi-upload", accept: ".csv,text/csv", title: "Census" },
  counts: { label: "Upload counts", icon: "pi pi-hashtag", accept: ".csv,text/csv", title: "Seat counts" },
};

/**
 * How much allocation data there is and how current it is — the railway can
 * change its allocation at any time — and, for whoever manages it, the files
 * that fill it: the train routes, the census, and the seat counts. Each file
 * is read and shown first; nothing changes until Apply. Every file applied is
 * in the upload history.
 */
export default function DataPanel({ meta, canManage, filters, onChanged, toast }) {
  const inputs = { stops: useRef(null), census: useRef(null), counts: useRef(null) };
  const [reading, setReading] = useState(null);
  const [pending, setPending] = useState(null);
  const [applying, setApplying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const t = meta?.totals;
  const latest = meta?.latest || {};

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await fetchAllocationUploads(20));
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Upload history", detail: err.message });
    }
  }, [toast]);

  const pick = async (kind, e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setReading(kind);
    try {
      const text = await file.text();
      const { preview } = await uploadAllocation(kind, text, false, file.name);
      setPending({ kind, text, preview, fileName: file.name });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: UPLOADS[kind].title, detail: err.message, life: 8000 });
    } finally {
      setReading(null);
    }
  };

  const apply = async () => {
    setApplying(true);
    try {
      await uploadAllocation(pending.kind, pending.text, true, pending.fileName);
      toast.current?.show({ severity: "success", summary: UPLOADS[pending.kind].title, detail: "Applied" });
      setPending(null);
      await onChanged();
      if (historyOpen) await loadHistory();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Not applied", detail: err.message, life: 8000 });
    } finally {
      setApplying(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      await downloadCountsSheet(filters);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Counts sheet", detail: err.message });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="card al-data">
      <dl className="al-latest">
        <div>
          <dt>Routes</dt>
          <dd>
            {latest.stops ? (
              <>
                <strong>{count(t.trainsWithStops, "train")}</strong>
                <span className="al-muted">
                  {" "}
                  · uploaded {when(latest.stops.at)}
                  {byWhom(latest.stops)}
                </span>
              </>
            ) : (
              <span className="al-muted">Not uploaded yet</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Census</dt>
          <dd>
            {latest.census ? (
              <>
                <strong>{count(t.pairs, "pair")}</strong> checked, {n(t.allocated)} allocated
                {latest.census.scannedFrom && (
                  <>
                    {" "}
                    · railway checked <strong>{span(latest.census.scannedFrom, latest.census.scannedTo)}</strong>
                  </>
                )}
                <span className="al-muted">
                  {" "}
                  · uploaded {when(latest.census.at)}
                  {byWhom(latest.census)}
                </span>
              </>
            ) : (
              <span className="al-muted">Not uploaded yet</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Counts</dt>
          <dd>
            {latest.counts ? (
              <>
                Known for <strong>{n(t.counted)}</strong> of {count(t.classes, "class", "classes")}
                <span className="al-muted">
                  {" "}
                  · last changed {when(latest.counts.at)}
                  {byWhom(latest.counts)}
                </span>
              </>
            ) : (
              <span className="al-muted">None yet</span>
            )}
          </dd>
        </div>
      </dl>

      {canManage && (
        <div className="al-data__actions">
          {Object.entries(UPLOADS).map(([kind, u]) => (
            <span key={kind}>
              <input
                ref={inputs[kind]}
                type="file"
                accept={u.accept}
                hidden
                onChange={(e) => pick(kind, e)}
                data-upload={kind}
              />
              <Button
                label={u.label}
                icon={u.icon}
                size="small"
                outlined={kind !== "census"}
                loading={reading === kind}
                disabled={Boolean(reading)}
                onClick={() => inputs[kind].current?.click()}
              />
            </span>
          ))}
          <Button
            label="Download counts sheet"
            icon="pi pi-download"
            size="small"
            text
            loading={downloading}
            disabled={!t?.allocated}
            onClick={download}
          />
        </div>
      )}

      <details
        className="al-history"
        onToggle={(e) => {
          setHistoryOpen(e.currentTarget.open);
          if (e.currentTarget.open && !history) loadHistory();
        }}
      >
        <summary>Upload history</summary>
        {!history ? (
          <p className="al-muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="al-muted">No file has been applied since the history began.</p>
        ) : (
          <ol className="al-history__list">
            {history.map((u) => (
              <li key={u.id}>
                <span className="al-history__when">{when(u.uploadedAt)}</span>
                <span>
                  <strong>{UPLOADS[u.kind]?.title || u.kind}</strong>
                  {u.fileName && <span className="al-muted"> · {u.fileName}</span>}
                  {u.uploadedBy && <span className="al-muted"> · {u.uploadedBy.fullName}</span>}
                </span>
                <span className="al-history__what">{describe(u)}</span>
              </li>
            ))}
          </ol>
        )}
      </details>

      <PreviewDialog pending={pending} applying={applying} onApply={apply} onHide={() => !applying && setPending(null)} />
    </section>
  );
}

/** What an upload did, in a line. */
function describe(u) {
  const s = u.summary || {};
  if (u.kind === "stops") return `${count(s.trains, "train")}: ${n(s.added)} new, ${n(s.changed)} changed`;
  if (u.kind === "census") {
    const scanned = span(u.scannedFrom, u.scannedTo);
    return `${count(s.pairs, "train pair")}: ${n(s.added)} new, ${n(s.changed)} changed${
      s.skipped ? `, ${count(s.skipped, "line")} left out` : ""
    }${scanned ? ` · railway checked ${scanned}` : ""}`;
  }
  if (u.kind === "counts") return `${count(s.set, "count")} set, ${n(s.cleared)} cleared`;
  return "";
}

function PreviewDialog({ pending, applying, onApply, onHide }) {
  const p = pending?.preview;
  const nothing =
    !p ||
    (p.kind === "stops" && p.added + p.changed === 0) ||
    (p.kind === "census" && p.pairs === 0) ||
    (p.kind === "counts" && p.set + p.cleared === 0);

  return (
    <Dialog
      header={pending ? `${UPLOADS[pending.kind].title}: ${pending.fileName}` : ""}
      visible={Boolean(pending)}
      onHide={onHide}
      style={{ width: "44rem", maxWidth: "94vw" }}
      draggable={false}
      footer={
        <div className="al-dialog__actions">
          <Button label="Cancel" text onClick={onHide} disabled={applying} />
          <Button label="Apply" icon="pi pi-check" onClick={onApply} loading={applying} disabled={nothing} />
        </div>
      }
    >
      {p && (
        <div className="al-preview">
          <p className="al-preview__lead">Nothing has changed yet. This is what applying the file would do:</p>

          {p.kind === "stops" && (
            <ul className="al-preview__facts">
              <li>
                <strong>{count(p.trains, "train")}</strong>: {n(p.added)} new, {n(p.changed)} changed, {n(p.unchanged)} as they
                are
              </li>
              {p.offRoute > 0 && (
                <li className="al-warn">
                  {n(p.offRoute)} checked pairs are not on their train&apos;s new route, in that order. They are kept.
                </li>
              )}
            </ul>
          )}

          {p.kind === "census" && (
            <ul className="al-preview__facts">
              <li>
                <strong>{count(p.rows, "line")}</strong> give <strong>{count(p.pairs, "train pair")}</strong>: {n(p.added)} new,{" "}
                {n(p.changed)} changed, {n(p.unchanged)} as they are
              </li>
              <li>
                {n(p.allocated)} allocated, {n(p.notAllocated)} not allocated, on {count(p.trains, "train")}
              </li>
              {p.classesRemoved > 0 && (
                <li className="al-warn">
                  {n(p.classesRemoved)} classes are no longer allocated and go
                  {p.countsLost > 0 && `, ${n(p.countsLost)} of them with a count typed in`}.
                </li>
              )}
              {p.newTrainCount > 0 && (
                <li className="al-warn">
                  {n(p.newTrainCount)} trains have no route uploaded yet:{" "}
                  {p.newTrains.map((t) => `${t.name} (${t.number})`).join(", ")}
                  {p.newTrainCount > p.newTrains.length && "…"}
                </li>
              )}
              {p.offRoute > 0 && (
                <li className="al-warn">
                  {n(p.offRoute)} pairs are not on their train&apos;s route in that order. They are kept as given.
                </li>
              )}
              {p.scannedFrom && <li>The railway was checked {span(p.scannedFrom, p.scannedTo)}.</li>}
              {p.duplicates > 0 && <li>{n(p.duplicates)} train pairs appear twice; the later line is used.</li>}
            </ul>
          )}

          {p.kind === "counts" && (
            <ul className="al-preview__facts">
              <li>
                <strong>{count(p.rows, "line")}</strong>: {count(p.set, "count")} set, {n(p.cleared)} back to &ldquo;count not
                available&rdquo;, {n(p.unchanged)} as they are
              </li>
            </ul>
          )}

          {(p.skippedCount || p.skipped?.length) > 0 && (
            <div className="al-skipped">
              <h4>
                Left out: {count(p.skippedCount ?? p.skipped.length, p.kind === "stops" ? "train" : "line")}
              </h4>
              <div className="al-skipped__list">
                <table>
                  <tbody>
                    {p.skipped.map((s, i) => (
                      <tr key={i}>
                        <td className="al-muted">{s.line ? `Line ${s.line}` : `Train ${s.train}`}</td>
                        <td>{s.from ? `${stationLabel(s.from)} → ${stationLabel(s.to)}` : ""}</td>
                        <td>{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {p.skippedCount > p.skipped.length && (
                <small className="al-muted">The first {n(p.skipped.length)} are listed.</small>
              )}
            </div>
          )}

          {nothing && <Message severity="info" text="There is nothing in this file to apply." />}
        </div>
      )}
    </Dialog>
  );
}
