import api from "@/lib/api";

/**
 * Returns `{ events, pagination, actions, available }`. `available` is false
 * when the document store is unreachable — the endpoint degrades to an empty
 * page rather than failing, and the UI says so.
 */
export async function fetchAuditEvents({ page = 1, limit = 25, action, actorId, excludeTests } = {}) {
  const { data } = await api.get("/audit", {
    params: {
      page,
      limit,
      action: action || undefined,
      actorId: actorId || undefined,
      excludeTests: excludeTests ? 1 : undefined,
    },
  });
  return data;
}
