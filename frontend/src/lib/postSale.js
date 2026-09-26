import api from "@/lib/api";

/**
 * Everything that happens after a ticket has been paid for.
 *
 * Kept apart from `booking.js` because the audiences differ: a passenger
 * returns their own ticket and asks for their own withdrawal, while a reviewer
 * works a queue of other people's requests. Both reach the same endpoints,
 * gated by permission rather than by path.
 */

/* ---------------------------------------------------------------- *
 * Returning a ticket
 * ---------------------------------------------------------------- */

/** Both policies priced side by side — the choice a passenger is making. */
export async function quoteRefund(ticketId) {
  const { data } = await api.get(`/tickets/${ticketId}/refund-quote`);
  return data;
}

export async function requestRefund({ ticketId, type }) {
  const { data } = await api.post(`/tickets/${ticketId}/refund`, { type });
  return data;
}

export async function fetchRefunds({ page = 1, all = false } = {}) {
  const { data } = await api.get("/refunds", { params: { page, all: all ? 1 : undefined } });
  return data;
}

export async function fetchRefund(reference) {
  const { data } = await api.get(`/refunds/${reference}`);
  return data.refund;
}

/* ---------------------------------------------------------------- *
 * Connecting standing
 * ---------------------------------------------------------------- */

/** What could be added either side of this seated ticket, priced. */
export async function fetchStandingOptions(ticketId) {
  const { data } = await api.get(`/tickets/${ticketId}/standing`);
  return data;
}

export async function buyStanding({ ticketId, fromStationId, toStationId, method = "wallet" }) {
  const { data } = await api.post(`/tickets/${ticketId}/standing`, {
    fromStationId,
    toStationId,
    method,
  });
  return data;
}

/* ---------------------------------------------------------------- *
 * Requests that need a person
 * ---------------------------------------------------------------- */

export async function requestTransfer({ ticketId, toNid, toName, reason }) {
  const { data } = await api.post(`/tickets/${ticketId}/transfer`, { toNid, toName, reason });
  return data;
}

export async function requestWithdrawal({ amount, destination, reason }) {
  const { data } = await api.post("/wallet/withdraw", { amount, destination, reason });
  return data;
}

export async function fetchMyRequests({ page = 1 } = {}) {
  const { data } = await api.get("/approvals/mine", { params: { page } });
  return data;
}

export async function cancelRequest(reference) {
  const { data } = await api.post(`/approvals/${reference}/cancel`);
  return data;
}

/* ---------------------------------------------------------------- *
 * The queue
 * ---------------------------------------------------------------- */

export async function fetchQueues() {
  const { data } = await api.get("/approvals/queues");
  return data.queues;
}

export async function fetchApprovals({ type, status, page = 1 } = {}) {
  const { data } = await api.get("/approvals", {
    params: { type: type || undefined, status: status || undefined, page },
  });
  return data;
}

export async function decideRequest({ reference, decision, note }) {
  const { data } = await api.post(`/approvals/${reference}/decide`, { decision, note });
  return data;
}

/* ---------------------------------------------------------------- *
 * Per-departure return switches
 * ---------------------------------------------------------------- */

export async function setRefundOptions(tripId, { convenient, demand }) {
  const { data } = await api.patch(`/trips/${tripId}/refund-options`, { convenient, demand });
  return data;
}

/* ---------------------------------------------------------------- *
 * Labels
 * ---------------------------------------------------------------- */

export const REFUND_STATUS_LABELS = {
  settled: "Paid",
  awaiting_resale: "Waiting for a buyer",
  partially_settled: "Partly paid",
  closed: "Closed — train departed",
};

export const REFUND_STATUS_SEVERITY = {
  settled: "success",
  awaiting_resale: "info",
  partially_settled: "warning",
  closed: "secondary",
};

export const REFUND_TYPE_LABELS = {
  convenient: "Convenient return",
  demand: "Demand-based return",
  disruption: "Cancelled by the railway",
};

export const APPROVAL_TYPE_LABELS = {
  ticket_transfer: "Ticket transfer",
  wallet_withdrawal: "Wallet withdrawal",
  abuse_review: "Account review",
};

export const APPROVAL_STATUS_SEVERITY = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "secondary",
};

/** Why an option cannot be used, in words a passenger can act on. */
export const REFUSAL_HINTS = {
  departed: "The train has already left.",
  not_refundable: "Too close to departure for this to pay anything.",
  already_refunded: "This ticket has already been returned.",
  sale_closed: "Too late to put the seat back on sale.",
  disabled: "Not offered on this departure.",
  standing_held: "A standing ticket attached to this seat must go first.",
};
