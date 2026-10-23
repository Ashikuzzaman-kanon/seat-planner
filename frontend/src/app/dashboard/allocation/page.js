"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProgressSpinner } from "primereact/progressspinner";
import { Toast } from "primereact/toast";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { fetchAllocation, fetchAllocationMeta } from "@/lib/allocation";
import DataPanel from "@/components/allocation/DataPanel";
import PairDialog from "@/components/allocation/PairDialog";
import Explorer from "@/components/allocation/Explorer";
import PublicVisits from "@/components/allocation/PublicVisits";
import SourceNotice, { lastUpdatedOf } from "@/components/allocation/SourceNotice";
import "@/components/allocation/allocation.css";

/**
 * Seat Allocation in the app: which station pairs Bangladesh Railway actually
 * sets seats aside for, train by train and class by class (see Explorer).
 *
 * Staff (allocation:view) see where the data came from and when, and — with
 * allocation:manage — upload it, correct it, and see how the public page is
 * used. While it is open to the public, everyone signed in sees it too, with
 * the same notice as the public page instead of the staff's details.
 *
 * The railway's own data, uploaded here and kept apart from the site's trains,
 * stations and bookings.
 */
export default function AllocationPage() {
  const { hasPermission, isPublic } = useAuth();
  const staff = hasPermission(PERMISSIONS.ALLOCATION_VIEW);
  const canView = staff || isPublic("seat-allocation");
  const canManage = hasPermission(PERMISSIONS.ALLOCATION_MANAGE);
  const toast = useRef(null);

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

  if (!canView) {
    return (
      <div className="card">
        <h1 className="page-title">Seat Allocation</h1>
        <p className="page-subtitle">Your account cannot see the seat allocation.</p>
      </div>
    );
  }

  const empty = meta && meta.totals.pairs === 0;

  return (
    <div className="al">
      <Toast ref={toast} />
      <div className="al-head">
        <h1 className="page-title">Seat Allocation</h1>
        <p className="page-subtitle">
          Which station pairs Bangladesh Railway actually sets seats aside for — train by train, class by class. The
          railway&apos;s own data, kept apart from this site&apos;s trains and bookings.
        </p>
      </div>

      {meta &&
        (meta.staff ? (
          <DataPanel meta={meta} canManage={canManage} filters={filters} onChanged={loadMeta} toast={toast} />
        ) : (
          <SourceNotice lastUpdated={lastUpdatedOf(meta)} />
        ))}
      {canManage && <PublicVisits />}

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
