"use client";

import { useState } from "react";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import ReasonDialog from "./ReasonDialog";
import { tip } from "@/components/ui/tip";
import {
  cancelSubscription,
  deleteSubscription,
  longDate,
  requestSubscription,
  standing,
  statusMeta,
  updateSubscription,
} from "@/lib/subscriptions";

const when = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dhaka" })
    : "";

/**
 * Every subscription, with where you stand with it and the one thing you can
 * do about that: ask, withdraw the request, or cancel.
 *
 * Whoever manages subscriptions gets the edit, close and delete controls on
 * the same cards, and whoever reviews them sees how many people are waiting
 * and subscribed — one list, not a second "admin" copy of it to drift apart.
 */
export default function SubscriptionList({ subscriptions, history, canManage, staff, onEdit, onOpenRequests, reload, notify }) {
  const [busyId, setBusyId] = useState(null);
  const [asking, setAsking] = useState(null); // { kind, subscription }

  const subscribe = async (subscription) => {
    setBusyId(subscription.id);
    try {
      await requestSubscription(subscription.id);
      notify("success", "Request sent", `Someone will review your request for ${subscription.name}.`);
      await reload();
    } catch (err) {
      notify("error", "Could not ask for it", err.message);
    } finally {
      setBusyId(null);
    }
  };

  const confirm = async (reason) => {
    const { kind, subscription } = asking;
    try {
      if (kind === "cancel") {
        await cancelSubscription(subscription.mine.id, { reason });
        notify(
          "info",
          subscription.mine.status === "pending" ? "Request withdrawn" : "Subscription cancelled",
          subscription.name
        );
      } else if (kind === "close") {
        await updateSubscription(subscription.id, { isOpen: false });
        notify("info", "Closed to new requests", subscription.name);
      } else if (kind === "delete") {
        await deleteSubscription(subscription.id);
        notify("info", "Deleted", subscription.name);
      }
      setAsking(null);
      await reload();
    } catch (err) {
      notify("error", "That did not work", err.message);
    }
  };

  const reopen = async (subscription) => {
    setBusyId(subscription.id);
    try {
      await updateSubscription(subscription.id, { isOpen: true });
      notify("success", "Open to requests again", subscription.name);
      await reload();
    } catch (err) {
      notify("error", "Could not reopen it", err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (!subscriptions.length) {
    return (
      <div className="card sub-empty">
        <i className="pi pi-id-card" aria-hidden="true" />
        <p>{canManage ? "No subscriptions yet. Create the first one." : "There is nothing to subscribe to yet."}</p>
        {canManage && <Button label="New subscription" icon="pi pi-plus" onClick={() => onEdit({})} />}
      </div>
    );
  }

  const past = history.filter((h) => !(h.status === "pending" || h.valid));

  return (
    <>
      <div className="sub-grid">
        {subscriptions.map((subscription) => {
          const mine = subscription.mine;
          const live = mine && (mine.status === "pending" || mine.valid);
          const meta = mine ? statusMeta(mine.status) : null;
          const untouched = staff && subscription.counts.pending + subscription.counts.active === 0 && !mine;

          return (
            <article key={subscription.id} className={`card sub-card${mine?.valid ? " is-active" : ""}`}>
              <header className="sub-card__head">
                <div>
                  <h3>{subscription.name}</h3>
                  {staff && (
                    <code className="sub-code" title="Outside callers check for this subscription by this code">
                      {subscription.code}
                    </code>
                  )}
                </div>
                {canManage && (
                  <span className="sub-card__manage">
                    <Button icon="pi pi-pencil" size="small" text rounded onClick={() => onEdit(subscription)} {...tip("Rename or re-describe")} />
                    {subscription.isOpen ? (
                      <Button
                        icon="pi pi-lock"
                        size="small"
                        text
                        rounded
                        onClick={() => setAsking({ kind: "close", subscription })}
                        {...tip("Close to new requests")}
                      />
                    ) : (
                      <Button
                        icon="pi pi-lock-open"
                        size="small"
                        text
                        rounded
                        loading={busyId === subscription.id}
                        onClick={() => reopen(subscription)}
                        {...tip("Open to requests again")}
                      />
                    )}
                    <Button
                      icon="pi pi-trash"
                      size="small"
                      text
                      rounded
                      severity="danger"
                      disabled={!untouched}
                      onClick={() => setAsking({ kind: "delete", subscription })}
                      {...tip(untouched ? "Delete" : "People have asked for this one — close it instead")}
                    />
                  </span>
                )}
              </header>

              {!subscription.isOpen && <Tag value="Closed to new requests" severity="secondary" className="sub-card__closed" />}

              {subscription.description && <p className="sub-card__about">{subscription.description}</p>}

              <p className={`sub-standing${meta ? ` sub-standing--${mine.status}` : ""}`}>
                <i className={meta ? meta.icon : "pi pi-circle"} aria-hidden="true" />
                <span>{standing(mine)}</span>
              </p>
              {mine?.status === "declined" && mine.decisionNote && (
                <p className="sub-card__note">“{mine.decisionNote}”</p>
              )}
              {mine?.status === "cancelled" && mine.endReason && <p className="sub-card__note">“{mine.endReason}”</p>}

              {staff && (
                <button type="button" className="sub-counts" onClick={onOpenRequests} disabled={!onOpenRequests}>
                  <span>
                    <strong>{subscription.counts.pending}</strong> waiting
                  </span>
                  <span>
                    <strong>{subscription.counts.active}</strong> subscribed
                  </span>
                </button>
              )}

              <footer className="sub-card__actions">
                {!live && subscription.isOpen && (
                  <Button
                    label={mine ? "Subscribe again" : "Subscribe"}
                    icon="pi pi-plus"
                    size="small"
                    loading={busyId === subscription.id}
                    onClick={() => subscribe(subscription)}
                  />
                )}
                {mine?.status === "pending" && (
                  <Button
                    label="Withdraw request"
                    icon="pi pi-undo"
                    size="small"
                    outlined
                    onClick={() => setAsking({ kind: "cancel", subscription })}
                  />
                )}
                {mine?.valid && (
                  <Button
                    label="Cancel subscription"
                    icon="pi pi-times"
                    size="small"
                    outlined
                    severity="danger"
                    onClick={() => setAsking({ kind: "cancel", subscription })}
                  />
                )}

              </footer>
            </article>
          );
        })}
      </div>

      {past.length > 0 && (
        <section className="card sub-history" aria-labelledby="sub-history-title">
          <h2 id="sub-history-title">Your earlier requests</h2>
          <ul>
            {past.map((h) => {
              const meta = statusMeta(h.status);
              return (
                <li key={h.id}>
                  <span className="sub-history__what">
                    <strong>{h.subscription?.name}</strong>
                    <small>Asked {when(h.requestedAt)}</small>
                  </span>
                  <span className="sub-history__how">
                    <Tag value={meta.label} severity={meta.severity} />
                    <small>
                      {h.status === "expired" && `Ran until ${longDate(h.lastDay)}`}
                      {h.status === "cancelled" && h.startsAt && `Ended ${when(h.endedAt)}${h.endedBy ? ` by ${h.endedBy}` : ""}`}
                      {h.status === "cancelled" && !h.startsAt && "Withdrawn before it was reviewed"}
                      {h.status === "declined" && (h.decisionNote ? `“${h.decisionNote}”` : `Declined ${when(h.decidedAt)}`)}
                    </small>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <ReasonDialog
        visible={asking?.kind === "cancel"}
        header={asking?.subscription.mine?.status === "pending" ? "Withdraw your request?" : "Cancel your subscription?"}
        message={
          asking?.subscription.mine?.status === "pending"
            ? `Your request for ${asking?.subscription.name} will be closed. You can ask again whenever you like.`
            : `${asking?.subscription.name} stops straight away — it would otherwise run until ${longDate(asking?.subscription.mine?.lastDay)}. To have it again you would need to ask and be approved.`
        }
        confirmLabel={asking?.subscription.mine?.status === "pending" ? "Withdraw request" : "Cancel subscription"}
        cancelLabel="Keep it"
        confirmIcon="pi pi-times"
        severity="danger"
        onConfirm={confirm}
        onHide={() => setAsking(null)}
      />

      <ReasonDialog
        visible={asking?.kind === "close"}
        header={`Close ${asking?.subscription.name || ""} to new requests?`}
        message={
          asking?.subscription.counts?.pending
            ? `Nobody new will be able to ask for it, and the ${asking.subscription.counts.pending} request(s) still waiting will be declined. Subscriptions already running carry on to their end.`
            : "Nobody new will be able to ask for it. Subscriptions already running carry on to their end, and you can reopen it at any time."
        }
        confirmLabel="Close it"
        confirmIcon="pi pi-lock"
        onConfirm={confirm}
        onHide={() => setAsking(null)}
      />

      <ReasonDialog
        visible={asking?.kind === "delete"}
        header={`Delete ${asking?.subscription.name || ""}?`}
        message="Nobody has ever asked for it, so nothing else goes with it. This cannot be undone."
        confirmLabel="Delete"
        confirmIcon="pi pi-trash"
        severity="danger"
        onConfirm={confirm}
        onHide={() => setAsking(null)}
      />
    </>
  );
}
