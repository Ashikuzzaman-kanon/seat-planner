"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProgressSpinner } from "primereact/progressspinner";
import { Toast } from "primereact/toast";
import { TabView, TabPanel } from "primereact/tabview";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { fetchAllocation, fetchAllocationMeta, fetchAllocationRequestsToday } from "@/lib/allocation";
import DataPanel from "@/components/allocation/DataPanel";
import PairDialog from "@/components/allocation/PairDialog";
import Explorer from "@/components/allocation/Explorer";
import Requests from "@/components/allocation/Requests";
import SourceNotice, { lastUpdatedOf } from "@/components/allocation/SourceNotice";
import "@/components/allocation/allocation.css";

/**
 * Seat Allocation in the app: which station pairs Bangladesh Railway actually
 * sets seats aside for, train by train and class by class (see Explorer).
 *
 * Staff (allocation:view) see where the data came from and when, and — with
 * allocation:manage — upload it and correct it. While it is open to the
 * public, everyone signed in sees it too, with the same notice as the public
 * page instead of the staff's details.
 *
 * With allocation:requests, a second tab: who looks at it and for what — on
 * the public page and in the app — with today's count on the tab. Its address
 * ends in #requests.
 *
 * The railway's own data, uploaded here and kept apart from the site's trains,
 * stations and bookings.
 */
export default function AllocationPage() {
  const { hasPermission, isPublic } = useAuth();
  const staff = hasPermission(PERMISSIONS.ALLOCATION_VIEW);
  const canView = staff || isPublic("seat-allocation");
  const canManage = hasPermission(PERMISSIONS.ALLOCATION_MANAGE);
  const canRequests = hasPermission(PERMISSIONS.ALLOCATION_REQUESTS);
  const toast = useRef(null);

  // The tabs: Allocation, Requests. Only Requests for whoever sees nothing else.
  const both = canView && canRequests;
  // Which tab is known once the page is in the browser (its address may say
  // #requests). The Allocation tab is built only once shown: its first list
  // is a search, recorded as one, and opening Requests is not.
  const [tab, setTab] = useState(null);
  const [allocationShown, setAllocationShown] = useState(false);
  const [today, setToday] = useState(null);
  useEffect(() => {
    setTab(both && window.location.hash === "#requests" ? 1 : 0);
  }, [both]);
  useEffect(() => {
    if (tab === 0) setAllocationShown(true);
  }, [tab]);
  const chooseTab = (index) => {
    setTab(index);
    window.history.replaceState(null, "", index === 1 ? "#requests" : window.location.pathname);
  };
  const loadToday = useCallback(async () => {
    try {
      setToday(await fetchAllocationRequestsToday());
    } catch {
      /* the tab says no number, nothing worse */
    }
  }, []);
  useEffect(() => {
    if (canRequests) loadToday();
  }, [canRequests, loadToday]);

  const [meta, setMeta] = useState(null);
  const [editing, setEditing] = useState(null);
  const [filters, setFilters] = useState({});

  const loadMeta = useCallback(async () => {
    try {
      setMeta(await fetchAllocationMeta());
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Seat allocation", detail: err.message });
    }
  }, []);

  useEffect(() => {
    if (canView) loadMeta();
  }, [canView, loadMeta]);

  const saved = async (message) => {
    toast.current?.show({ severity: "success", summary: message });
    setEditing(null);
    await loadMeta();
  };

  const showError = useCallback(
    (err) => toast.current?.show({ severity: "error", summary: "Seat allocation", detail: err.message }),
    []
  );

  if (!canView && !canRequests) {
    return (
      <div className="card">
        <h1 className="page-title">Seat Allocation</h1>
        <p className="page-subtitle">Your account cannot see the seat allocation.</p>
      </div>
    );
  }

  const empty = meta && meta.totals.pairs === 0;
  const head = (
    <div className="al-head">
      <h1 className="page-title">Seat Allocation</h1>
      <p className="page-subtitle">
        Which station pairs Bangladesh Railway actually sets seats aside for — train by train, class by class. The
        railway&apos;s own data, kept apart from this site&apos;s trains and bookings.
      </p>
    </div>
  );

  if (!canView) {
    return (
      <div className="al">
        {head}
        <Requests active onLoaded={loadToday} />
      </div>
    );
  }

  const allocation = (
    <>
      {meta &&
        (meta.staff ? (
          <DataPanel meta={meta} canManage={canManage} filters={filters} onChanged={loadMeta} toast={toast} />
        ) : (
          <SourceNotice lastUpdated={lastUpdatedOf(meta)} />
        ))}

      {!meta ? (
        <div className="al-loading">
          <ProgressSpinner style={{ width: 40, height: 40 }} strokeWidth="4" />
        </div>
      ) : empty ? (
        <section className="card al-empty">
          <i className="pi pi-chart-bar" aria-hidden="true" />
          <h2>No allocation data yet</h2>
          {canManage ? (
            <p>
              Upload the train routes first — <code>train-stoppages.json</code> — so pairs show in travel order. Then
              upload the census file. Each is shown before anything changes.
            </p>
          ) : (
            <p>Nothing has been uploaded yet. Whoever manages the seat allocation can upload it.</p>
          )}
        </section>
      ) : (
        <Explorer
          meta={meta}
          fetchList={fetchAllocation}
          canManage={canManage}
          onEdit={setEditing}
          onError={showError}
          onFilters={setFilters}
        />
      )}
    </>
  );

  return (
    <div className="al">
      <Toast ref={toast} />
      {head}

      {both ? (
        <TabView
          className="al-tabs"
          activeIndex={tab ?? 0}
          onTabChange={(e) => chooseTab(e.index)}
          renderActiveOnly={false}
        >
          <TabPanel header="Allocation" leftIcon="pi pi-chart-bar mr-2">
            <div className="al-tab">{allocationShown && allocation}</div>
          </TabPanel>
          <TabPanel
            header={today ? `Requests · ${today.searches.toLocaleString("en-GB")} today` : "Requests"}
            leftIcon="pi pi-users mr-2"
          >
            <Requests active={tab === 1} onLoaded={loadToday} />
          </TabPanel>
        </TabView>
      ) : (
        allocation
      )}

      <PairDialog
        pair={editing}
        knownClasses={meta?.classes || []}
        onHide={() => setEditing(null)}
        onSaved={saved}
        toast={toast}
      />
    </div>
  );
}
