import api from "@/lib/api";

/**
 * Subscriptions: what can be subscribed to, your own standing with each, and —
 * for whoever reviews them — everyone's requests and subscriptions.
 */

export async function fetchSubscriptions() {
  const { data } = await api.get("/subscriptions");
  return data.subscriptions;
}

export async function fetchMySubscriptions() {
  const { data } = await api.get("/subscriptions/mine");
  return data.subscriptions;
}

export async function createSubscription({ name, description, code }) {
  const { data } = await api.post("/subscriptions", { name, description: description || null, code: code || undefined });
  return data.subscription;
}

export async function updateSubscription(id, changes) {
  const { data } = await api.patch(`/subscriptions/${id}`, changes);
  return data.subscription;
}

export async function deleteSubscription(id) {
  await api.delete(`/subscriptions/${id}`);
}

/** Ask to be subscribed. */
export async function requestSubscription(id) {
  const { data } = await api.post(`/subscriptions/${id}/requests`);
  return data.subscription;
}

/* ---------------- Reviewing ---------------- */

export async function fetchMembers({ status, subscriptionId, search, page = 1, limit = 25 } = {}) {
  const { data } = await api.get("/subscriptions/members", {
    params: { status: status || undefined, subscriptionId: subscriptionId || undefined, search: search || undefined, page, limit },
  });
  return data;
}

export async function fetchPendingCount() {
  const { data } = await api.get("/subscriptions/members/pending-count");
  return data.pending;
}

/** `period` is `{ days }` or `{ lastDay }` — see PeriodPicker. */
export async function approveRequest(id, { period, note }) {
  const { data } = await api.post(`/subscriptions/members/${id}/approve`, { ...period, note: note || undefined });
  return data.subscription;
}

export async function declineRequest(id, { note } = {}) {
  const { data } = await api.post(`/subscriptions/members/${id}/decline`, { note: note || undefined });
  return data.subscription;
}

/** End your own subscription or withdraw your request; a reviewer may end anyone's. */
export async function cancelSubscription(id, { reason } = {}) {
  const { data } = await api.post(`/subscriptions/members/${id}/cancel`, { reason: reason || undefined });
  return data.subscription;
}

export async function extendSubscription(id, period) {
  const { data } = await api.patch(`/subscriptions/members/${id}`, period);
  return data.subscription;
}

/* ---------------- Dates ----------------
 *
 * A subscription runs through the end of its last day in Dhaka, so the days
 * here are Dhaka's calendar days as YYYY-MM-DD strings — never Date objects in
 * the browser's own timezone, which is where an off-by-one day comes from.
 */

const DHAKA_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dhaka",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const todayInDhaka = (now = new Date()) => DHAKA_DAY.format(now);

export function addDays(day, days) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** "9 Nov 2026" from a YYYY-MM-DD day. */
export function longDate(day) {
  if (!day) return "";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A day picked in a calendar widget (a local Date) as YYYY-MM-DD. */
export function dayOfPicked(date) {
  if (!date) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A YYYY-MM-DD day as the local Date a calendar widget shows. */
export const pickedOfDay = (day) => (day ? new Date(`${day}T00:00:00`) : null);

/* ---------------- Words ---------------- */

export const STATUS_META = {
  pending: { label: "Waiting for approval", severity: "warning", icon: "pi pi-hourglass" },
  active: { label: "Active", severity: "success", icon: "pi pi-check-circle" },
  declined: { label: "Declined", severity: "danger", icon: "pi pi-times-circle" },
  cancelled: { label: "Cancelled", severity: "secondary", icon: "pi pi-ban" },
  expired: { label: "Ended", severity: "secondary", icon: "pi pi-calendar-times" },
};

export const statusMeta = (status) => STATUS_META[status] || { label: status, severity: "info", icon: "pi pi-circle" };

/** One line saying where a person stands with a subscription. */
export function standing(mine) {
  if (!mine) return "Not subscribed";
  switch (mine.status) {
    case "pending":
      return "Requested — waiting for approval";
    case "active":
      return `Active until ${longDate(mine.lastDay)}`;
    case "declined":
      return "Your request was declined";
    case "cancelled":
      return mine.startsAt ? "Cancelled" : "Request withdrawn";
    case "expired":
      return `Ended ${longDate(mine.lastDay)}`;
    default:
      return mine.status;
  }
}
