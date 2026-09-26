import api from "@/lib/api";

/* ---------------------------------------------------------------- *
 * On the train (§14)
 *
 * A refusal is a successful answer here, not an error: `/verify/check` and
 * `/verify/scan` return 200 with a verdict even when the ticket is no good.
 * So none of these throw on a refused ticket — the caller reads `verdict`.
 * ---------------------------------------------------------------- */

/** Look at a ticket. Changes nothing. */
export async function checkTicket({ token, ticketNumber, tripId, stationId }) {
  const { data } = await api.post("/verify/check", {
    token: token || undefined,
    ticketNumber: ticketNumber || undefined,
    tripId: tripId || undefined,
    stationId: stationId || undefined,
  });
  return data;
}

/** Admit a passenger. Marks the ticket used — this one cannot be undone. */
export async function scanTicket({ token, ticketNumber, tripId, stationId, clientReference }) {
  const { data } = await api.post("/verify/scan", {
    token: token || undefined,
    ticketNumber: ticketNumber || undefined,
    tripId: tripId || undefined,
    stationId: stationId || undefined,
    clientReference: clientReference || undefined,
  });
  return data;
}

export async function fetchManifest(tripId) {
  const { data } = await api.get(`/verify/trips/${tripId}/manifest`);
  return data;
}

export async function fetchTripScans(tripId, { page = 1 } = {}) {
  const { data } = await api.get(`/verify/trips/${tripId}/scans`, { params: { page } });
  return data;
}

export async function fetchTicketScans(ticketNumber) {
  const { data } = await api.get(`/verify/tickets/${ticketNumber}/scans`);
  return data;
}

/* ---------------------------------------------------------------- *
 * Reports and abuse (§14.3)
 * ---------------------------------------------------------------- */

export async function reportTicket({ ticketNumber, kind, detail, stationId }) {
  const { data } = await api.post("/abuse/reports", { ticketNumber, kind, detail, stationId });
  return data;
}

export async function fetchReports({ status = "open", page = 1 } = {}) {
  const { data } = await api.get("/abuse/reports", { params: { status, page } });
  return data;
}

export async function reviewReport(reference, { decision, note }) {
  const { data } = await api.post(`/abuse/reports/${reference}/review`, { decision, note });
  return data;
}

export async function fetchStanding(userId) {
  const { data } = await api.get(`/abuse/accounts/${userId}/standing`);
  return data;
}

export async function fetchHeldAccounts({ page = 1 } = {}) {
  const { data } = await api.get("/abuse/accounts/held", { params: { page } });
  return data;
}

export async function holdAccount(userId, { detail, reason }) {
  const { data } = await api.post(`/abuse/accounts/${userId}/hold`, { detail, reason });
  return data;
}

export async function releaseAccount(userId, { note }) {
  const { data } = await api.post(`/abuse/accounts/${userId}/release`, { note });
  return data;
}

/* ---------------------------------------------------------------- *
 * Labels
 * ---------------------------------------------------------------- */

/**
 * What each verdict means, said the way a checker would say it.
 *
 * `tone` drives the colour; `headline` is what fills the screen. The point of a
 * big headline is that it is read across a crowded corridor without anybody
 * leaning in.
 */
export const VERDICTS = {
  accepted: { headline: "Let them travel", tone: "ok", icon: "pi pi-check-circle" },
  checked: { headline: "Valid", tone: "ok", icon: "pi pi-check" },
  already_used: { headline: "Already scanned", tone: "warn", icon: "pi pi-replay" },
  not_valid: { headline: "Not valid", tone: "bad", icon: "pi pi-times-circle" },
  wrong_service: { headline: "Wrong train", tone: "warn", icon: "pi pi-directions-alt" },
  forged: { headline: "Not issued by us", tone: "bad", icon: "pi pi-ban" },
  unreadable: { headline: "Could not read that", tone: "warn", icon: "pi pi-question-circle" },
  unknown: { headline: "No such ticket", tone: "bad", icon: "pi pi-search-minus" },
};

export const REPORT_KINDS = [
  { label: "Not the person on the ticket", value: "identity_mismatch" },
  { label: "Same ticket in use twice", value: "duplicate_in_use" },
  { label: "Code was not genuine", value: "forgery" },
  { label: "Travelling beyond what was paid for", value: "beyond_journey" },
  { label: "Something else", value: "other" },
];
