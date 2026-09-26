"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { Dialog } from "primereact/dialog";
import { InputTextarea } from "primereact/inputtextarea";
import { SelectButton } from "primereact/selectbutton";
import { Paginator } from "primereact/paginator";
import { Message } from "primereact/message";
import { ProgressSpinner } from "primereact/progressspinner";
import {
  fetchQueues,
  fetchApprovals,
  fetchMyRequests,
  decideRequest,
  cancelRequest,
  APPROVAL_TYPE_LABELS,
  APPROVAL_STATUS_SEVERITY,
} from "@/lib/postSale";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import "@/components/booking/booking.css";
import "@/components/postsale/postsale.css";

/**
 * The queue of decisions waiting on a person.
 *
 * One screen for several kinds of request, because they are one mechanism
 * underneath — a transfer and a withdrawal differ in what they are about and in
 * who may decide them, and in nothing else. A queue the caller may see but not
 * act on is shown read-only rather than hidden, so a supervisor can watch work
 * they do not do.
 *
 * Passengers land here too, on their own requests, without holding the
 * reviewer's permission.
 */
export default function RequestsPage() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);

  const canReview = hasPermission(PERMISSIONS.APPROVAL_VIEW);

  const [queues, setQueues] = useState([]);
  const [scope, setScope] = useState(canReview ? "queue" : "mine");
  const [type, setType] = useState(null);
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const notify = (severity, summary, detail) =>
    toast.current?.show({ severity, summary, detail, life: severity === "error" ? 7000 : 5000 });

  const loadQueues = useCallback(async () => {
    if (!canReview) return;
    try {
      setQueues(await fetchQueues());
    } catch (err) {
      notify("error", "Error", err.message);
    }
  }, [canReview]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        scope === "mine"
          ? await fetchMyRequests({ page })
          : await fetchApprovals({ type, status, page })
      );
    } catch (err) {
      notify("error", "Error", err.message);
    } finally {
      setLoading(false);
    }
  }, [scope, type, status, page]);

  useEffect(() => {
    loadQueues();
  }, [loadQueues]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (decision) => {
    setBusy(true);
    try {
      const result = await decideRequest({
        reference: deciding.reference,
        decision,
        note: note.trim() || undefined,
      });
      setDeciding(null);
      setNote("");
      notify(decision === "approve" ? "success" : "info", "Decided", result.message);
      await Promise.all([load(), loadQueues()]);
    } catch (err) {
      notify("error", "Could not decide it", err.message);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (request) => {
    try {
      const result = await cancelRequest(request.reference);
      notify("info", "Withdrawn", result.message);
      load();
    } catch (err) {
      notify("error", "Could not withdraw it", err.message);
    }
  };

  const queueFor = (t) => queues.find((q) => q.type === t);
  const requests = data?.requests || [];

  return (
    <div>
      <Toast ref={toast} />

      <h1 className="page-title">Requests</h1>
      <p className="page-subtitle">
        Transfers and withdrawals wait here for a person to decide. Nothing moves until one does.
      </p>

      {canReview && (
        <>
          <div className="queue-cards">
            {queues.map((queue) => (
              <button
                key={queue.type}
                type="button"
                className={`queue-card${type === queue.type && scope === "queue" ? " is-chosen" : ""}`}
                onClick={() => {
                  setScope("queue");
                  setType(type === queue.type ? null : queue.type);
                  setPage(1);
                }}
              >
                <span className="queue-card__count">{queue.pending}</span>
                <strong>{queue.label}</strong>
                <small>{queue.description}</small>
                {!queue.canDecide && (
                  <Tag value="View only" severity="secondary" className="queue-card__readonly" />
                )}
              </button>
            ))}
          </div>

          <div className="card bookings-toolbar">
            <SelectButton
              value={scope}
              options={[
                { label: "The queue", value: "queue" },
                { label: "Mine", value: "mine" },
              ]}
              onChange={(e) => {
                if (!e.value) return;
                setScope(e.value);
                setPage(1);
              }}
              allowEmpty={false}
            />

            {scope === "queue" && (
              <SelectButton
                value={status}
                options={[
                  { label: "Waiting", value: "pending" },
                  { label: "Approved", value: "approved" },
                  { label: "Rejected", value: "rejected" },
                  { label: "All", value: null },
                ]}
                onChange={(e) => {
                  setStatus(e.value);
                  setPage(1);
                }}
              />
            )}
          </div>
        </>
      )}

      {loading ? (
        <div className="book-centre">
          <ProgressSpinner style={{ width: 36, height: 36 }} />
        </div>
      ) : requests.length === 0 ? (
        <div className="card bookings-empty">
          <i className="pi pi-inbox" aria-hidden="true" />
          <p>
            {scope === "mine"
              ? "You have not asked for anything that needs approval."
              : "Nothing is waiting."}
          </p>
        </div>
      ) : (
        <div className="bookings-list">
          {requests.map((request) => {
            const queue = queueFor(request.type);
            const mayDecide = canReview && queue?.canDecide && request.isOpen;
            const mine = scope === "mine";

            return (
              <article key={request.id} className="card booking-row">
                <div className="booking-row__head">
                  <div>
                    <span className="booking-ref">{request.reference}</span>
                    <h3>{APPROVAL_TYPE_LABELS[request.type] || request.type}</h3>
                    <p className="booking-journey">
                      {request.summary || request.subjectLabel}
                    </p>
                    {request.reason && <p className="request-reason">“{request.reason}”</p>}
                  </div>

                  <div className="booking-row__meta">
                    <Tag
                      value={request.status}
                      severity={APPROVAL_STATUS_SEVERITY[request.status] || "info"}
                    />
                    <small className="request-when">
                      {new Date(request.createdAt).toLocaleString("en-GB", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Asia/Dhaka",
                      })}
                    </small>
                  </div>
                </div>

                {!mine && request.requestedBy && (
                  <p className="request-who">
                    Asked by <strong>{request.requestedBy.fullName}</strong> ({request.requestedBy.email})
                  </p>
                )}

                {request.decidedAt && (
                  <p className="request-decision">
                    {request.status} by {request.decidedBy?.fullName || "a reviewer"}
                    {request.decisionNote && <span> — “{request.decisionNote}”</span>}
                  </p>
                )}

                <div className="booking-row__actions">
                  {mayDecide && (
                    <>
                      <Button
                        label="Approve"
                        icon="pi pi-check"
                        size="small"
                        onClick={() => setDeciding({ ...request, intent: "approve" })}
                      />
                      <Button
                        label="Reject"
                        icon="pi pi-times"
                        size="small"
                        outlined
                        severity="danger"
                        onClick={() => setDeciding({ ...request, intent: "reject" })}
                      />
                    </>
                  )}

                  {mine && request.isOpen && (
                    <Button
                      label="Withdraw this request"
                      icon="pi pi-undo"
                      size="small"
                      text
                      onClick={() => withdraw(request)}
                    />
                  )}

                  {canReview && request.isOpen && !queue?.canDecide && (
                    <span className="request-readonly">
                      You can see this queue but not decide it.
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {data?.pagination?.pages > 1 && (
        <Paginator
          first={(data.pagination.page - 1) * data.pagination.limit}
          rows={data.pagination.limit}
          totalRecords={data.pagination.total}
          onPageChange={(e) => setPage(Math.floor(e.first / e.rows) + 1)}
        />
      )}

      <Dialog
        header={deciding ? `${deciding.intent === "approve" ? "Approve" : "Reject"} ${deciding.reference}` : ""}
        visible={Boolean(deciding)}
        onHide={() => (busy ? null : setDeciding(null))}
        className="decide-dialog"
        dismissableMask={!busy}
        draggable={false}
      >
        {deciding && (
          <>
            <p className="decide-summary">{deciding.summary || deciding.subjectLabel}</p>

            {deciding.intent === "approve" && deciding.type === "wallet_withdrawal" && (
              <Message
                severity="warn"
                className="book-message"
                text="Approving debits the wallet immediately. If the balance no longer covers it, the request stays waiting and nothing moves."
              />
            )}

            {deciding.intent === "approve" && deciding.type === "ticket_transfer" && (
              <Message
                severity="warn"
                className="book-message"
                text="Approving rewrites the passenger on the ticket. Check the National ID against what was presented."
              />
            )}

            <div className="passenger-field">
              <label htmlFor="note">Note</label>
              <InputTextarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                autoResize
                maxLength={500}
                placeholder="Why — kept with the decision"
              />
            </div>

            <div className="return-actions">
              <Button label="Cancel" text onClick={() => setDeciding(null)} disabled={busy} />
              <Button
                label={deciding.intent === "approve" ? "Approve" : "Reject"}
                icon={deciding.intent === "approve" ? "pi pi-check" : "pi pi-times"}
                severity={deciding.intent === "approve" ? undefined : "danger"}
                onClick={() => decide(deciding.intent)}
                loading={busy}
              />
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
