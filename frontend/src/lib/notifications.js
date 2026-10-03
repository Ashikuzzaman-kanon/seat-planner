import api from "@/lib/api";

/**
 * The signed-in person's in-app notifications. Every call is about their own
 * inbox; there is no way to ask about anyone else's.
 */

export async function fetchNotificationSummary() {
  const { data } = await api.get("/notifications/summary");
  return data;
}

export async function fetchNotifications(params = {}) {
  const { data } = await api.get("/notifications", { params });
  return data;
}

export async function markNotificationsRead(ids) {
  const { data } = await api.post("/notifications/read", { ids });
  return data;
}

export async function markAllNotificationsRead() {
  const { data } = await api.post("/notifications/read", { all: true });
  return data;
}

export async function markNotificationUnread(id) {
  const { data } = await api.post(`/notifications/${id}/unread`);
  return data;
}

export async function dismissNotification(id) {
  const { data } = await api.delete(`/notifications/${id}`);
  return data;
}

/** What each kind of notification is called, and the icon that stands for it. */
export const CATEGORY_META = {
  booking: { label: "Bookings", icon: "pi pi-ticket" },
  refund: { label: "Returns", icon: "pi pi-replay" },
  waitlist: { label: "Waitlist", icon: "pi pi-hourglass" },
  account: { label: "Your account", icon: "pi pi-user" },
  approval: { label: "Requests", icon: "pi pi-inbox" },
  plan: { label: "Seat plans", icon: "pi pi-th-large" },
  system: { label: "System", icon: "pi pi-server" },
};

export const categoryMeta = (category) => CATEGORY_META[category] || CATEGORY_META.system;

const DAY = 86_400_000;

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "just now", "4 min ago", "2 h ago", "Yesterday, 14:05", "Mon, 14:05", "12 Sep". */
export function timeAgo(value, now = new Date()) {
  const at = new Date(value);
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days === 0) return `${hours} h ago`;
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${at.toLocaleDateString("en-GB", { weekday: "short" })}, ${time}`;
  return at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Which heading a notification sits under in the full list. */
export function dayGroup(value, now = new Date()) {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(value))) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Earlier this week";
  return "Older";
}
