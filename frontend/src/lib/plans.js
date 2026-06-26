import api from "@/lib/api";

export async function listPlans(params = {}) {
  const { data } = await api.get("/plans", { params });
  return data.plans;
}

export async function getPlan(id) {
  const { data } = await api.get(`/plans/${id}`);
  return data.plan;
}

export async function createPlan(payload) {
  const { data } = await api.post("/plans", payload);
  return data.plan;
}

export async function updatePlan(id, payload) {
  const { data } = await api.put(`/plans/${id}`, payload);
  return data.plan;
}

export async function submitPlan(id) {
  const { data } = await api.post(`/plans/${id}/submit`);
  return data.plan;
}

export async function approvePlan(id) {
  const { data } = await api.post(`/plans/${id}/approve`);
  return data.plan;
}

export async function rejectPlan(id, reason) {
  const { data } = await api.post(`/plans/${id}/reject`, { reason });
  return data.plan;
}

export function deletePlan(id) {
  return api.delete(`/plans/${id}`);
}
