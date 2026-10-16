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

/** An editable copy of an approved plan — or the one already open. */
export async function revisePlan(id) {
  const { data } = await api.post(`/plans/${id}/revise`);
  return data.plan;
}

/**
 * The id to edit for a plan. One not yet approved is edited as it is; an
 * approved one through its editable copy, so it keeps being used meanwhile.
 */
export async function idToEdit(plan) {
  return plan.status === "approved" && !plan.revisionOfId ? (await revisePlan(plan.id)).id : plan.id;
}

/** What an approved plan's open copy is up to, in a few words. */
export const REVISION_WORDS = {
  draft: "Changes in draft",
  pending: "Changes waiting for approval",
  rejected: "Changes sent back",
};

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
