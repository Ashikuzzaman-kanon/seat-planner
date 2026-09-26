"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dialog } from "primereact/dialog";
import { Toast } from "primereact/toast";
import { Tag } from "primereact/tag";
import { Checkbox } from "primereact/checkbox";
import { Message } from "primereact/message";
import Select from "@/components/ui/Select";
import QrScanner from "@/components/checking/QrScanner";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { fetchSearchStations } from "@/lib/booking";
import {
  checkTicket,
  scanTicket,
  reportTicket,
  VERDICTS,
  REPORT_KINDS,
} from "@/lib/checking";
import "@/components/checking/checking.css";

/**
 * The screen a ticket checker holds (§14).
 *
 * ## What this is shaped around
 *
 * Somebody standing in a moving carriage, holding a phone in one hand, deciding
 * in about two seconds whether to let a person sit down. So the verdict is the
 * page — not a row in a table, not a toast that fades. It fills the screen in a
 * colour that can be read at arm's length, with the sentence underneath that
 * the checker will say out loud.
 *
 * ## Look and admit are two buttons, not one
 *
 * **Check** reads the ticket and changes nothing. **Admit** marks it used, and
 * that cannot be undone. They are deliberately separate and differently
 * weighted on the page, because a passenger asking "am I on the right train"
 * must not have their ticket burned to find out — and because a checker with
 * one button will press it on every ticket they look at.
 *
 * ## The service is chosen first
 *
 * Without it, a ticket for tomorrow's train reads as valid today. Picking the
 * service turns "is this a real ticket" into "is this a real ticket for this
 * train", which is the question actually being asked. It is optional, because a
 * gate at a station is checking tickets for many services — but the page says
 * what is lost when it is left empty.
 */
/** The station's name, for the collapsed summary. */
const stationName = (stations, id) =>
  stations.find((s) => s.id === id)?.name || `Station ${id}`;

