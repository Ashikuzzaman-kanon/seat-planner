import api from "@/lib/api";

/** Seats sellable between two stations, with a reason for every one withheld. */
export async function fetchAvailability({ tripId, fromStationId, toStationId, coachClassId, filters }) {
  const { data } = await api.get(`/trips/${tripId}/availability`, {
    params: {
      fromStationId,
      toStationId,
      coachClassId: coachClassId || undefined,
      filters: filters && Object.keys(filters).length ? JSON.stringify(filters) : undefined,
    },
  });
  return data;
}

/** Every forward station pair at once — the view that makes segments visible. */
export async function fetchMatrix({ tripId, coachClassId }) {
  const { data } = await api.get(`/trips/${tripId}/availability/matrix`, {
    params: { coachClassId: coachClassId || undefined },
  });
  return data;
}

/**
 * Every seat on a departure, sold and free alike, with what holds the taken
 * ones. Passenger names come back only for callers who may see bookings.
 */
export async function fetchOccupancy({ tripId, fromStationId, toStationId, coachClassId }) {
  const { data } = await api.get(`/trips/${tripId}/occupancy`, {
    params: {
      fromStationId: fromStationId || undefined,
      toStationId: toStationId || undefined,
      coachClassId: coachClassId || undefined,
    },
  });
  return data;
}

export async function fetchSeatTimeline({ tripId, seatId }) {
  const { data } = await api.get(`/trips/${tripId}/seats/${seatId}/timeline`);
  return data;
}

export async function blockSeat({ tripId, seatId, fromStationId, toStationId, reason }) {
  const { data } = await api.post(`/trips/${tripId}/seats/${seatId}/block`, {
    fromStationId,
    toStationId,
    reason,
  });
  return data;
}

export async function unblockSeat({ tripId, seatId }) {
  const { data } = await api.delete(`/trips/${tripId}/seats/${seatId}/block`);
  return data;
}

/* ---------------- Quota ---------------- */

export async function fetchQuotaRules(trainId) {
  const { data } = await api.get("/quota/rules", { params: { trainId: trainId || undefined } });
  return data.rules;
}

export async function createQuotaRule(payload) {
  const { data } = await api.post("/quota/rules", payload);
  return data.rule;
}

export async function deleteQuotaRule(id) {
  const { data } = await api.delete(`/quota/rules/${id}`);
  return data;
}

export async function materialiseQuota(trainId, replace = true) {
  const { data } = await api.post(`/quota/trains/${trainId}/materialise`, { replace });
  return data;
}

/** Hold one named seat for one named station pair. */
export async function setSeatQuota({ tripId, seatId, fromStationId, toStationId, releaseHoursBefore }) {
  const { data } = await api.put(`/trips/${tripId}/seats/${seatId}/quota`, {
    fromStationId,
    toStationId,
    releaseHoursBefore,
  });
  return data;
}

export async function clearSeatQuota({ tripId, seatId }) {
  const { data } = await api.delete(`/trips/${tripId}/seats/${seatId}/quota`);
  return data;
}

export async function fetchTripSeats(tripId) {
  const { data } = await api.get(`/trips/${tripId}/seats`);
  return data.seats;
}

export async function fetchTripQuota(tripId) {
  const { data } = await api.get(`/trips/${tripId}/quota`);
  return data.quota;
}

export async function releaseTripQuota(tripId) {
  const { data } = await api.post(`/trips/${tripId}/quota/release`);
  return data;
}

/** Plain-English labels for the reasons a seat was withheld. */
export const WITHHELD_LABELS = {
  occupied: "Already sold",
  blocked: "Blocked",
  reserved_for_other_pair: "Held for another station pair",
  does_not_match_filters: "Does not match the chosen features",
};
