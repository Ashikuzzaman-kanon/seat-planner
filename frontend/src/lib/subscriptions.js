import api from "@/lib/api";

/**
 * Subscriptions: what can be subscribed to, your own standing with each, and —
 * for whoever reviews them — everyone's requests and subscriptions, and the
 * devices each is used on.
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

/** Ask to be subscribed, on so many devices of each platform: `{ windows: 2, android: 1 }`. */
export async function requestSubscription(id, devices) {
  const { data } = await api.post(`/subscriptions/${id}/requests`, { devices });
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

/**
 * `period` is `{ days }` or `{ lastDay }` — see PeriodPicker. `devices` only
 * when the reviewer changed the counts; left out, it is approved as asked.
 */
export async function approveRequest(id, { period, note, devices }) {
  const { data } = await api.post(`/subscriptions/members/${id}/approve`, {
    ...period,
    note: note || undefined,
    devices: devices || undefined,
  });
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

/** Change a running subscription: `{ days }` or `{ lastDay }`, `{ devices }`, or both. */
export async function amendSubscription(id, changes) {
  const { data } = await api.patch(`/subscriptions/members/${id}`, changes);
  return data.subscription;
}

/* ---------------- Platforms and devices ---------------- */

/** `{ platforms, maxDevices }`. Staff are sent the switched-off platforms too. */
export async function fetchPlatforms() {
  const { data } = await api.get("/subscriptions/platforms");
  return data;
}

export async function createPlatform({ value, name }) {
  const { data } = await api.post("/subscriptions/platforms", { value, name });
  return data.platform;
}

export async function updatePlatform(id, changes) {
  const { data } = await api.patch(`/subscriptions/platforms/${id}`, changes);
  return data.platform;
}

export async function deletePlatform(id) {
  await api.delete(`/subscriptions/platforms/${id}`);
}

/** Your own devices and how many places are used: `{ devices, usage }`. */
export async function fetchMyDevices() {
  const { data } = await api.get("/subscriptions/devices/mine");
  return data;
}

/** An account's devices, for staff: `{ user, devices, usage, refusals }`. */
export async function fetchUserDevices(userId) {
  const { data } = await api.get(`/subscriptions/users/${userId}/devices`);
  return data;
}

/** `{ note }`, `{ isBlocked }`, or both. */
export async function updateDevice(id, changes) {
  const { data } = await api.patch(`/subscriptions/devices/${id}`, changes);
  return data.device;
}

export async function deleteDevice(id) {
  await api.delete(`/subscriptions/devices/${id}`);
}

/* ---------------- App versions ---------------- */

/**
 * One subscription's version rules: `{ subscription, platforms }`, each platform
 * with its rules, blocked versions and the versions its subscribers use.
 */
export async function fetchVersionPolicies(subscriptionId) {
  const { data } = await api.get(`/subscriptions/${subscriptionId}/versions`);
  return data;
}

/** `{ versionRequired }`, `{ minVersion }` (empty or null clears it), or both. */
export async function setVersionPolicy(subscriptionId, platformId, changes) {
  const { data } = await api.patch(`/subscriptions/${subscriptionId}/versions/${platformId}`, changes);
  return data.policy;
}

export async function blockVersion(subscriptionId, platformId, { version, note }) {
  const { data } = await api.post(`/subscriptions/${subscriptionId}/versions/${platformId}/blocked`, { version, note });
  return data.blocked;
}

export async function unblockVersion(subscriptionId, platformId, blockedId) {
  await api.delete(`/subscriptions/${subscriptionId}/versions/${platformId}/blocked/${blockedId}`);
}

/*
 * The server's version arithmetic (backend utils/appVersion), so the screen
 * can say which versions in use a rule would turn away before it is saved:
 * one to four numbers joined by dots, an optional leading "v", compared number
 * by number with a missing one counting as 0.
 */
const VERSION = /^v?(\d{1,6}(?:\.\d{1,6}){0,3})$/i;

/** "v1.4.02" → "1.4.2", or null if it is not a version. */
export function cleanVersion(input) {
  const match = String(input ?? "").trim().match(VERSION);
  return match ? match[1].split(".").map((n) => String(Number(n))).join(".") : null;
}

/** -1, 0 or 1. */
export function compareVersions(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
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

/* ---------------- Device counts ----------------
 *
 * The API takes counts keyed by a platform's value — `{ windows: 2, android: 1 }`
 * — and gives a subscription's back as a list with each platform's name.
 */

/** "2 Windows, 1 Android" from a subscription's `devices`. */
export function describeDevices(devices) {
  const parts = (devices || []).filter((d) => d.limit > 0).map((d) => `${d.limit} ${d.name}`);
  return parts.length ? parts.join(", ") : "no devices";
}

/** A subscription's `devices` as the counts the API takes, for these platforms. */
export const countsOf = (devices, platforms) =>
  Object.fromEntries(platforms.map((p) => [p.value, (devices || []).find((d) => d.value === p.value)?.limit ?? 0]));

/** One of each: what asking starts on. */
export const startingCounts = (platforms) => Object.fromEntries(platforms.map((p) => [p.value, 1]));

export const totalOf = (counts) => Object.values(counts || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);

export const sameCounts = (a, b, platforms) =>
  platforms.every((p) => (Number(a?.[p.value]) || 0) === (Number(b?.[p.value]) || 0));

/**
 * Why a check was answered "not valid", in words. Staff read these; the caller
 * of the check is never told.
 */
export const REFUSAL_WORDS = {
  no_device: "No device id was sent",
  bad_device: "The device id sent is not a usable one",
  unknown_platform: "The platform sent does not exist",
  platform_off: "The platform is switched off",
  blocked: "The device is blocked",
  limit_reached: "A new device, and every place was taken",
  beyond_limit: "It has a place, but beyond what the subscription allows",
  app_version: "Every subscription it may use turns away its app's version",
};

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
