"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Toast } from "primereact/toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchNotificationSummary,
  fetchNotifications,
  markNotificationsRead,
  markAllNotificationsRead,
  markNotificationUnread,
  dismissNotification,
  categoryMeta,
} from "@/lib/notifications";

/**
 * The inbox, kept current for every signed-in page.
 *
 * ## How it stays current without a socket
 *
 * Every 30 seconds a visible tab asks for two numbers — how many are unread,
 * and the newest id. Only when the newest id moves is the list itself fetched,
 * and anything newer than what was already shown is announced in a toast.
 * A hidden tab does not ask at all; it catches up the moment it is looked at.
 *
 * Polling, not WebSockets or server-sent events, because the API sits behind
 * a proxy that does not carry long-lived connections, and on a host that
 * sleeps when idle — a socket from every open tab would keep it awake all day.
 * Nothing here needs to arrive faster than half a minute.
 *
 * ## Failures
 *
 * A failed poll waits longer each time, up to five minutes, and says nothing:
 * the server may be asleep, and the next successful poll puts it right.
 *
 * ## Tabs
 *
 * Reading or dismissing in one tab tells the others, so the count on a second
 * tab does not lag behind the first.
 */

const NotificationsContext = createContext(null);

const POLL_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const RECENT = 15;
const MAX_TOASTS = 3;
const CHANNEL = "sp-notifications";

