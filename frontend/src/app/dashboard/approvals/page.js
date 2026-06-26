"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputTextarea } from "primereact/inputtextarea";
import { Toast } from "primereact/toast";
import { confirmDialog, ConfirmDialog } from "primereact/confirmdialog";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/roles";
import { listPlans, approvePlan, rejectPlan } from "@/lib/plans";
import { PLAN_STATUS } from "@/constants/planStatus";

export default function ApprovalsPage() {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const toast = useRef(null);

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const canApprove = hasPermission(PERMISSIONS.PLAN_APPROVE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlans(await listPlans({ status: PLAN_STATUS.PENDING }));
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canApprove) load();
    else setLoading(false);
  }, [canApprove, load]);

  const onApprove = (row) => {
    confirmDialog({
      message: `Approve coach "${row.coachNo}" of ${row.trainName?.name}?`,
      header: "Approve plan",
      icon: "pi pi-check",
      acceptClassName: "p-button-success",
      accept: async () => {
        try {
          await approvePlan(row.id);
          toast.current?.show({ severity: "success", summary: "Approved" });
          setPlans((prev) => prev.filter((p) => p.id !== row.id));
        } catch (err) {
          toast.current?.show({ severity: "error", summary: "Approve failed", detail: err.message });
        }
      },
    });
  };

  const submitReject = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await rejectPlan(rejectTarget.id, reason.trim());
      toast.current?.show({ severity: "success", summary: "Rejected" });
      setPlans((prev) => prev.filter((p) => p.id !== rejectTarget.id));
      setRejectTarget(null);
      setReason("");
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Reject failed", detail: err.message });
    } finally {
      setBusy(false);
    }
  };

  if (!canApprove) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Access denied</h2>
        <p style={{ color: "#6b7280" }}>You need approval permissions to view this page.</p>
      </div>
    );
  }

  const actionBody = (row) => (
    <div style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
      <Button icon="pi pi-eye" rounded text tooltip="View" onClick={() => router.push(`/dashboard/plans/${row.id}`)} />
      <Button icon="pi pi-check" rounded text severity="success" tooltip="Approve" onClick={() => onApprove(row)} />
      <Button icon="pi pi-times" rounded text severity="danger" tooltip="Reject" onClick={() => { setRejectTarget(row); setReason(""); }} />
    </div>
  );

  return (
    <div>
      <Toast ref={toast} />
      <ConfirmDialog />

      <h1 className="page-title">Pending Approvals</h1>
      <p className="page-subtitle">Review and approve seat plans submitted by planners.</p>

      <div className="card">
        <DataTable value={plans} loading={loading} dataKey="id" emptyMessage="Nothing awaiting approval" stripedRows paginator rows={10}>
          <Column field="trainName.name" header="Train" body={(r) => r.trainName?.name || "—"} sortable />
          <Column field="coachNo" header="Coach No" sortable />
          <Column header="Type" body={(r) => r.coachType?.name || "—"} />
          <Column header="Class" body={(r) => r.coachClass?.name || "—"} />
          <Column header="Submitted by" body={(r) => r.createdBy?.fullName || "—"} />
          <Column header="" body={actionBody} style={{ width: "10rem" }} />
        </DataTable>
      </div>

      <Dialog header="Reject plan" visible={!!rejectTarget} style={{ width: "30rem" }} onHide={() => setRejectTarget(null)}>
        <p style={{ marginTop: 0, color: "#6b7280" }}>
          Give the planner a reason so they can fix and resubmit.
        </p>
        <InputTextarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} autoResize style={{ width: "100%" }} placeholder="Reason for rejection" />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
          <Button label="Cancel" outlined severity="secondary" onClick={() => setRejectTarget(null)} />
          <Button label="Reject" severity="danger" loading={busy} disabled={!reason.trim()} onClick={submitReject} />
        </div>
      </Dialog>
    </div>
  );
}
