import api from "@/lib/api";

/**
 * People: the profile window anyone can open from a name, and restricting an
 * account so it cannot sign in.
 */

/**
 * One account as the profile window shows it to whoever is asking. Anyone
 * signed in gets the name and roles; the account itself and staff who can view
 * users get the rest (`limited` says which).
 */
export async function fetchProfile(id) {
  const { data } = await api.get(`/users/${id}/profile`);
  return data.profile;
}

export async function restrictAccount(id, reason) {
  const { data } = await api.post(`/users/${id}/restrict`, { reason });
  return data.restriction;
}

export async function liftRestriction(id, note) {
  const { data } = await api.post(`/users/${id}/lift-restriction`, { note: note || undefined });
  return data;
}

/** Several at once. Each is decided on its own: `{ done, results: [{ userId, done, error? }] }`. */
export async function restrictAccounts(userIds, reason) {
  const { data } = await api.post("/users/restrict", { userIds, reason });
  return data;
}

export async function liftRestrictions(userIds, note) {
  const { data } = await api.post("/users/lift-restriction", { userIds, note: note || undefined });
  return data;
}

/** "RU" for "Rahim Uddin". */
export function initials(name) {
  return (
    String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join("") || "?"
  );
}

/** "9 Oct 2026, 14:05" in Dhaka time, or "" for nothing. */
export function when(value, { time = true } = {}) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Asia/Dhaka",
  });
}

/** A YYYY-MM-DD date as "6 Jun 1990". */
export function longDay(day) {
  if (!day) return "";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
