"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { Toast } from "primereact/toast";
import { confirmDialog, ConfirmDialog } from "primereact/confirmdialog";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/roles";
import { PLAN_STATUS, PLAN_STATUS_LABELS, PLAN_STATUS_SEVERITY } from "@/constants/planStatus";
import { listPlans, deletePlan, submitPlan } from "@/lib/plans";

const STATUS_FILTER = [
  { label: "All statuses", value: "" },
  ...Object.values(PLAN_STATUS).map((s) => ({ label: PLAN_STATUS_LABELS[s], value: s })),
];

export default function PlansPage() {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const toast = useRef(null);

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");

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

  const onSubmit = (row) => {
    confirmDialog({
      message: `Submit coach "${row.coachNo}" for approval?`,
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
      message: `Delete plan for coach "${row.coachNo}"? This cannot be undone.`,
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

  const trainBody = (row) => row.trainName?.name || "—";
  const refBody = (field) => (row) => row[field]?.name || "—";
  const updatedBody = (row) => new Date(row.updatedAt).toLocaleString();

  const actionBody = (row) => {
    const editable = [PLAN_STATUS.DRAFT, PLAN_STATUS.PENDING, PLAN_STATUS.REJECTED].includes(row.status);
    const submittable = [PLAN_STATUS.DRAFT, PLAN_STATUS.REJECTED].includes(row.status);
    return (
      <div style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
        <Button icon="pi pi-eye" rounded text tooltip="View" onClick={() => router.push(`/dashboard/plans/${row.id}`)} />
        {canUpdate && editable && (
          <Button icon="pi pi-pencil" rounded text tooltip="Edit" onClick={() => router.push(`/dashboard/plans/${row.id}/edit`)} />
        )}
        {canUpdate && submittable && (
          <Button icon="pi pi-send" rounded text severity="success" tooltip="Submit for approval" onClick={() => onSubmit(row)} />
        )}
        {canDelete && (
          <Button icon="pi pi-trash" rounded text severity="danger" tooltip="Delete" onClick={() => onDelete(row)} />
        )}
      </div>
    );
  };

  return (
    <div>
      <Toast ref={toast} />
      <ConfirmDialog />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="page-title">Seat Plans</h1>
          <p className="page-subtitle">Browse, build, and manage coach seat layouts.</p>
        </div>
        {canCreate && (
          <Button label="New plan" icon="pi pi-plus" onClick={() => router.push("/dashboard/plans/new")} />
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem", gap: "1rem" }}>
          <Dropdown value={status} options={STATUS_FILTER} onChange={(e) => setStatus(e.value)} style={{ minWidth: 180 }} />
          <Button icon="pi pi-refresh" label="Refresh" outlined onClick={() => load(status)} />
        </div>

        <DataTable value={plans} loading={loading} dataKey="id" emptyMessage="No plans found" stripedRows paginator rows={10}>
          <Column field="trainName.name" header="Train" body={trainBody} sortable />
          <Column field="coachNo" header="Coach No" sortable />
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
