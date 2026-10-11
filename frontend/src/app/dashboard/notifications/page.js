"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { useNotifications } from "@/contexts/NotificationsContext";
import NotificationItem from "@/components/notifications/NotificationItem";
import { CATEGORY_META, dayGroup, fetchNotifications } from "@/lib/notifications";
import "@/components/notifications/notifications.css";

const PAGE = 25;
const GROUP_ORDER = ["Today", "Yesterday", "Earlier this week", "Older"];

/**
 * Every notification, newest first, a page at a time.
 *
 * The list is this page's own — it can go back further than the bell's few —
 * but every change goes through the same calls the bell uses, so reading one
 * here clears it from the badge, and anything that arrives while the page is
 * open is added at the top.
 */
export default function NotificationsPage() {
  const { unreadCount, version, open, markRead, markUnread, markAllRead, dismiss } = useNotifications();
  const toast = useRef(null);

  const [view, setView] = useState("all");
  const [category, setCategory] = useState(null);
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);

  const query = useMemo(
    () => ({ limit: PAGE, ...(view === "unread" ? { unread: 1 } : {}), ...(category ? { category } : {}) }),
    [view, category]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchNotifications(query);
      setItems(data.notifications);
      setCursor(data.nextCursor);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not load notifications", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  // Something changed elsewhere — an arrival, or the bell in another tab: take
  // the newest page again and keep whatever older pages were already loaded.
  const firstVersion = useRef(version);
  useEffect(() => {
    if (version === firstVersion.current) return;
    fetchNotifications(query)
      .then((data) => {
        setItems((current) => {
          const fresh = new Map(data.notifications.map((n) => [n.id, n]));
          const oldest = data.notifications.at(-1)?.id ?? Infinity;
          const older = current.filter((n) => n.id < oldest);
          return [...data.notifications, ...older.filter((n) => !fresh.has(n.id))];
        });
      })
      .catch(() => {});
  }, [version, query]);

  const loadMore = async () => {
    setMore(true);
    try {
      const data = await fetchNotifications({ ...query, before: cursor });
      setItems((current) => [...current, ...data.notifications]);
      setCursor(data.nextCursor);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not load more", detail: err.message });
    } finally {
      setMore(false);
    }
  };

  const patch = (id, change) => setItems((list) => list.map((n) => (n.id === id ? { ...n, ...change } : n)));
  const failed = (err) => toast.current?.show({ severity: "error", summary: "That did not save", detail: err.message });

  const toggleRead = (n) => {
    patch(n.id, { read: !n.read });
    (n.read ? markUnread(n.id) : markRead([n.id])).catch((err) => {
      patch(n.id, { read: n.read });
      failed(err);
    });
  };

  const remove = (n) => {
    setItems((list) => list.filter((x) => x.id !== n.id));
    dismiss(n.id).catch((err) => {
      load();
      failed(err);
    });
  };

  const readAll = () => {
    setItems((list) => (view === "unread" ? [] : list.map((n) => ({ ...n, read: true }))));
    markAllRead().catch((err) => {
      load();
      failed(err);
    });
  };

  const openOne = (n) => {
    if (!n.read) patch(n.id, { read: true });
    open(n);
  };

  const groups = useMemo(() => {
    const byGroup = new Map();
    for (const n of items) {
      const g = dayGroup(n.createdAt);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(n);
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => [g, byGroup.get(g)]);
  }, [items]);

  const filtered = view === "unread" || category;

  return (
    <div className="notif-page">
      <Toast ref={toast} />

      <div className="page-head">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">
            What happened to your bookings, returns and requests — and anything waiting on you. Kept here whether or
            not the email reached you.
          </p>
        </div>
        <Button label="Mark all as read" icon="pi pi-check-square" outlined onClick={readAll} disabled={!unreadCount} />
      </div>

      <section className="card">
        <div className="notif-toolbar">
          <div className="notif-filters" role="group" aria-label="Show">
            {[
              ["all", "All"],
              ["unread", `Unread${unreadCount ? ` (${unreadCount})` : ""}`],
            ].map(([key, text]) => (
              <button
                key={key}
                type="button"
                className={`notif-chip${view === key ? " is-active" : ""}`}
                aria-pressed={view === key}
                onClick={() => setView(key)}
              >
                {text}
              </button>
            ))}
          </div>
          <div className="notif-filters" role="group" aria-label="Kind">
            <button
              type="button"
              className={`notif-chip${!category ? " is-active" : ""}`}
              aria-pressed={!category}
              onClick={() => setCategory(null)}
            >
              Everything
            </button>
            {Object.entries(CATEGORY_META).map(([key, meta]) => (
              <button
                key={key}
                type="button"
                className={`notif-chip${category === key ? " is-active" : ""}`}
                aria-pressed={category === key}
                onClick={() => setCategory(key)}
              >
                <i className={meta.icon} aria-hidden="true" />
                {meta.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="notif-empty">
            <i className="pi pi-spin pi-spinner" aria-hidden="true" />
            <span>Loading…</span>
          </div>
        ) : items.length ? (
          <>
            {groups.map(([label, list]) => (
              <div key={label} className="notif-group">
                <div className="notif-group__label">{label}</div>
                <ul className="notif-list">
                  {list.map((n) => (
                    <NotificationItem key={n.id} n={n} onOpen={openOne} onToggleRead={toggleRead} onDismiss={remove} />
                  ))}
                </ul>
              </div>
            ))}
            {cursor && (
              <div className="notif-more">
                <Button label="Load older" icon="pi pi-angle-down" text onClick={loadMore} loading={more} />
              </div>
            )}
          </>
        ) : (
          <div className="notif-empty">
            <i className={`pi ${filtered ? "pi-filter-slash" : "pi-bell"}`} aria-hidden="true" />
            <strong>{view === "unread" && !category ? "You're all caught up" : filtered ? "Nothing here" : "No notifications yet"}</strong>
            <span>
              {filtered
                ? "Nothing matches what you have chosen. Try All, or another kind."
                : "When a booking is confirmed, a return pays out or something needs your decision, it shows up here."}
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
