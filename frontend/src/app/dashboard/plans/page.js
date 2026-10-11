"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DataTable from "@/components/ui/DataTable";
import When from "@/components/ui/When";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";
import Select from "@/components/ui/Select";
import SearchBox from "@/components/ui/SearchBox";
import { Toast } from "primereact/toast";
import { confirmDialog, ConfirmDialog } from "primereact/confirmdialog";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { PLAN_STATUS, PLAN_STATUS_LABELS, PLAN_STATUS_SEVERITY } from "@/constants/planStatus";
import { listPlans, deletePlan, submitPlan } from "@/lib/plans";

import { TIP } from "@/components/ui/tip";
const STATUS_FILTER = [
  { label: "All statuses", value: "" },
  ...Object.values(PLAN_STATUS).map((s) => ({ label: PLAN_STATUS_LABELS[s], value: s })),
];

const DASH = "—";

/**
 * Everything about a plan that a person might reasonably type to find it,
 * flattened into one lowercase string. Searching this rather than named fields
 * means new columns become searchable by being added here, and the user never
 * has to know which field their term lives in.
 */
function searchIndex(row) {
  return [
    row.coachNo,
    row.trainName?.name,
    row.coachType?.name,
    row.coachClass?.name,
    row.status,
    PLAN_STATUS_LABELS[row.status],
    row.createdBy?.fullName,
    row.createdBy?.email,
    row.approvedBy?.fullName,
    row.rejectionReason,
    new Date(row.updatedAt).toLocaleString(),
    new Date(row.createdAt).toLocaleDateString(),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function PlansPage() {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const toast = useRef(null);

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const canCreate = hasPermission(PERMISSIONS.PLAN_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.PLAN_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.PLAN_DELETE);

  const load = useCallback(async (statusValue) => {
    setLoading(true);
    try {
      setPlans(await listPlans(statusValue ? { status: statusValue } : {}));
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(status);
  }, [load, status]);

  // Built once per result set, not once per keystroke.
  const indexed = useMemo(
    () => plans.map((row) => ({ row, haystack: searchIndex(row) })),
    [plans]
  );

  /**
   * Multiple words all have to match, in any field and any order — so
   * "ekota ac" finds the AC coaches on Ekota without caring which column
   * each word came from.
   */
  const filtered = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return plans;
    return indexed.filter(({ haystack }) => terms.every((t) => haystack.includes(t))).map((e) => e.row);
  }, [indexed, plans, search]);

  const onSubmit = (row) => {
    confirmDialog({
      message: `Submit ${row.coachNo ? `coach "${row.coachNo}"` : "this untitled plan"} for approval?`,
      header: "Submit plan",
      icon: "pi pi-send",
      accept: async () => {
        try {
          await submitPlan(row.id);
          toast.current?.show({ severity: "success", summary: "Submitted" });
          load(status);
        } catch (err) {
          toast.current?.show({ severity: "error", summary: "Submit failed", detail: err.message });
        }
      },
    });
  };

  const onDelete = (row) => {
    confirmDialog({
      message: `Delete ${row.coachNo ? `the plan for coach "${row.coachNo}"` : "this untitled plan"}? This cannot be undone.`,
      header: "Delete plan",
      icon: "pi pi-exclamation-triangle",
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          await deletePlan(row.id);
          toast.current?.show({ severity: "success", summary: "Deleted" });
          setPlans((prev) => prev.filter((p) => p.id !== row.id));
        } catch (err) {
          toast.current?.show({ severity: "error", summary: "Delete failed", detail: err.message });
        }
      },
    });
  };

  const statusBody = (row) => (
    <Tag value={PLAN_STATUS_LABELS[row.status]} severity={PLAN_STATUS_SEVERITY[row.status]} />
  );

  // A draft may not have these yet; say so rather than leave a gap that looks like a fault.
  const trainBody = (row) =>
    row.trainName?.name || <span className="plans-unset">{row.status === PLAN_STATUS.DRAFT ? "Not assigned" : DASH}</span>;
  const coachNoBody = (row) => row.coachNo || <span className="plans-unset">Untitled</span>;
  const refBody = (field) => (row) => row[field]?.name || DASH;
  const updatedBody = (row) => <When value={row.updatedAt} />;

  const actionBody = (row) => {
    const editable = [PLAN_STATUS.DRAFT, PLAN_STATUS.PENDING, PLAN_STATUS.REJECTED].includes(row.status);
    const submittable = [PLAN_STATUS.DRAFT, PLAN_STATUS.REJECTED].includes(row.status);
    return (
      <div style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
        <Button aria-label="View" tooltipOptions={TIP} icon="pi pi-eye" rounded text tooltip="View" onClick={() => router.push(`/dashboard/plans/${row.id}`)} />
        {canUpdate && editable && (
          <Button aria-label="Edit" tooltipOptions={TIP} icon="pi pi-pencil" rounded text tooltip="Edit" onClick={() => router.push(`/dashboard/plans/${row.id}/edit`)} />
        )}
        {canUpdate && submittable && (
          <Button aria-label="Submit for approval" tooltipOptions={TIP} icon="pi pi-send" rounded text severity="success" tooltip="Submit for approval" onClick={() => onSubmit(row)} />
        )}
        {canDelete && (
          <Button aria-label="Delete" tooltipOptions={TIP} icon="pi pi-trash" rounded text severity="danger" tooltip="Delete" onClick={() => onDelete(row)} />
        )}
      </div>
    );
  };

  const searching = search.trim().length > 0;

  return (
    <div>
      <Toast ref={toast} />
      <ConfirmDialog />

      <div className="page-head">
        <div>
          <h1 className="page-title">Seat Plans</h1>
          <p className="page-subtitle">Browse, build, and manage coach seat layouts.</p>
        </div>
        {canCreate && (
          <Button label="New plan" icon="pi pi-plus" onClick={() => router.push("/dashboard/plans/new")} />
        )}
      </div>

      <div className="card">
        <div className="plans-toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search train, coach, type, class, status, author…"
            ariaLabel="Search seat plans"
          />

          <Select
            value={status}
            options={STATUS_FILTER}
            onChange={(e) => setStatus(e.value)}
            style={{ minWidth: 180 }}
          />
          <Button icon="pi pi-refresh" label="Refresh" outlined onClick={() => load(status)} />
        </div>

        {searching && (
          <p className="plans-result-count">
            {filtered.length === 0
              ? `No plans match “${search.trim()}”`
              : `${filtered.length} of ${plans.length} plans match “${search.trim()}”`}
          </p>
        )}

        <DataTable
          value={filtered}
          loading={loading}
          dataKey="id"
          emptyMessage={searching ? "No plans match your search" : "No plans found"}
          stripedRows
          paginator
          rows={10}
        >
          <Column field="trainName.name" header="Train" body={trainBody} sortable />
          <Column field="coachNo" header="Coach No" body={coachNoBody} sortable />
          <Column header="Type" body={refBody("coachType")} />
          <Column header="Class" body={refBody("coachClass")} />
          <Column field="status" header="Status" body={statusBody} sortable />
          <Column header="Updated" body={updatedBody} sortable />
          <Column header="" body={actionBody} style={{ width: "12rem" }} />
        </DataTable>
      </div>
    </div>
  );
}
