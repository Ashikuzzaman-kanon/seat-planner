import api from "@/lib/api";
import config from "@/config";
import { getToken } from "@/lib/api";
import { androidApp, tellAndroidApp } from "@/lib/androidApp";

/* ---------------------------------------------------------------- *
 * Shopping
 *
 * These reach /search rather than /trips: a passenger holds the permission to
 * buy, not the operational permissions the departure board needs.
 * ---------------------------------------------------------------- */

export async function fetchSearchStations() {
  const { data } = await api.get("/search/stations");
  return data.stations;
}

export async function fetchBookableDates(days = 14) {
  const { data } = await api.get("/search/dates", { params: { days } });
  return data.dates;
}

export async function searchDepartures({ fromStationId, toStationId, date, coachClassId }) {
  const { data } = await api.get("/search/departures", {
    params: { fromStationId, toStationId, date, coachClassId: coachClassId || undefined },
  });
  return data;
}

export async function fetchDepartureRoute(tripId) {
  const { data } = await api.get(`/search/departures/${tripId}/route`);
  return data;
}

/**
 * Where there is room on one departure, pair by pair.
 *
 * The passenger-facing view of the same engine the inventory screen uses: it
 * answers "how far can I get on this train" rather than "is it full", which for
 * segment-sold seats are very different questions.
 */
export async function fetchDepartureMatrix(tripId, coachClassId) {
  const { data } = await api.get(`/search/departures/${tripId}/matrix`, {
    params: { coachClassId: coachClassId || undefined },
  });
  return data;
}

export async function fetchSellableSeats({ tripId, fromStationId, toStationId, coachClassId, filters }) {
  const { data } = await api.get(`/search/departures/${tripId}/seats`, {
    params: {
      fromStationId,
      toStationId,
      coachClassId: coachClassId || undefined,
      filters: filters && Object.keys(filters).length ? JSON.stringify(filters) : undefined,
    },
  });
  return data;
}

/* ---------------------------------------------------------------- *
 * Wallet
 * ---------------------------------------------------------------- */

export async function fetchWallet() {
  const { data } = await api.get("/wallet");
  return data.wallet;
}

export async function fetchWalletTransactions({ page = 1, limit = 25 } = {}) {
  const { data } = await api.get("/wallet/transactions", { params: { page, limit } });
  return data;
}

export async function topUpWallet(amount) {
  const { data } = await api.post("/wallet/topup", { amount });
  return data;
}

/** Re-sums the ledger server-side and reports whether it matches the balance. */
export async function verifyWallet() {
  const { data } = await api.get("/wallet/verify");
  return data;
}

/* ---------------------------------------------------------------- *
 * Holds
 * ---------------------------------------------------------------- */

export async function createHold({ tripId, seatIds, fromStationId, toStationId }) {
  const { data } = await api.post("/holds", { tripId, seatIds, fromStationId, toStationId });
  return data.hold;
}

export async function fetchHold(reference) {
  const { data } = await api.get(`/holds/${reference}`);
  return data.hold;
}

export async function releaseHold(reference) {
  const { data } = await api.delete(`/holds/${reference}`);
  return data;
}

export async function fetchMyHolds() {
  const { data } = await api.get("/holds");
  return data.holds;
}

/** What would the system pick? Reserves nothing. */
export async function previewSeats(payload) {
  const { data } = await api.post("/holds/preview", payload);
  return data;
}

/** Pick and hold in one step. */
export async function autoHold(payload) {
  const { data } = await api.post("/holds/auto", payload);
  return data;
}

/* ---------------------------------------------------------------- *
 * Bookings
 * ---------------------------------------------------------------- */

export async function quoteHold(holdReference) {
  const { data } = await api.post("/bookings/quote", { holdReference });
  return data;
}

export async function createBooking({ holdReference, passengers, method, gatewayToken }) {
  const { data } = await api.post("/bookings", { holdReference, passengers, method, gatewayToken });
  return data.booking;
}

export async function fetchBookings({ page = 1, all = false } = {}) {
  const { data } = await api.get("/bookings", { params: { page, all: all ? 1 : undefined } });
  return data;
}

