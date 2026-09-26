"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "primereact/button";
import { InputTextarea } from "primereact/inputtextarea";
import { Dialog } from "primereact/dialog";
import { Toast } from "primereact/toast";
import { Tag } from "primereact/tag";
import { Message } from "primereact/message";
import { SelectButton } from "primereact/selectbutton";
import { ConfirmDialog } from "primereact/confirmdialog";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { fetchReports, reviewReport, fetchHeldAccounts, REPORT_KINDS } from "@/lib/checking";
import StandingDialog from "@/components/checking/StandingDialog";
import "@/components/checking/reports.css";

import { TIP } from "@/components/ui/tip";
/**
 * The review queue, and what a reviewer needs to decide well (§14.3).
 *
 * ## Why the score is shown broken apart
 *
 * A reviewer deciding whether to uphold a report is, in effect, deciding
 * whether to move somebody closer to being locked out. A bare number — "this
 * account scores 74" — cannot be argued with, so it gets agreed with. Showing
 * the arithmetic makes it answerable: which signals, how many, at what weight,
 * and the sentence explaining why each counted what it did.
 *
 * ## Why upholding and holding are different buttons in different places
 *
 * Upholding a report says "the checker was right". Holding an account says
 * "stop this person buying". They are related and they are not the same
 * decision, and a screen that let one gesture do both would quietly turn every
 * upheld report into a punishment.
 */

const STATUSES = [
  { label: "Waiting", value: "open" },
  { label: "Upheld", value: "upheld" },
  { label: "Dismissed", value: "dismissed" },
  { label: "All", value: "all" },
];

const KIND_LABEL = Object.fromEntries(REPORT_KINDS.map((k) => [k.value, k.label]));

const STATUS_TAG = {
  open: { severity: "warning", value: "Waiting" },
  upheld: { severity: "danger", value: "Upheld" },
  dismissed: { severity: "secondary", value: "Dismissed" },
};

