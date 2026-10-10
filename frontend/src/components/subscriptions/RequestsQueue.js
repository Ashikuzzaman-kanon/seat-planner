"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "primereact/button";
import { Paginator } from "primereact/paginator";
import { ProgressSpinner } from "primereact/progressspinner";
import PeriodPicker, { isChosen, lastDayOf } from "./PeriodPicker";
import ReasonDialog from "./ReasonDialog";
import { approveRequest, declineRequest, fetchMembers, longDate } from "@/lib/subscriptions";
import { timeAgo } from "@/lib/notifications";

const DEFAULT_PERIOD = { days: 30 };

/**
 * The people waiting to be subscribed, oldest first.
 *
 * Approving asks for one thing — how long — and says the day that comes to
 * before anything is confirmed.
 */
export default function RequestsQueue({ onDecided, notify }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null); // { intent, request }
  const [period, setPeriod] = useState(DEFAULT_PERIOD);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchMembers({ status: "pending", page }));
    } catch (err) {
      notify("error", "Could not load the requests", err.message);
    } finally {
      setLoading(false);
    }
  }, [page, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const start = (intent, request) => {
    setPeriod(DEFAULT_PERIOD);
    setDeciding({ intent, request });
  };

  const decide = async (note) => {
    const { intent, request } = deciding;
    try {
      if (intent === "approve") {
        const done = await approveRequest(request.id, { period, note });
        notify("success", "Approved", `${request.user.fullName} — ${request.subscription.name} until ${longDate(done.lastDay)}`);
      } else {
        await declineRequest(request.id, { note });
        notify("info", "Declined", `${request.user.fullName} — ${request.subscription.name}`);
      }
      setDeciding(null);
      await Promise.all([load(), onDecided?.()]);
    } catch (err) {
      notify("error", "Could not decide it", err.message);
      // Someone else may have decided it meanwhile; show the queue as it is now.
      load();
    }
  };

  if (loading && !data) {
    return (
      <div className="sub-centre">
        <ProgressSpinner style={{ width: 36, height: 36 }} />
      </div>
    );
  }

  const requests = data?.members || [];
  const approving = deciding?.intent === "approve";

  return (
    <>
      {requests.length === 0 ? (
        <div className="card sub-empty">
          <i className="pi pi-inbox" aria-hidden="true" />
          <p>Nobody is waiting.</p>
        </div>
      ) : (
        <ul className="sub-queue">
          {requests.map((request) => (
            <li key={request.id} className="card sub-request">
              <div className="sub-request__who">
                <strong>{request.user.fullName}</strong>
                <span>{request.user.email}</span>
              </div>
              <div className="sub-request__what">
                <span className="sub-request__label">asked for</span>
                <strong>{request.subscription.name}</strong>
                <small title={new Date(request.requestedAt).toLocaleString("en-GB")}>{timeAgo(request.requestedAt)}</small>
              </div>
              <div className="sub-request__actions">
                <Button label="Approve" icon="pi pi-check" size="small" onClick={() => start("approve", request)} />
                <Button
                  label="Decline"
                  icon="pi pi-times"
                  size="small"
                  outlined
                  severity="danger"
                  onClick={() => start("decline", request)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {data?.pagination?.pages > 1 && (
        <Paginator
          first={(data.pagination.page - 1) * data.pagination.limit}
          rows={data.pagination.limit}
          totalRecords={data.pagination.total}
          onPageChange={(e) => setPage(Math.floor(e.first / e.rows) + 1)}
        />
      )}

      <ReasonDialog
        visible={Boolean(deciding)}
        header={
          deciding ? `${approving ? "Approve" : "Decline"} ${deciding.request.user.fullName}’s request` : ""
        }
        message={
          deciding
            ? approving
              ? `${deciding.request.subscription.name}, for how long?`
              : `${deciding.request.subscription.name} — they will be told it was not approved, and can ask again.`
            : ""
        }
        confirmLabel={approving ? `Approve until ${longDate(lastDayOf(period)) || "…"}` : "Decline"}
        confirmIcon={approving ? "pi pi-check" : "pi pi-times"}
        severity={approving ? undefined : "danger"}
        reasonLabel="Note to them"
        reasonPlaceholder={approving ? "Optional — sent with the approval" : "Optional — why, so they are not left guessing"}
        canConfirm={!approving || isChosen(period)}
        onConfirm={decide}
        onHide={() => setDeciding(null)}
      >
        {approving && <PeriodPicker value={period} onChange={setPeriod} id="approve-period" />}
      </ReasonDialog>
    </>
  );
}
