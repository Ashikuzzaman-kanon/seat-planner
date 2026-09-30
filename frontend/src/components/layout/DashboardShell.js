"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Menu } from "primereact/menu";
import { ProgressSpinner } from "primereact/progressspinner";
import { Button } from "primereact/button";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { roleLabel } from "@/constants/roles";
import { visibleGroups, isActive, locate } from "./nav";
import "./dashboard.css";

/** Two letters to stand for a person when there is no photo. */
function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * The frame around every signed-in page.
 *
 * ## What changed, and why
 *
 * - **The navigation is grouped** into Travel, Operations and Administration.
 *   Twenty links in one list meant a passenger scrolled past "Audit Log" to
 *   find their bookings, and on a laptop the last few fell off the screen.
 * - **Who you are moved into a menu** behind an avatar. The header used to hold
 *   a name, an email, a solid red role tag and a large Logout button; on a
 *   phone that stacked into three rows before any content appeared.
 * - **The header says where you are** — group and page — which the flat list
 *   never did.
 *
 * On a phone the sidebar is a drawer (see dashboard.css), and everything else
 * here is the same component, so the two cannot drift apart.
 */
export default function DashboardShell({ children }) {
  const { user, roles, loading, unreachable, refresh, logout, hasPermission } = useAuth();
  const [retrying, setRetrying] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const account = useRef(null);

  // Redirect unauthenticated users to login once auth state is known — but
  // not when the server simply did not answer: that is not being signed out.
  useEffect(() => {
    if (!loading && !user && !unreachable) router.replace("/login");
  }, [loading, user, unreachable, router]);

  const groups = useMemo(() => visibleGroups(hasPermission), [hasPermission]);
  const here = locate(pathname);

  /*
   * The sidebar on a small screen is a drawer. An icon rail was tried first and
   * was the worst of both: a fifth of a 400px screen, and icons with no labels.
   */
  const [menuOpen, setMenuOpen] = useState(false);

  // Close it on navigation, or the drawer stays over the page you just opened.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Escape closes it, like every other layer on the page.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (!loading && !user && unreachable) {
    const retry = async () => {
      setRetrying(true);
      try {
        await refresh();
      } finally {
        setRetrying(false);
      }
    };
    return (
      <div className="dash-loading">
        <div className="dash-unreachable" role="alert">
          <i className="pi pi-cloud" aria-hidden="true" />
          <h1>Can&apos;t reach the server</h1>
          <p>{unreachable}</p>
          <p className="dash-unreachable__note">You are still signed in — nothing was lost.</p>
          <Button label="Try again" icon="pi pi-refresh" onClick={retry} loading={retrying} />
        </div>
      </div>
    );
  }

  if (loading || !user) {
    return (
      <div className="dash-loading">
        <ProgressSpinner style={{ width: 40, height: 40 }} strokeWidth="4" />
      </div>
    );
  }

  const signOut = async () => {
    await logout();
    router.replace("/login");
  };

  const primaryRole = roles[0] ? roleLabel(roles[0].name) : "No role";
  const canBook = hasPermission(PERMISSIONS.BOOKING_CREATE);

  const accountItems = [
    {
      template: () => (
        <div className="acct-card">
          <span className="avatar avatar--lg" aria-hidden="true">
            {initials(user.fullName)}
          </span>
          <div className="acct-card__who">
            <strong>{user.fullName}</strong>
            <span>{user.email}</span>
            <div className="acct-card__roles">
              {roles.length
                ? roles.map((r) => <em key={r.id}>{roleLabel(r.name)}</em>)
                : <em>No roles</em>}
            </div>
          </div>
        </div>
      ),
    },
    { separator: true },
    { label: "My profile", icon: "pi pi-user", command: () => router.push("/dashboard/profile") },
    ...(canBook
      ? [{ label: "Wallet", icon: "pi pi-wallet", command: () => router.push("/dashboard/wallet") }]
      : []),
    { separator: true },
    { label: "Sign out", icon: "pi pi-sign-out", className: "acct-signout", command: signOut },
  ];

  return (
    <div className={`dash-layout${menuOpen ? " menu-open" : ""}`}>
      {/* Tapping away closes the drawer — the gesture everybody tries first. */}
      <div className="dash-scrim" onClick={() => setMenuOpen(false)} aria-hidden={!menuOpen} />

      <aside className="dash-sidebar" id="dash-nav" aria-label="Main navigation">
        <div className="dash-brand">
          <Link href="/dashboard" className="brand">
            <span className="brand__mark" aria-hidden="true">
              <i className="pi pi-ticket" />
            </span>
            <span className="brand__text">
              <strong>Seat Planner</strong>
              <small>Railway ticketing</small>
            </span>
          </Link>
          <button
            type="button"
            className="dash-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
            title="Close menu"
          >
            <i className="pi pi-times" aria-hidden="true" />
          </button>
        </div>

        <nav className="dash-nav">
          {groups.map((group) => (
            <div key={group.key} className="nav-group">
              <div className="nav-group__label">{group.label}</div>
              {group.items.map((item) => {
                const active = isActive(item.href, pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`dash-nav-item${active ? " active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <i className={item.icon} aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="dash-me">
          <span className="avatar" aria-hidden="true">
            {initials(user.fullName)}
          </span>
          <div className="dash-me__who">
            <strong>{user.fullName}</strong>
            <span>{primaryRole}</span>
          </div>
          <button type="button" className="dash-me__out" onClick={signOut} title="Sign out" aria-label="Sign out">
            <i className="pi pi-sign-out" aria-hidden="true" />
          </button>
        </div>
      </aside>

      <div className="dash-main">
        <header className="dash-header">
          <button
            type="button"
            className="dash-burger"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            title="Open menu"
            aria-expanded={menuOpen}
            aria-controls="dash-nav"
          >
            <i className="pi pi-bars" aria-hidden="true" />
          </button>

          {/* Where you are. The phone shows the brand instead — there is no
              room for both, and the page title says the rest. */}
          <div className="dash-crumbs">
            {here.group && <span className="dash-crumbs__group">{here.group.label}</span>}
            {here.group && <i className="pi pi-angle-right" aria-hidden="true" />}
            <span className="dash-crumbs__page">{here.item?.label || "Seat Planner"}</span>
          </div>

          <Link href="/dashboard" className="brand brand--compact">
            <span className="brand__mark" aria-hidden="true">
              <i className="pi pi-ticket" />
            </span>
            <strong>Seat Planner</strong>
          </Link>

          <div className="dash-header__actions">
            {canBook && !isActive("/dashboard/book", pathname) && (
              <Link href="/dashboard/book" className="dash-cta" title="Book a ticket">
                <i className="pi pi-plus" aria-hidden="true" />
                <span>Book a ticket</span>
              </Link>
            )}

            <Menu model={accountItems} popup ref={account} className="acct-menu" popupAlignment="right" />
            <button
              type="button"
              className="dash-account"
              onClick={(e) => account.current?.toggle(e)}
              aria-haspopup="true"
              aria-label="Your account"
              title="Your account"
            >
              <span className="avatar" aria-hidden="true">
                {initials(user.fullName)}
              </span>
              <span className="dash-account__name">{user.fullName.split(" ")[0]}</span>
              <i className="pi pi-chevron-down" aria-hidden="true" />
            </button>
          </div>
        </header>

        <main className="dash-content">{children}</main>
      </div>
    </div>
  );
}
