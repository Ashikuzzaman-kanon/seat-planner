"use client";

import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/roles";
import { Button } from "primereact/button";

export default function PlansPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSIONS.PLAN_CREATE);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h1 className="page-title">Seat Plans</h1>
          <p className="page-subtitle">Browse approved coach seat layouts.</p>
        </div>
        {canCreate && (
          <Button label="New plan" icon="pi pi-plus" disabled tooltip="Coming soon" />
        )}
      </div>

      <div className="card">
        <p style={{ margin: 0, color: "#6b7280" }}>
          The seat-plan builder and viewer will live here. This page is already
          role-gated: the <strong>New plan</strong> action only appears for
          planners, admins, and super admins. Share the plan creation / view UI
          details and we&apos;ll wire it up against the backend plan module.
        </p>
      </div>
    </div>
  );
}
