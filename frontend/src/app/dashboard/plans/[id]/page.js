"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Message } from "primereact/message";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/roles";
import { PLAN_STATUS, PLAN_STATUS_LABELS, PLAN_STATUS_SEVERITY } from "@/constants/planStatus";
import { getPlan } from "@/lib/plans";
import SeatGrid from "@/components/plans/SeatGrid";

export default function ViewPlanPage() {
  const { id } = useParams();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const toast = useRef(null);
  const gridRef = useRef(null);

  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlan(await getPlan(id));
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const exportPdf = async () => {
    if (!gridRef.current) return;
    setExporting(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(gridRef.current, { scale: 2, backgroundColor: "#ffffff" });
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? "l" : "p", unit: "pt", format: "a4" });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const ratio = Math.min((pw - 40) / canvas.width, (ph - 40) / canvas.height);
      const w = canvas.width * ratio;
      const h = canvas.height * ratio;
      pdf.text(`${plan.trainName?.name || ""} · Coach ${plan.coachNo}`, 20, 24);
      pdf.addImage(img, "PNG", (pw - w) / 2, 36, w, h);
      pdf.save(`seat-plan-${plan.trainName?.name || "plan"}-${plan.coachNo}.pdf`.replace(/\s+/g, "_"));
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Export failed", detail: err.message });
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: "center", padding: "3rem" }}><ProgressSpinner /></div>;
  }
  if (!plan) {
    return <div className="card"><p>Plan not found.</p></div>;
  }

  const editable = [PLAN_STATUS.DRAFT, PLAN_STATUS.PENDING, PLAN_STATUS.REJECTED].includes(plan.status);
  const meta = [
    ["Train", plan.trainName?.name],
    ["Coach no", plan.coachNo],
    ["Type", plan.coachType?.name],
    ["Class", plan.coachClass?.name],
    ["From", plan.layout?.fromStation || "—"],
    ["To", plan.layout?.toStation || "—"],
    ["Created by", plan.createdBy?.fullName],
  ];

  return (
    <div>
      <Toast ref={toast} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            {plan.trainName?.name} · Coach {plan.coachNo}{" "}
            <Tag value={PLAN_STATUS_LABELS[plan.status]} severity={PLAN_STATUS_SEVERITY[plan.status]} />
          </h1>
          <p className="page-subtitle">{plan.coachType?.name} · {plan.coachClass?.name}</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button label="Back" icon="pi pi-arrow-left" outlined severity="secondary" onClick={() => router.push("/dashboard/plans")} />
          <Button label="Export PDF" icon="pi pi-file-pdf" loading={exporting} onClick={exportPdf} />
          {hasPermission(PERMISSIONS.PLAN_UPDATE) && editable && (
            <Button label="Edit" icon="pi pi-pencil" onClick={() => router.push(`/dashboard/plans/${plan.id}/edit`)} />
          )}
        </div>
      </div>

      {plan.status === PLAN_STATUS.REJECTED && plan.rejectionReason && (
        <Message severity="error" text={`Rejected: ${plan.rejectionReason}`} style={{ width: "100%", justifyContent: "flex-start", marginBottom: "1rem" }} />
      )}

      <div className="card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
          {meta.map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: "0.75rem", color: "#9ca3af", fontWeight: 600 }}>{k}</div>
              <div style={{ fontWeight: 600 }}>{v || "—"}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <div ref={gridRef} style={{ display: "inline-block" }}>
          <SeatGrid layout={plan.layout} readOnly />
        </div>
      </div>
    </div>
  );
}
