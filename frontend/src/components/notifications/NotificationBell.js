"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { OverlayPanel } from "primereact/overlaypanel";
import { useNotifications } from "@/contexts/NotificationsContext";
import NotificationItem from "./NotificationItem";
import "./notifications.css";

/**
 * The bell in the header: an unread count, and the newest notifications a
 * click away. Opening it marks nothing read — seeing that something is there
 * is not the same as having dealt with it. Opening one, or "Mark all as
 * read", is.
 */
export default function NotificationBell() {
  const { items, unreadCount, loaded, open, markRead, markUnread, markAllRead, dismiss } = useNotifications();
  const panel = useRef(null);
  const [view, setView] = useState("all");

  const shown = useMemo(() => (view === "unread" ? items.filter((n) => !n.read) : items), [items, view]);
  const label = unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications";

  const openOne = (n) => {
    panel.current?.hide();
    open(n);
  };
  const toggleRead = (n) => (n.read ? markUnread(n.id) : markRead([n.id])).catch(() => {});

  return (
    <>
      <button
        type="button"
        className={`notif-bell${unreadCount ? " has-unread" : ""}`}
        onClick={(e) => panel.current?.toggle(e)}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
      >
        <i className="pi pi-bell" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="notif-bell__badge" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <OverlayPanel ref={panel} className="notif-panel" aria-label="Notifications" closeOnEscape dismissable>
        <div className="notif-panel__head">
          <div className="notif-panel__title">
            <strong>Notifications</strong>
            {unreadCount > 0 && <span className="notif-count">{unreadCount} new</span>}
          </div>
          <button
            type="button"
            className="notif-link"
            onClick={() => markAllRead().catch(() => {})}
            disabled={!unreadCount}
          >
            Mark all as read
          </button>
        </div>

        <div className="notif-tabs" role="tablist" aria-label="Show">
          {[
            ["all", "All"],
            ["unread", "Unread"],
          ].map(([key, text]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              className={`notif-tab${view === key ? " is-active" : ""}`}
              onClick={() => setView(key)}
            >
              {text}
            </button>
          ))}
        </div>

        <div className="notif-panel__body">
          {!loaded ? (
            <div className="notif-empty">
              <i className="pi pi-spin pi-spinner" aria-hidden="true" />
              <span>Loading…</span>
            </div>
          ) : shown.length ? (
            <ul className="notif-list">
              {shown.map((n) => (
                <NotificationItem
                  key={n.id}
                  n={n}
                  compact
                  onOpen={openOne}
                  onToggleRead={toggleRead}
                  onDismiss={(x) => dismiss(x.id).catch(() => {})}
                />
              ))}
            </ul>
          ) : (
            <div className="notif-empty">
              <i className={`pi ${view === "unread" ? "pi-check-circle" : "pi-bell"}`} aria-hidden="true" />
              <strong>{view === "unread" ? "You're all caught up" : "Nothing yet"}</strong>
              <span>
                {view === "unread"
                  ? "Nothing new since you last looked."
                  : "Bookings, returns and anything that needs your attention will show up here."}
              </span>
            </div>
          )}
        </div>

        <Link href="/dashboard/notifications" className="notif-panel__foot" onClick={() => panel.current?.hide()}>
          See all notifications <i className="pi pi-arrow-right" aria-hidden="true" />
        </Link>
      </OverlayPanel>
    </>
  );
}
