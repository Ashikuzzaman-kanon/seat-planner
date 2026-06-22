"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { ProgressSpinner } from "primereact/progressspinner";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS, ROLE_LABELS, ROLE_SEVERITY } from "@/constants/roles";
import "./dashboard.css";

const NAV = [
  { href: "/dashboard", label: "Home", icon: "pi pi-home" },
  { href: "/dashboard/plans", label: "Seat Plans", icon: "pi pi-th-large" },
  {
    href: "/dashboard/approvals",
    label: "Approvals",
    icon: "pi pi-check-square",
    permission: PERMISSIONS.PLAN_APPROVE,
  },
  {
    href: "/dashboard/users",
    label: "Users & Roles",
    icon: "pi pi-users",
    permission: PERMISSIONS.USER_MANAGE_ROLES,
  },
];

export default function DashboardShell({ children }) {
  const { user, loading, logout, hasPermission } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Redirect unauthenticated users to login once auth state is known.
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const navItems = useMemo(
    () => NAV.filter((item) => !item.permission || hasPermission(item.permission)),
    [hasPermission]
  );

  if (loading || !user) {
    return (
      <div className="auth-shell">
        <ProgressSpinner />
      </div>
    );
  }

  return (
    <div className="dash-layout">
      <aside className="dash-sidebar">
        <div className="dash-brand">
          <i className="pi pi-ticket" /> Seat Planner
        </div>
        <nav className="dash-nav">
          {navItems.map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`dash-nav-item ${active ? "active" : ""}`}
              >
                <i className={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="dash-main">
        <header className="dash-header">
          <div className="dash-user">
            <div>
              <div className="dash-user-name">{user.fullName}</div>
              <div className="dash-user-email">{user.email}</div>
            </div>
            <Tag
              value={ROLE_LABELS[user.role] || user.role}
              severity={ROLE_SEVERITY[user.role]}
            />
          </div>
          <Button
            label="Logout"
            icon="pi pi-sign-out"
            severity="secondary"
            outlined
            size="small"
            onClick={() => {
              logout();
              router.replace("/login");
            }}
          />
        </header>

        <main className="dash-content">{children}</main>
      </div>
    </div>
  );
}
