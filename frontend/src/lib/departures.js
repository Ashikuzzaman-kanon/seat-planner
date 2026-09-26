import api from "@/lib/api";

/* ---------------- Composition ---------------- */

export async function fetchComposition(trainId) {
  const { data } = await api.get(`/trains/${trainId}/composition`);
  return data.coaches;
}

export async function saveComposition(trainId, coaches) {
  const { data } = await api.put(`/trains/${trainId}/composition`, { coaches });
  return data;
}

/* ---------------- Schedule ---------------- */

export async function fetchSchedule(trainId) {
  const { data } = await api.get(`/trains/${trainId}/schedule`);
  return data.schedules;
}

export async function saveSchedule(trainId, schedules) {
  const { data } = await api.put(`/trains/${trainId}/schedule`, { schedules });
  return data.schedules;
}

/* ---------------- Departures ---------------- */

export async function fetchTrips(params = {}) {
  const { data } = await api.get("/trips", { params });
  return data.trips;
}

export async function fetchTrip(id) {
  const { data } = await api.get(`/trips/${id}`);
  return data.trip;
}

export async function fetchTripSeats(id, params = {}) {
  const { data } = await api.get(`/trips/${id}/seats`, { params });
  return data.seats;
}

/** Idempotent — a repeat run reports existing departures rather than duplicating them. */
export async function generateHorizon(body = {}) {
  const { data } = await api.post("/trips/generate", body);
  return data;
}

export async function rebuildTrip(id) {
  const { data } = await api.post(`/trips/${id}/rebuild`);
  return data;
}

/**
 * Cancel a departure. The refunds run as a background job: `trip.refunds` is
 * filled in when they finished while the request waited, and null (with
 * `trip.job` still running) when they are carrying on in the background.
 */
export async function cancelTrip(id, reason) {
  const { data } = await api.post(`/trips/${id}/cancel`, { reason });
  return data.trip;
}

/** Put a cancelled departure back into service. Its refunds stay paid. */
export async function reinstateTrip(id, reason) {
  const { data } = await api.post(`/trips/${id}/reinstate`, { reason });
  return data.trip;
}

/**
 * Turn connecting standing on or off for one departure.
 *
 * Only ever more restrictive than the coach class: switching it on here does
 * not make a class sell standing that has no capacity configured.
 */
export async function setTripStanding(id, enabled) {
  const { data } = await api.patch(`/trips/${id}/standing`, { enabled });
  return data;
}

export async function fetchJobs() {
  const { data } = await api.get("/trips/jobs");
  return data.jobs;
}

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ---------------- One departure's coaches ---------------- */

/** The coaches on a departure, with what each is carrying and what may be done to it. */
export async function fetchTripCoaches(tripId) {
  const { data } = await api.get(`/trips/${tripId}/coaches`);
  return data;
}

export async function addTripCoach(tripId, { seatPlanId, coachCode, position }) {
  const { data } = await api.post(`/trips/${tripId}/coaches`, { seatPlanId, coachCode, position });
  return data;
}

export async function removeTripCoach(tripId, coachId) {
  const { data } = await api.delete(`/trips/${tripId}/coaches/${coachId}`);
  return data;
}

/** Like cancelling a departure: `refunded` is null while the refund job is still running. */
export async function cancelTripCoach(tripId, coachId, reason) {
  const { data } = await api.post(`/trips/${tripId}/coaches/${coachId}/cancel`, { reason });
  return data;
}

export async function reinstateTripCoach(tripId, coachId, reason) {
  const { data } = await api.post(`/trips/${tripId}/coaches/${coachId}/reinstate`, { reason });
  return data;
}