export async function fetchBooking(id) {
  const { data } = await api.get(`/bookings/${id}`);
  return data.booking;
}

export async function fetchBookingByReference(reference) {
  const { data } = await api.get(`/bookings/reference/${reference}`);
  return data.booking;
}

export async function fetchTicketQr({ bookingId, ticketNumber }) {
  const { data } = await api.get(`/bookings/${bookingId}/tickets/${ticketNumber}/qr`);
  return data;
}

/**
 * Open the ticket PDF.
 *
 * Fetched rather than linked because the endpoint needs an Authorization
 * header, which a plain anchor cannot carry. The blob URL is revoked on the
 * next tick — long enough for the browser to have opened it, short enough not
 * to leak.
 *
 * Inside the Android app there is no new tab to open, so the file is handed to
 * the app instead, which shows it in the phone's PDF viewer.
 */
export async function openTicketPdf(bookingId) {
  const res = await fetch(`${config.apiBaseUrl}/bookings/${bookingId}/pdf`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || "Could not open the tickets");
  }

  const blob = await res.blob();

  if (androidApp()) {
    const name =
      /filename="?([^";]+)"?/.exec(res.headers.get("Content-Disposition") || "")?.[1] || `tickets-${bookingId}.pdf`;
    tellAndroidApp({ type: "pdf", name, data: await toBase64(blob) });
    return;
  }

  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A file's bytes as base64, without the `data:…;base64,` prefix. */
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Could not read the tickets"));
    reader.readAsDataURL(blob);
  });
}

/* ---------------------------------------------------------------- *
 * Labels
 * ---------------------------------------------------------------- */

export const TOGETHERNESS_LABELS = {
  side_by_side: "Side by side",
  same_row: "Same row",
  nearby: "A row apart",
  same_coach: "Same coach",
  scattered: "Spread out",
};

export const PAYMENT_LABELS = {
  wallet: "Wallet",
  split: "Wallet, then card",
  gateway: "Card / mobile banking",
};

export const TRANSACTION_LABELS = {
  topup: "Top-up",
  purchase: "Ticket purchase",
  refund: "Refund",
  adjustment: "Adjustment",
  withdrawal: "Withdrawal",
};

/** Turns an API money amount in poisha into something to print. */
export const formatTaka = (minor) =>
  `৳ ${(Number(minor || 0) / 100).toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/* ---------------------------------------------------------------- *
 * The waitlist
 *
 * Queueing for a stretch that is sold out. Confirming an offer takes no body
 * at all — who is travelling was captured when the passenger joined, which is
 * what makes it one click.
 * ---------------------------------------------------------------- */

export async function fetchMyWaitlist() {
  const { data } = await api.get("/waitlist");
  return data.entries;
}

export async function joinWaitlist({ tripId, fromStationId, toStationId, count, coachClassId, passengers }) {
  const { data } = await api.post("/waitlist", {
    tripId,
    fromStationId,
    toStationId,
    count,
    coachClassId: coachClassId || undefined,
    passengers,
  });
  return data.entry;
}

export async function fetchWaitlistEntry(reference) {
  const { data } = await api.get(`/waitlist/${reference}`);
  return data.entry;
}

export async function leaveWaitlist(reference) {
  const { data } = await api.delete(`/waitlist/${reference}`);
  return data;
}

export async function quoteWaitlistOffer(reference) {
  const { data } = await api.get(`/waitlist/${reference}/offer/quote`);
  return data;
}

export async function confirmWaitlistOffer(reference) {
  const { data } = await api.post(`/waitlist/${reference}/offer/confirm`);
  return data;
}

export async function declineWaitlistOffer(reference) {
  const { data } = await api.post(`/waitlist/${reference}/offer/decline`);
  return data;
}

export async function fetchTripWaitlist(tripId) {
  const { data } = await api.get(`/waitlist/trip/${tripId}`);
  return data;
}

export const WAITLIST_STATUS_LABELS = {
  waiting: "Waiting",
  offered: "Seat offered",
  confirmed: "Confirmed",
  declined: "Declined",
  lapsed: "Offer expired",
  withdrawn: "Left the queue",
  closed: "Departure gone",
};
