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
import Platforms from "@/components/subscriptions/Platforms";
import {
  fetchMyDevices,
  fetchMySubscriptions,
  fetchPendingCount,
  fetchPlatforms,
  fetchSubscriptions,
} from "@/lib/subscriptions";
import "@/components/subscriptions/subscriptions.css";

/**
 * Subscriptions.
 *
 * Everyone signed in sees what there is and where they stand with each. The
 * two reviewer tabs — who is waiting, and who is subscribed — and the
 * manager's tab for platforms appear only for someone who can act on them;
 * with neither permission there are no tabs at all, just the list.
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
  const [offered, setOffered] = useState({ platforms: [], maxDevices: 10 });
  const [myDevices, setMyDevices] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const notify = useCallback(
    (severity, summary, detail) =>
      toast.current?.show({ severity, summary, detail, life: severity === "error" ? 7000 : 4500 }),
    []
  );

  const load = useCallback(async () => {
    try {
      const [list, mine, waiting, platforms, devices] = await Promise.all([
        fetchSubscriptions(),
        fetchMySubscriptions(),
        canReview ? fetchPendingCount() : 0,
        fetchPlatforms(),
        fetchMyDevices(),
      ]);
      setSubscriptions(list);
      setHistory(mine);
      setPending(waiting);
      setOffered(platforms);
      setMyDevices(devices);
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
    if ((canReview && ["requests", "subscribers"].includes(wanted)) || (canManage && wanted === "platforms")) setTab(wanted);
  }, [canReview, canManage]);

  // Staff are sent the switched-off platforms too; only the others can be asked for.
  const askable = offered.platforms.filter((p) => p.isActive);
  const tabs = [
    { key: "subscriptions", label: "Subscriptions", icon: "pi pi-id-card" },
    canReview && { key: "requests", label: "Requests", icon: "pi pi-inbox", count: pending },
    canReview && { key: "subscribers", label: "Subscribers", icon: "pi pi-users" },
    canManage && { key: "platforms", label: "Platforms", icon: "pi pi-desktop" },
  ].filter(Boolean);

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

      {staff && (
        <div className="sub-tabs" role="tablist" aria-label="Subscriptions">
          {tabs.map((t) => (
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
        <RequestsQueue platforms={askable} maxDevices={offered.maxDevices} onDecided={load} notify={notify} />
      ) : tab === "subscribers" && canReview ? (
        <Subscribers
          subscriptions={subscriptions}
          platforms={askable}
          maxDevices={offered.maxDevices}
          onChanged={load}
          notify={notify}
        />
      ) : tab === "platforms" && canManage ? (
        <Platforms platforms={offered.platforms} onChanged={load} notify={notify} />
      ) : (
        <SubscriptionList
          subscriptions={subscriptions}
          history={history}
          platforms={askable}
          maxDevices={offered.maxDevices}
          myDevices={myDevices}
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