export default function ReportsPage() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);

  const canReview = hasPermission(PERMISSIONS.ABUSE_REVIEW);
  const canHold = hasPermission(PERMISSIONS.ACCOUNT_HOLD);

  const [status, setStatus] = useState("open");
  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [held, setHeld] = useState([]);

  const [deciding, setDeciding] = useState(null); // { report, uphold }
  const [note, setNote] = useState("");

  // Which account's standing is open. The dialog loads and acts on it.
  const [showing, setShowing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [queue, holds] = await Promise.all([
        fetchReports({ status }),
        canReview ? fetchHeldAccounts() : Promise.resolve({ holds: [] }),
      ]);
      setReports(queue.reports || []);
      setTotal(queue.total || 0);
      setHeld(holds.holds || []);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not load", detail: err.message, life: 6000 });
    } finally {
      setLoading(false);
    }
  }, [status, canReview]);

  useEffect(() => {
    if (canReview) load();
    else setLoading(false);
  }, [canReview, load]);

  const decide = async () => {
    try {
      await reviewReport(deciding.report.reference, {
        decision: deciding.uphold ? "uphold" : "dismiss",
        note: note.trim() || undefined,
      });
      setDeciding(null);
      setNote("");
      await load();
      toast.current?.show({
        severity: "success",
        summary: deciding.uphold ? "Upheld" : "Dismissed",
        detail: deciding.uphold
          ? "This now counts towards the account's score."
          : "Withdrawn. It counts for nothing.",
        life: 5000,
      });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Not decided", detail: err.message, life: 6000 });
    }
  };


  if (!canReview) {
    return (
      <div className="card">
        <h1 className="page-title">Reported tickets</h1>
        <p className="page-subtitle">Your account cannot review reports.</p>
      </div>
    );
  }

  return (
    <div className="reports">
      <Toast ref={toast} />
      <ConfirmDialog />

      <h1 className="page-title">Reported tickets</h1>
      <p className="page-subtitle">
        A report is what a checker saw. It counts for nothing until you agree with it — and
        upholding one is not the same as holding an account.
      </p>

      {held.length > 0 && (
        <section className="card reports__held">
          <h2>
            <i className="pi pi-lock" aria-hidden="true" /> Accounts on hold ({held.length})
          </h2>
          <ul>
            {held.map((h) => (
              <li key={h.id}>
                <div>
                  <strong>{h.user?.name || `User ${h.userId}`}</strong>
                  <span>{h.detail}</span>
                  <small>
                    {h.automatic ? "Placed automatically" : `Placed by ${h.placedBy || "staff"}`}
                    {h.scoreAtHold != null && ` · score ${h.scoreAtHold}`}
                  </small>
                </div>
                <div className="reports__held-actions">
                  <Button
                    label="Standing"
                    icon="pi pi-chart-bar"
                    text
                    size="small"
                    onClick={() => setShowing({ id: h.userId, name: h.user?.name })}
                  />
                  {canHold && (
                    <Button
                      label="Lift"
                      icon="pi pi-unlock"
                      size="small"
                      severity="secondary"
                      outlined
                      onClick={() => setShowing({ id: h.userId, name: h.user?.name })}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="card reports__toolbar">
        <SelectButton
          value={status}
          options={STATUSES}
          onChange={(e) => e.value && setStatus(e.value)}
          allowEmpty={false}
        />
        <span className="reports__count">{total} report(s)</span>
        <Button tooltip="Refresh" tooltipOptions={TIP} icon="pi pi-refresh" text rounded onClick={load} aria-label="Refresh" />
      </div>

      {loading ? (
        <div className="card reports__empty">Loading…</div>
      ) : reports.length === 0 ? (
        <Message
          severity="success"
          className="reports__none"
          text={
            status === "open"
              ? "Nothing waiting. Every report has been decided."
              : "No reports with that status."
          }
        />
      ) : (
        <div className="reports__list">
          {reports.map((r) => (
            <article key={r.reference} className={`card report is-${r.status}`}>
              <header>
                <div>
                  <strong>{KIND_LABEL[r.kind] || r.kind}</strong>
                  <Tag {...(STATUS_TAG[r.status] || { value: r.status })} />
                </div>
                <code>{r.reference}</code>
              </header>

              <p className="report__detail">“{r.detail}”</p>

              <dl className="report__facts">
                <div>
                  <dt>Ticket</dt>
                  <dd>{r.ticketNumber || "—"}</dd>
                </div>
                <div>
                  <dt>Account</dt>
                  <dd>{r.reportedUser?.name || "—"}</dd>
                </div>
                <div>
                  <dt>Reported by</dt>
                  <dd>{r.reportedBy || "—"}</dd>
                </div>
                <div>
                  <dt>When</dt>
                  <dd>{new Date(r.reportedAt).toLocaleString("en-GB")}</dd>
                </div>
              </dl>

              {r.reviewNote && (
                <p className="report__review">
                  <strong>{r.reviewedBy || "Reviewer"}:</strong> {r.reviewNote}
                </p>
              )}

              <footer>
                {r.reportedUserId && (
                  <Button
                    label="See their standing"
                    icon="pi pi-chart-bar"
                    text
                    size="small"
                    onClick={() => setShowing({ id: r.reportedUserId, name: r.reportedUser?.name })}
                  />
                )}
                {r.status === "open" && (
                  <div className="report__decide">
                    <Button
                      label="Dismiss"
                      icon="pi pi-times"
                      severity="secondary"
                      outlined
                      size="small"
                      onClick={() => setDeciding({ report: r, uphold: false })}
                    />
                    <Button
                      label="Uphold"
                      icon="pi pi-check"
                      severity="danger"
                      size="small"
                      onClick={() => setDeciding({ report: r, uphold: true })}
                    />
                  </div>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}

      {/* ---------------- Deciding ---------------- */}

      <Dialog
        header={deciding?.uphold ? "Uphold this report?" : "Dismiss this report?"}
        visible={Boolean(deciding)}
        onHide={() => setDeciding(null)}
        style={{ width: "min(520px, 94vw)" }}
        dismissableMask
      >
        <p className="reports__lead">
          {deciding?.uphold
            ? "Upholding makes this count towards the account's score. It does not hold the account — that is a separate decision."
            : "Dismissing withdraws it entirely. A report you have rejected counts for nothing, not a little."}
        </p>
        <label className="reports__field">
          <span>Note {deciding?.uphold ? "" : "(recommended)"}</span>
          <InputTextarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoResize
            placeholder={
              deciding?.uphold
                ? "Name and date of birth both wrong; the passenger admitted it."
                : "The checker had the wrong coach; the ticket was fine."
            }
          />
        </label>
        <div className="reports__actions">
          <Button label="Cancel" text severity="secondary" onClick={() => setDeciding(null)} />
          <Button
            label={deciding?.uphold ? "Uphold" : "Dismiss"}
            icon={deciding?.uphold ? "pi pi-check" : "pi pi-times"}
            severity={deciding?.uphold ? "danger" : "secondary"}
            onClick={decide}
          />
        </div>
      </Dialog>

      <StandingDialog
        userId={showing?.id}
        name={showing?.name}
        onHide={() => setShowing(null)}
        onChanged={load}
      />
    </div>
  );
}
