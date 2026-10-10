"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import SubscriptionList from "@/components/subscriptions/SubscriptionList";
import SubscriptionEditor from "@/components/subscriptions/SubscriptionEditor";
import RequestsQueue from "@/components/subscriptions/RequestsQueue";
import Subscribers from "@/components/subscriptions/Subscribers";
import { fetchMySubscriptions, fetchPendingCount, fetchSubscriptions } from "@/lib/subscriptions";
import "@/components/subscriptions/subscriptions.css";

const TABS = ["subscriptions", "requests", "subscribers"];

/**
 * Subscriptions.
 *
 * Everyone signed in sees what there is and where they stand with each. The
 * two reviewer tabs — who is waiting, and who is subscribed — appear only for
 * someone who can act on them; without that permission there are no tabs at
 * all, just the list.
 *
 * `?tab=requests` opens on the queue, which is where the "someone asked"
 * notification points.
 */
export default function SubscriptionsPage() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);

  const canManage = hasPermission(PERMISSIONS.SUBSCRIPTION_MANAGE);
  const canReview = hasPermission(PERMISSIONS.SUBSCRIPTION_APPROVE);
  const staff = canManage || canReview;

  const [tab, setTab] = useState("subscriptions");
  const [subscriptions, setSubscriptions] = useState([]);
  const [history, setHistory] = useState([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const notify = useCallback(
    (severity, summary, detail) =>
      toast.current?.show({ severity, summary, detail, life: severity === "error" ? 7000 : 4500 }),
    []
  );

  const load = useCallback(async () => {
    try {
      const [list, mine, waiting] = await Promise.all([
        fetchSubscriptions(),
        fetchMySubscriptions(),
        canReview ? fetchPendingCount() : 0,
      ]);
      setSubscriptions(list);
      setHistory(mine);
      setPending(waiting);
    } catch (err) {
      notify("error", "Could not load subscriptions", err.message);
    } finally {
      setLoading(false);
    }
  }, [canReview, notify]);

  useEffect(() => {
    load();
  }, [load]);

  // Read the tab from the address once the permission is known — a link to the
  // queue must not strand someone who cannot see it on an empty page.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (canReview && TABS.includes(wanted)) setTab(wanted);
  }, [canReview]);

  const show = (next) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "subscriptions") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="sub-page">
      <Toast ref={toast} />

      <div className="page-head">
        <div>
          <h1 className="page-title">Subscriptions</h1>
          <p className="page-subtitle">
            {canReview
              ? "Ask for a subscription, and decide other people’s requests: approve one for as long as you choose, or decline it."
              : "Ask for a subscription and someone will review it. Once approved it runs for a set period, and you can cancel it whenever you like."}
          </p>
        </div>
        {canManage && <Button label="New subscription" icon="pi pi-plus" onClick={() => setEditing({})} />}
      </div>

      {canReview && (
        <div className="sub-tabs" role="tablist" aria-label="Subscriptions">
          {[
            { key: "subscriptions", label: "Subscriptions", icon: "pi pi-id-card" },
            { key: "requests", label: "Requests", icon: "pi pi-inbox", count: pending },
            { key: "subscribers", label: "Subscribers", icon: "pi pi-users" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`sub-tab${tab === t.key ? " is-active" : ""}`}
              onClick={() => show(t.key)}
            >
              <i className={t.icon} aria-hidden="true" />
              {t.label}
              {t.count > 0 && (
                <span className="sub-tab__count" aria-label={`${t.count} waiting`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="sub-centre">
          <ProgressSpinner style={{ width: 36, height: 36 }} />
        </div>
      ) : tab === "requests" && canReview ? (
        <RequestsQueue onDecided={load} notify={notify} />
      ) : tab === "subscribers" && canReview ? (
        <Subscribers subscriptions={subscriptions} onChanged={load} notify={notify} />
      ) : (
        <SubscriptionList
          subscriptions={subscriptions}
          history={history}
          canManage={canManage}
          staff={staff}
          onEdit={setEditing}
          onOpenRequests={canReview ? () => show("requests") : undefined}
          reload={load}
          notify={notify}
        />
      )}

      <SubscriptionEditor
        subscription={editing}
        visible={Boolean(editing)}
        onHide={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
        notify={notify}
      />
    </div>
  );
}
