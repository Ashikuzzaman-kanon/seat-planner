"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import PersonLink from "@/components/people/PersonLink";
import { Message } from "primereact/message";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { PLAN_STATUS, PLAN_STATUS_LABELS, PLAN_STATUS_SEVERITY } from "@/constants/planStatus";
import { getPlan, idToEdit, REVISION_WORDS } from "@/lib/plans";
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
      pdf.text(title, 20, 24);
      pdf.addImage(img, "PNG", (pw - w) / 2, 36, w, h);
      pdf.save(`seat-plan-${plan.trainName?.name || "draft"}-${plan.coachNo || plan.id}.pdf`.replace(/\s+/g, "_"));
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

  // An approved plan is edited too — through a copy, so it keeps working meanwhile.
  const edit = async () => {
    try {
      router.push(`/dashboard/plans/${await idToEdit(plan)}/edit`);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not open it for editing", detail: err.message });
    }
  };
  const title = [plan.trainName?.name, plan.coachNo ? `Coach ${plan.coachNo}` : null].filter(Boolean).join(" · ") ||
    "Untitled draft";
  const meta = [
    ["Train", plan.trainName?.name],
    ["Coach no", plan.coachNo],
    ["Type", plan.coachType?.name],
    ["Class", plan.coachClass?.name],
    ["From", plan.layout?.fromStation || "—"],
    ["To", plan.layout?.toStation || "—"],
    ["Created by", plan.createdBy ? <PersonLink id={plan.createdBy.id} name={plan.createdBy.fullName} /> : null],
  ];

  return (
    <div className="plan-page">
      <Toast ref={toast} />

      <div className="page-head">
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            {title}{" "}
            <Tag value={PLAN_STATUS_LABELS[plan.status]} severity={PLAN_STATUS_SEVERITY[plan.status]} />
          </h1>
          <p className="page-subtitle">
            {[plan.coachType?.name, plan.coachClass?.name].filter(Boolean).join(" · ") ||
              "No coach type or class yet"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Button label="Back" icon="pi pi-arrow-left" outlined severity="secondary" onClick={() => router.push("/dashboard/plans")} />
          <Button label="Export PDF" icon="pi pi-file-pdf" loading={exporting} onClick={exportPdf} />
          {hasPermission(PERMISSIONS.PLAN_UPDATE) && (
            <Button label="Edit" icon="pi pi-pencil" onClick={edit} />
          )}
        </div>
      </div>

      {plan.revisionOfId && (
        <div className="plan-revision-note" role="note">
          <i className="pi pi-copy" aria-hidden="true" />
          <span>
            These are changes to an approved plan. The plan keeps being used as it is until they are approved; then it
            takes them, and departures generated from then on carry them.
          </span>
          <Button label="The plan in service" size="small" text onClick={() => router.push(`/dashboard/plans/${plan.revisionOfId}`)} />
        </div>
      )}

      {plan.revision && (
        <div className="plan-revision-note" role="note">
          <i className="pi pi-pencil" aria-hidden="true" />
          <span>
            {REVISION_WORDS[plan.revision.status] || "Changes are open"}
            {plan.revision.status === PLAN_STATUS.REJECTED && plan.revision.rejectionReason ? `: “${plan.revision.rejectionReason}”` : "."}{" "}
            This plan stays in use as it is until they are approved.
          </span>
          <Button label="Open the changes" size="small" text onClick={() => router.push(`/dashboard/plans/${plan.revision.id}`)} />
        </div>
      )}

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
