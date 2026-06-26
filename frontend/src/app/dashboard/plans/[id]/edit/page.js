"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/roles";
import PlanEditor from "@/components/plans/PlanEditor";

export default function EditPlanPage() {
  const { id } = useParams();
  const { hasPermission } = useAuth();
  if (!hasPermission(PERMISSIONS.PLAN_UPDATE)) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Access denied</h2>
        <p style={{ color: "#6b7280" }}>You don&apos;t have permission to edit plans.</p>
      </div>
    );
  }
  return <PlanEditor planId={id} />;
}