export default function CheckerPage() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);
  const manual = useRef(null);

  const canCheck = hasPermission(PERMISSIONS.TICKET_VERIFY) || hasPermission(PERMISSIONS.TICKET_SCAN);
  const canAdmit = hasPermission(PERMISSIONS.TICKET_SCAN);
  const canReport = hasPermission(PERMISSIONS.TICKET_REPORT);

  const [stations, setStations] = useState([]);
  const [stationId, setStationId] = useState(null);
  const [tripId, setTripId] = useState("");

  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  /*
   * What a camera scan does.
   *
   * Off by default, and that default is the important part: marking a ticket
   * used is irreversible, and a used ticket can no longer be refunded — the
   * refund service turns it down with "that ticket has already been travelled
   * on". Pointing a lens at somebody must not quietly spend their ticket, so
   * scanning reads and shows, and admitting is a thing you turn on.
   */
  const [markOnScan, setMarkOnScan] = useState(false);

  /*
   * Bumped for every answer, including an identical one.
   *
   * The verdict panel is keyed on it, so React replaces the node and the
   * entrance animation runs again — which is the whole point: a checker
   * scanning a queue of passengers needs to see that the screen answered, and
   * two valid tickets in a row look identical without it.
   */
  const [answerSeq, setAnswerSeq] = useState(0);

  const [reporting, setReporting] = useState(false);
  const [reportKind, setReportKind] = useState("identity_mismatch");
  const [reportDetail, setReportDetail] = useState("");

  useEffect(() => {
    fetchSearchStations()
      .then(setStations)
      .catch(() => setStations([]));
  }, []);

  const remember = (outcome, how) =>
    setHistory((current) =>
      [
        {
          at: new Date(),
          how,
          verdict: outcome.verdict,
          ticketNumber: outcome.ticket?.ticketNumber || outcome.scan?.ticketNumber || "—",
          passenger: outcome.ticket?.passengerName || null,
        },
        ...current,
      ].slice(0, 25)
    );

  /**
   * One path for both buttons and both inputs.
   *
   * A refused ticket is a 200 with a verdict, so nothing here treats a refusal
   * as a failure — only a network or permission problem lands in `catch`.
   */
  const run = useCallback(
    async ({ token, ticketNumber, admit }) => {
      if (busy) return;
      setBusy(true);
      try {
        const body = {
          token,
          ticketNumber,
          tripId: tripId ? Number(tripId) : undefined,
          stationId: stationId || undefined,
        };
        const outcome = admit
          ? await scanTicket({
              ...body,
              // Lets a retry after a dropped connection record nothing twice.
              clientReference: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            })
          : await checkTicket(body);

        setResult(outcome);
        setAnswerSeq((n) => n + 1);
        remember(outcome, admit ? "admit" : "check");

        /*
         * A short buzz on a phone.
         *
         * Somebody working down a carriage is looking at the passenger, not the
         * screen. Two pulses for a refusal, one for a pass — enough to know
         * whether to look down, without reading anything. Ignored silently on a
         * laptop, which has no vibrator.
         */
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(outcome.refused ? [90, 70, 90] : 45);
        }
      } catch (err) {
        toast.current?.show({
          severity: "error",
          summary: "Could not reach the ticket system",
          detail: err.message,
          life: 6000,
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, tripId, stationId]
  );

  // The camera does what the checkbox says. Off by default — see the note on
  // `markOnScan`.
  const onCode = useCallback(
    (value) => run({ token: value, admit: markOnScan && canAdmit }),
    [run, markOnScan, canAdmit]
  );

  const submitTyped = (admit) => {
    const value = typed.trim();
    if (!value) return;
    run({ ticketNumber: value, admit });
    setTyped("");
    manual.current?.focus();
  };

  const sendReport = async () => {
    try {
      await reportTicket({
        ticketNumber: result?.ticket?.ticketNumber,
        kind: reportKind,
        detail: reportDetail.trim(),
        stationId: stationId || undefined,
      });
      setReporting(false);
      setReportDetail("");
      toast.current?.show({
        severity: "success",
        summary: "Reported",
        detail: "A reviewer will look at this. Nothing has changed for the passenger.",
        life: 6000,
      });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Not reported", detail: err.message, life: 6000 });
    }
  };

  if (!canCheck) {
    return (
      <div className="card">
        <h1 className="page-title">Check a ticket</h1>
        <p className="page-subtitle">Your account cannot check tickets.</p>
      </div>
    );
  }

  const verdict = result ? VERDICTS[result.verdict] || { headline: result.verdict, tone: "warn" } : null;

  return (
    <div className="checker">
      <Toast ref={toast} />

      <h1 className="page-title">Check a ticket</h1>
      <p className="page-subtitle">
        Checking reads a ticket and changes nothing. Admitting marks it used, and that cannot be
        undone.
      </p>

      {/*
        Both optional, and said so plainly.
        An earlier version put these in a card above the scanner with no labels,
        which made them read as a form to fill in before anything would work.
        They are not: a ticket checks fine with both empty. Each one buys
        something specific, and the labels now say what.
      */}
      <details className="checker__where" open={Boolean(tripId || stationId)}>
        <summary>
          <span>
            Checking on a service?
            <em>Optional — tickets check fine without this</em>
          </span>
          {(tripId || stationId) && (
            <Tag
              value={[tripId && `Trip ${tripId}`, stationId && stationName(stations, stationId)]
                .filter(Boolean)
                .join(" · ")}
              severity="info"
            />
          )}
        </summary>

        <div className="checker__where-fields">
          <label>
            <span>Trip number</span>
            {/* Typed rather than chosen: a checker knows their trip from the
                roster, and a dropdown of every departure is unusable on a phone. */}
            <InputText
              value={tripId}
              onChange={(e) => setTripId(e.target.value.replace(/\D/g, ""))}
              placeholder="e.g. 66"
              inputMode="numeric"
              className="checker__tripnum"
            />
            <small>
              Catches a real ticket for a different train. Leave empty at a gate serving many
              services.
            </small>
          </label>

          <label>
            <span>Where you are</span>
            <Select
              value={stationId}
              options={stations.map((s) => ({ label: `${s.name} (${s.code})`, value: s.id }))}
              onChange={(e) => setStationId(e.value)}
              placeholder="Station"
              className="checker__station"
            />
            <small>
              Recorded against the scan so the log says where somebody boarded. Changes no verdict.
            </small>
          </label>
        </div>
      </details>

      <div className="checker__work">
        <section className="card checker__input">
          <h2>Scan</h2>
          <QrScanner onCode={onCode} disabled={busy} />

          {canAdmit && (
            <div className={`checker__mode${markOnScan ? " is-armed" : ""}`}>
              <label>
                <Checkbox
                  inputId="mark-on-scan"
                  checked={markOnScan}
                  onChange={(e) => setMarkOnScan(e.checked)}
                />
                <span>
                  <strong>Admit as I scan</strong>
                  <em>
                    {markOnScan
                      ? "Every code read will be marked used."
                      : "Scanning only reads the ticket. Nothing is marked."}
                  </em>
                </span>
              </label>
            </div>
          )}

          {markOnScan && (
            <Message
              severity="warn"
              className="checker__armed-note"
              text="Marking a ticket used cannot be undone, and a used ticket can no longer be refunded."
            />
          )}

          <h2 className="checker__or">Or type the number</h2>
          <div className="checker__typed">
            <InputText
              ref={manual}
              value={typed}
              onChange={(e) => setTyped(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && submitTyped(false)}
              placeholder="TXXXX-XXXX"
              className="checker__number"
            />
            <div className="checker__buttons">
              <Button
                label="Check"
                icon="pi pi-eye"
                onClick={() => submitTyped(false)}
                disabled={busy || !typed.trim()}
                outlined
              />
              {canAdmit && (
                <Button
                  label="Admit"
                  icon="pi pi-check"
                  severity="success"
                  onClick={() => submitTyped(true)}
                  disabled={busy || !typed.trim()}
                />
              )}
            </div>
          </div>
        </section>

        <section
          key={answerSeq}
          className={`card checker__verdict${verdict ? ` is-${verdict.tone}` : ""}${
            result ? " is-new" : " is-empty"
          }`}
          // Read out when it changes, so the answer reaches somebody who is not
          // looking at the screen.
          aria-live="assertive"
        >
          {!result ? (
            <div className="checker__empty">
              <i className="pi pi-qrcode" aria-hidden="true" />
              <p>Scan a ticket or type its number.</p>
            </div>
          ) : (
            <>
              <div className="checker__headline">
                <i className={verdict.icon} aria-hidden="true" />
                <strong>{verdict.headline}</strong>
              </div>

              {/* The sentence the checker says out loud. */}
              <p className="checker__message">{result.message}</p>

              {result.ticket && (
                <dl className="checker__ticket">
                  <div>
                    <dt>Passenger</dt>
                    <dd>{result.ticket.passengerName}</dd>
                  </div>
                  <div>
                    <dt>NID ends</dt>
                    <dd>…{result.ticket.nidLastFour}</dd>
                  </div>
                  <div>
                    <dt>Seat</dt>
                    <dd>
                      {result.ticket.coachCode} {result.ticket.seatNumber}
                    </dd>
                  </div>
                  <div>
                    <dt>Train</dt>
                    <dd>{result.ticket.train}</dd>
                  </div>
                  <div>
                    <dt>Journey</dt>
                    <dd>
                      {result.ticket.from} → {result.ticket.to}
                    </dd>
                  </div>
                  <div>
                    <dt>Travelling</dt>
                    <dd>{result.ticket.travellingOn}</dd>
                  </div>
                </dl>
              )}

              <div className="checker__proof">
                {result.signatureOk ? (
                  <Tag severity="success" icon="pi pi-verified" value="Signature verified" />
                ) : result.typedOnly ? (
                  <Tag severity="info" icon="pi pi-pencil" value="Typed — signature not proven" />
                ) : null}
              </div>

              {/* Admitting from the verdict, for the common case: scan, look,
                  let them sit down. */}
              {canAdmit && result.verdict === "checked" && result.ticket && (
                <Button
                  label={`Admit ${result.ticket.passengerName}`}
                  icon="pi pi-check"
                  severity="success"
                  className="checker__admit"
                  loading={busy}
                  onClick={() => run({ ticketNumber: result.ticket.ticketNumber, admit: true })}
                />
              )}

              {canReport && result.ticket && (
                <Button
                  label="Report this ticket"
                  icon="pi pi-flag"
                  severity="warning"
                  text
                  onClick={() => setReporting(true)}
                />
              )}
            </>
          )}
        </section>
      </div>

      {history.length > 0 && (
        <section className="card checker__history">
          <h2>This shift</h2>
          <ul>
            {history.map((h, i) => (
              <li key={i}>
                <span className={`checker__dot is-${(VERDICTS[h.verdict] || {}).tone || "warn"}`} />
                <strong>{h.ticketNumber}</strong>
                <span>{(VERDICTS[h.verdict] || {}).headline || h.verdict}</span>
                {h.passenger && <em>{h.passenger}</em>}
                <small>
                  {h.how === "admit" ? "admitted" : "checked"} ·{" "}
                  {h.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog
        header="Report this ticket"
        visible={reporting}
        onHide={() => setReporting(false)}
        style={{ width: "min(520px, 94vw)" }}
        dismissableMask
      >
        <p className="checker__report-lead">
          This records what you saw and nothing else. It does not stop the passenger travelling
          and does not affect their account until a reviewer agrees with it.
        </p>
        <label className="checker__field">
          <span>What was wrong?</span>
          <Select value={reportKind} options={REPORT_KINDS} onChange={(e) => setReportKind(e.value)} />
        </label>
        <label className="checker__field">
          <span>What happened?</span>
          <InputTextarea
            value={reportDetail}
            onChange={(e) => setReportDetail(e.target.value)}
            rows={4}
            autoResize
            placeholder="The card presented had a different name to the ticket."
          />
          <small>At least a sentence — a report nobody can review is not a report.</small>
        </label>
        <div className="checker__report-actions">
          <Button label="Cancel" text severity="secondary" onClick={() => setReporting(false)} />
          <Button
            label="Send report"
            icon="pi pi-flag"
            severity="warning"
            disabled={reportDetail.trim().length < 10}
            onClick={sendReport}
          />
        </div>
      </Dialog>
    </div>
  );
}
