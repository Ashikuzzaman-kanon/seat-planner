"use client";

import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/roles";

export default function ApprovalsPage() {
  const { hasPermission } = useAuth();

  // Defense in depth: the nav already hides this, but guard the page too.
  if (!hasPermission(PERMISSIONS.PLAN_APPROVE)) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Access denied</h2>
        <p style={{ color: "#6b7280" }}>
          You need approval permissions to view this page.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Pending Approvals</h1>
      <p className="page-subtitle">
        Review and approve seat plans submitted by planners.
      </p>

      <div className="card">
        <p style={{ margin: 0, color: "#6b7280" }}>
          When the plan module is added, plans created by <strong>planners</strong>{" "}
          arrive here as <em>pending</em>. Admins and super admins can approve or
          reject them; approved plans then become visible to all users. Plans
          created directly by an admin or super admin are auto-approved.
        </p>
      </div>
    </div>
  );
}
