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

/*
 * The log analysed (GET /audit/analysis). An ask is
 * { actions, areas, people, outcome, since, until, last, hours, days, tests,
 *   by: ["action", "hour"], where: [{ key, value }], compare } — lists go
 * repeated; a filter goes as w=field:value, a value of null as w=field: alone.
 */
const analysisParams = (ask) => {
  const params = {
    action: ask.actions,
    area: ask.areas,
    person: ask.people?.map((p) => (p === null ? "none" : p)),
    outcome: ask.outcome || undefined,
    since: ask.last ? undefined : ask.since,
    until: ask.last ? undefined : ask.until,
    last: ask.last || undefined,
    hours: ask.hours || undefined,
    days: ask.days?.length ? ask.days.join(",") : undefined,
    tests: ask.tests ? 1 : undefined,
    by: ask.by?.join(","),
    w: ask.where?.map((w) => `${w.key}:${w.value ?? ""}`),
    compare: ask.compare ? 1 : undefined,
  };
  return { params, paramsSerializer: { indexes: null } };
};

export async function fetchAuditAnalysis(ask) {
  const { data } = await api.get("/audit/analysis", analysisParams(ask));
  return data;
}

/** The groups as a spreadsheet, saved as a file. */
export async function downloadAuditAnalysis(ask) {
  const { data } = await api.get("/audit/analysis.csv", { ...analysisParams(ask), responseType: "blob" });
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = "audit-analysis.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** People in the log, by part of a name or email: [{ id, label, email, events }]. */
export async function searchAuditPeople(q) {
  const { data } = await api.get("/audit/people", { params: { q } });
  return data.people;
}