export function NotificationsProvider({ children }) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useRef(null);

  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // Bumped when the inbox changed in a way a page showing it should reload for.
  const [version, setVersion] = useState(0);

  const latestId = useRef(0);
  const unreadRef = useRef(0);
  const failures = useRef(0);
  const timer = useRef(null);
  const channel = useRef(null);
  const alive = useRef(false);
  // Set below; read only when a toast is clicked, after render.
  const openNotification = useRef(null);
  const userId = user?.id ?? null;

  const applySummary = useCallback(({ unreadCount: count }) => {
    unreadRef.current = count;
    setUnreadCount(count);
  }, []);

  const tell = useCallback(() => channel.current?.postMessage({ type: "changed" }), []);

  /** Toast what arrived since the last look — newest last, at most three. */
  const announce = useCallback(
    (fresh) => {
      const shown = fresh.slice(0, MAX_TOASTS).reverse();
      for (const n of shown) {
        toast.current?.show({
          severity: n.tone === "danger" ? "error" : n.tone === "warning" ? "warn" : n.tone === "success" ? "success" : "info",
          life: 8000,
          content: () => (
            <button
              type="button"
              className={`notif-toast tone-${n.tone}`}
              onClick={() => {
                toast.current?.clear();
                openNotification.current?.(n);
              }}
            >
              <i className={categoryMeta(n.category).icon} aria-hidden="true" />
              <span>
                <strong>{n.title}</strong>
                {n.body && <small>{n.body}</small>}
              </span>
            </button>
          ),
        });
      }
      if (fresh.length > MAX_TOASTS) {
        toast.current?.show({
          severity: "info",
          life: 8000,
          summary: `${fresh.length - MAX_TOASTS} more new notification${fresh.length - MAX_TOASTS === 1 ? "" : "s"}`,
          detail: "Open the bell to see them all.",
        });
      }
    },
    []
  );

  /** The newest few, and the counts — and an announcement of anything new, when asked. */
  const loadRecent = useCallback(
    async ({ announceNew = false } = {}) => {
      const data = await fetchNotifications({ limit: RECENT });
      if (!alive.current) return;
      const seen = latestId.current;
      setItems(data.notifications);
      applySummary(data);
      setLoaded(true);
      if (announceNew && seen && data.latestId > seen) {
        announce(data.notifications.filter((n) => n.id > seen && !n.read));
        setVersion((v) => v + 1);
      }
      latestId.current = Math.max(latestId.current, data.latestId);
    },
    [announce, applySummary]
  );

  const schedule = useCallback((run) => {
    clearTimeout(timer.current);
    const delay = failures.current ? Math.min(POLL_MS * 2 ** failures.current, MAX_BACKOFF_MS) : POLL_MS;
    timer.current = setTimeout(run, delay);
  }, []);

  const poll = useCallback(async () => {
    if (!alive.current) return;
    if (typeof document !== "undefined" && document.hidden) return; // resumes on visibility
    try {
      const summary = await fetchNotificationSummary();
      failures.current = 0;
      if (summary.latestId !== latestId.current || summary.unreadCount !== unreadRef.current) {
        await loadRecent({ announceNew: true });
      }
    } catch {
      failures.current = Math.min(failures.current + 1, 6);
    }
    if (alive.current) schedule(poll);
  }, [loadRecent, schedule]);

  // Start when someone is signed in; stop when they are not.
  useEffect(() => {
    if (!userId) return undefined;
    alive.current = true;
    failures.current = 0;
    latestId.current = 0;
    loadRecent()
      .catch(() => {})
      .finally(() => alive.current && schedule(poll));

    const onVisible = () => {
      if (document.hidden) {
        clearTimeout(timer.current);
      } else {
        failures.current = 0;
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel(CHANNEL);
      channel.current.onmessage = () => loadRecent().catch(() => {});
    }

    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      channel.current?.close();
      channel.current = null;
      setItems([]);
      setUnreadCount(0);
      setLoaded(false);
    };
  }, [userId, loadRecent, poll, schedule]);

  // The count in the tab title, kept through navigation.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const bare = document.title.replace(/^\(\d+\+?\)\s*/, "");
    document.title = unreadCount ? `(${unreadCount > 99 ? "99+" : unreadCount}) ${bare}` : bare;
  }, [unreadCount, pathname]);

  /* ---------------- Changing things, optimistically ---------------- */

  const settle = useCallback(
    async (request) => {
      try {
        applySummary(await request);
        tell();
        setVersion((v) => v + 1);
      } catch (err) {
        // Put the truth back rather than leave the screen guessing.
        loadRecent().catch(() => {});
        throw err;
      }
    },
    [applySummary, loadRecent, tell]
  );

  const markRead = useCallback(
    async (ids) => {
      const wanted = new Set(ids);
      const newlyRead = items.filter((n) => wanted.has(n.id) && !n.read).length;
      setItems((list) => list.map((n) => (wanted.has(n.id) ? { ...n, read: true } : n)));
      if (newlyRead) setUnreadCount((c) => Math.max(c - newlyRead, 0));
      await settle(markNotificationsRead([...wanted]));
    },
    [items, settle]
  );

  const markAllRead = useCallback(async () => {
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    await settle(markAllNotificationsRead());
  }, [settle]);

  const markUnread = useCallback(
    async (id) => {
      setItems((list) => list.map((n) => (n.id === id ? { ...n, read: false } : n)));
      await settle(markNotificationUnread(id));
    },
    [settle]
  );

  const dismiss = useCallback(
    async (id) => {
      setItems((list) => list.filter((n) => n.id !== id));
      await settle(dismissNotification(id));
    },
    [settle]
  );

  /** Go where it points, and count it as read. */
  openNotification.current = (n) => {
    if (!n.read) markRead([n.id]).catch(() => {});
    if (n.link) router.push(n.link);
  };
  const open = useCallback((n) => openNotification.current(n), []);

  const value = useMemo(
    () => ({
      items,
      unreadCount,
      loaded,
      version,
      refresh: () => loadRecent(),
      markRead,
      markAllRead,
      markUnread,
      dismiss,
      open,
    }),
    [items, unreadCount, loaded, version, loadRecent, markRead, markAllRead, markUnread, dismiss, open]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <Toast ref={toast} position="bottom-right" className="notif-toasts" />
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error("useNotifications needs a NotificationsProvider");
  return value;
}
