import api from "@/lib/api";

/* ---------------- Stations ---------------- */

export async function fetchStations({ includeInactive = false } = {}) {
  const { data } = await api.get("/stations", {
    params: includeInactive ? { includeInactive: 1 } : {},
  });
  return data.stations;
}

export async function createStation(payload) {
  const { data } = await api.post("/stations", payload);
  return data.station;
}

export async function updateStation(id, payload) {
  const { data } = await api.patch(`/stations/${id}`, payload);
  return data.station;
}

export async function deleteStation(id) {
  await api.delete(`/stations/${id}`);
}

/* ---------------- Trains & routes ---------------- */

export async function fetchTrains({ includeInactive = false } = {}) {
  const { data } = await api.get("/trains", {
    params: includeInactive ? { includeInactive: 1 } : {},
  });
  return data.trains;
}

export async function fetchTrain(id) {
  const { data } = await api.get(`/trains/${id}`);
  return data.train;
}

export async function createTrain(payload) {
  const { data } = await api.post("/trains", payload);
  return data.train;
}

export async function updateTrain(id, payload) {
  const { data } = await api.patch(`/trains/${id}`, payload);
  return data.train;
}

export async function deleteTrain(id) {
  await api.delete(`/trains/${id}`);
}

/** The route is replaced whole — a sequence is only coherent as a set. */
export async function saveRoute(trainId, stops) {
  const { data } = await api.put(`/trains/${trainId}/route`, { stops });
  return data;
}

/* ---------------- Fares ---------------- */

export async function fetchFareRules(params = {}) {
  const { data } = await api.get("/fares/rules", { params });
  return data.rules;
}

export async function createFareRule(payload) {
  const { data } = await api.post("/fares/rules", payload);
  return data.rule;
}

export async function updateFareRule(id, payload) {
  const { data } = await api.patch(`/fares/rules/${id}`, payload);
  return data.rule;
}

export async function deleteFareRule(id) {
  await api.delete(`/fares/rules/${id}`);
}

export async function saveFareTable(id, entries) {
  const { data } = await api.put(`/fares/rules/${id}/table`, { entries });
  return data.rule;
}

/** Every forward station pair on a train, priced, with the rule that priced it. */
export async function fetchFareMatrix({ trainId, coachClassId }) {
  const { data } = await api.get("/fares/matrix", { params: { trainId, coachClassId } });
  return data;
}

/* ---------------- Seat attributes ---------------- */

export async function fetchSeatAttributes({ includeInactive = false } = {}) {
  const { data } = await api.get("/seat-attributes", {
    params: includeInactive ? { includeInactive: 1 } : {},
  });
  return data.attributes;
}

export async function createSeatAttribute(payload) {
  const { data } = await api.post("/seat-attributes", payload);
  return data.attribute;
}

export async function updateSeatAttribute(id, payload) {
  const { data } = await api.patch(`/seat-attributes/${id}`, payload);
  return data.attribute;
}

export async function deleteSeatAttribute(id) {
  await api.delete(`/seat-attributes/${id}`);
}
