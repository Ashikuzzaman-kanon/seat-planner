"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS, ROLE_LABELS } from "@/constants/roles";
import { Tag } from "primereact/tag";

const PERMISSION_LABELS = {
  [PERMISSIONS.PLAN_VIEW]: "View approved plans",
  [PERMISSIONS.PLAN_CREATE]: "Create plans",
  [PERMISSIONS.PLAN_UPDATE]: "Update plans",
  [PERMISSIONS.PLAN_DELETE]: "Delete plans",
  [PERMISSIONS.PLAN_APPROVE]: "Approve plans",
  [PERMISSIONS.USER_VIEW]: "View users",
  [PERMISSIONS.USER_MANAGE_ROLES]: "Manage user roles",
};

export default function DashboardHome() {
  const { user, permissions, hasPermission } = useAuth();

  return (
    <div>
      <h1 className="page-title">Welcome, {user.fullName.split(" ")[0]}</h1>
      <p className="page-subtitle">
        You are signed in as <strong>{ROLE_LABELS[user.role]}</strong>.
      </p>

      <div className="stat-grid" style={{ marginBottom: "1.5rem" }}>
        <div className="stat-card">
          <div className="stat-label">Your role</div>
          <div className="stat-value">{ROLE_LABELS[user.role]}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Permissions</div>
          <div className="stat-value">{permissions.length}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ marginTop: 0 }}>What you can do</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {permissions.map((p) => (
            <Tag key={p} value={PERMISSION_LABELS[p] || p} severity="info" />
          ))}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Quick links</h3>
        <ul style={{ lineHeight: 2 }}>
          <li>
            <Link href="/dashboard/plans">Browse seat plans</Link>
          </li>
          {hasPermission(PERMISSIONS.PLAN_APPROVE) && (
            <li>
              <Link href="/dashboard/approvals">Review pending approvals</Link>
            </li>
          )}
          {hasPermission(PERMISSIONS.USER_MANAGE_ROLES) && (
            <li>
              <Link href="/dashboard/users">Manage users &amp; roles</Link>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
