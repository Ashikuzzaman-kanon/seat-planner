"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import api from "@/lib/api";
import { fetchWallet, fetchBookings } from "@/lib/booking";
import OpenCheckouts from "@/components/booking/OpenCheckouts";
import MyWaitlist from "@/components/booking/MyWaitlist";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { roleLabel } from "@/constants/roles";
import { visibleGroups } from "@/components/layout/nav";
import "./home.css";

/** Today's date where the railway runs, which is the only "today" a ticket knows. */
const todayInDhaka = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Dhaka" }).format(new Date())
  );
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const prettyDate = (iso) =>
  iso
    ? new Date(`${iso}T00:00:00+06:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "Asia/Dhaka",
      })
    : "";

/**
 * The first page after signing in.
 *
 * ## What it is for
 *
 * It used to be a list of permission names — forty-six bright pills — which
 * answered a question almost nobody arrives asking. The two things people
 * actually come here for are *my next journey* and *the thing I do for work*,
 * so those lead, and the permission list is still here, folded away, for the
 * rarer moment somebody needs to know exactly what they may do.
 *
 * ## What it shows whom
 *
 * A passenger sees their next journey, their wallet and a way to book. Staff
 * see their tools, drawn from the same navigation definition as the sidebar so
 * the two cannot describe different things. Somebody who is both sees both.
 */
export default function DashboardHome() {
  const { user, roles, permissions, hasPermission } = useAuth();
  const canBook = hasPermission(PERMISSIONS.BOOKING_CREATE);

  const [catalogue, setCatalogue] = useState({});
  const [wallet, setWallet] = useState(null);
  const [bookings, setBookings] = useState(null);

  // Labels come from the API catalogue, so a permission added on the backend
  // describes itself without a frontend change.
  useEffect(() => {
    api
      .get("/meta/permissions")
      .then(({ data }) => setCatalogue(Object.fromEntries(data.permissions.map((p) => [p.key, p]))))
      .catch(() => setCatalogue({}));
  }, []);

  useEffect(() => {
    if (!canBook) return;
    fetchWallet().then(setWallet).catch(() => setWallet(null));
    fetchBookings({ page: 1 })
      .then((data) => setBookings(data.bookings || []))
      .catch(() => setBookings([]));
  }, [canBook]);

  const upcoming = useMemo(() => {
    if (!bookings) return null;
    const today = todayInDhaka();
    return bookings
      .filter((b) => b.status === "confirmed" && (b.boardingDate || b.trip?.departureDate) >= today)
      .sort((a, b) =>
        (a.boardingDate || a.trip?.departureDate).localeCompare(b.boardingDate || b.trip?.departureDate)
      );
  }, [bookings]);

  const next = upcoming?.[0] || null;

  // Everything outside Travel is somebody's work tool.
  const tools = useMemo(
    () => visibleGroups(hasPermission).filter((g) => g.key !== "travel"),
    [hasPermission]
  );

  const grouped = useMemo(
    () =>
      permissions.reduce((acc, key) => {
        const group = catalogue[key]?.group || "Other";
        (acc[group] ||= []).push(key);
        return acc;
      }, {}),
    [permissions, catalogue]
  );

  const first = user.fullName.split(" ")[0];

  return (
    <div className="home">
      {/* ---------------- Hello ---------------- */}
      <section className="home-hero">
        <div className="home-hero__text">
          <p className="home-hero__eyebrow">{greeting()}</p>
          <h1>{first}, where to next?</h1>
          <p className="home-hero__lead">
            {canBook
              ? "Seats are sold stretch by stretch, so a train that looks full end to end often still has room on yours."
              : "Your tools are below. Everything you do here is recorded in the audit log."}
          </p>
          {canBook && (
            <div className="home-hero__actions">
              <Link href="/dashboard/book" className="home-btn home-btn--light">
                <i className="pi pi-ticket" aria-hidden="true" /> Book a ticket
              </Link>
              <Link href="/dashboard/bookings" className="home-btn home-btn--ghost">
                My bookings <i className="pi pi-arrow-right" aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
        {/* A drawn railway, not a stock image: rails converging on a horizon. */}
        <div className="home-hero__art" aria-hidden="true">
          <span className="rail rail--l" />
          <span className="rail rail--r" />
          <span className="sleepers" />
          <i className="pi pi-ticket home-hero__ticket" />
        </div>
      </section>

      {/* Seats held but unpaid, with the clock running. Nothing else on this
          page is time-critical, so these go above all of it. */}
      {canBook && <OpenCheckouts />}
      {hasPermission(PERMISSIONS.WAITLIST_JOIN) && <MyWaitlist />}

      {/* ---------------- Travelling ---------------- */}
      {canBook && (
        <section className="home-grid">
          <Link href={next ? `/dashboard/bookings` : "/dashboard/book"} className="home-card home-next">
            <div className="home-card__head">
              <span className="home-card__icon home-card__icon--brand">
                <i className="pi pi-map-marker" aria-hidden="true" />
              </span>
              <span className="home-card__label">Next journey</span>
            </div>
            {bookings === null ? (
              <div className="home-skeleton" />
            ) : next ? (
              <>
                <div className="home-next__route">
                  <strong>{next.fromStation?.name}</strong>
                  <i className="pi pi-arrow-right" aria-hidden="true" />
                  <strong>{next.toStation?.name}</strong>
                </div>
                <div className="home-next__meta">
                  <span>
                    <i className="pi pi-calendar" aria-hidden="true" />
                    {prettyDate(next.boardingDate || next.trip?.departureDate)}
                  </span>
                  <span>
                    <i className="pi pi-send" aria-hidden="true" />
                    {next.trip?.train?.name}
                  </span>
                  <span>
                    <i className="pi pi-users" aria-hidden="true" />
                    {next.ticketCount} ticket{next.ticketCount === 1 ? "" : "s"}
                  </span>
                </div>
                <code className="home-next__ref">{next.reference}</code>
              </>
            ) : (
              <p className="home-empty">
                Nothing booked yet. <span>Find a train →</span>
              </p>
            )}
          </Link>

          <Link href="/dashboard/wallet" className="home-card home-stat">
            <div className="home-card__head">
              <span className="home-card__icon home-card__icon--green">
                <i className="pi pi-wallet" aria-hidden="true" />
              </span>
              <span className="home-card__label">Wallet</span>
            </div>
            <div className="home-stat__value">
              {wallet ? <>৳ {wallet.balanceFormatted}</> : <span className="home-skeleton home-skeleton--sm" />}
            </div>
            <span className="home-stat__hint">Pays for a ticket in one click</span>
          </Link>

          <Link href="/dashboard/bookings" className="home-card home-stat">
            <div className="home-card__head">
              <span className="home-card__icon home-card__icon--violet">
                <i className="pi pi-calendar-clock" aria-hidden="true" />
              </span>
              <span className="home-card__label">Upcoming</span>
            </div>
            <div className="home-stat__value">
              {upcoming ? upcoming.length : <span className="home-skeleton home-skeleton--sm" />}
            </div>
            <span className="home-stat__hint">
              {upcoming && upcoming.length === 1 ? "journey booked" : "journeys booked"}
            </span>
          </Link>
        </section>
      )}

      {/* ---------------- Work ---------------- */}
      {tools.map((group) => (
        <section key={group.key} className="home-section">
          <h2 className="home-section__title">{group.label}</h2>
          <div className="home-tools">
            {group.items.map((item) => (
              <Link key={item.href} href={item.href} className="home-tool">
                <span className="home-tool__icon">
                  <i className={item.icon} aria-hidden="true" />
                </span>
                <span className="home-tool__text">
                  <strong>{item.label}</strong>
                  {item.blurb && <small>{item.blurb}</small>}
                </span>
                <i className="pi pi-angle-right home-tool__go" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      ))}

      {/* ---------------- Access ----------------
          Still here, folded away: useful when somebody needs to know exactly
          what they may do, not worth a screenful every time they sign in. */}
      <details className="home-access">
        <summary>
          <span className="home-access__icon">
            <i className="pi pi-shield" aria-hidden="true" />
          </span>
          <span className="home-access__text">
            <strong>Your access</strong>
            <small>
              {roles.length ? roles.map((r) => roleLabel(r.name)).join(", ") : "No roles"} ·{" "}
              {permissions.length} permission{permissions.length === 1 ? "" : "s"}
            </small>
          </span>
          <i className="pi pi-chevron-down home-access__chev" aria-hidden="true" />
        </summary>
        <div className="home-access__body">
          {permissions.length === 0 && (
            <p className="home-empty">No permissions yet. An administrator needs to assign you a role.</p>
          )}
          {Object.entries(grouped).map(([group, keys]) => (
            <div key={group} className="home-access__group">
              <div className="home-access__group-name">{group}</div>
              <div className="home-access__chips">
                {keys.map((key) => (
                  <span key={key} className="home-chip" title={catalogue[key]?.description || key}>
                    {catalogue[key]?.label || key}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
