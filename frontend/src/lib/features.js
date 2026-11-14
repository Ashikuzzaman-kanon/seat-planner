import api from "@/lib/api";

/**
 * Feature switches (Settings → Features), for the super admin: every tab with
 * its switch, and the roles one can be switched off for.
 */
export async function fetchFeatures() {
  const { data } = await api.get("/features");
  return data;
}

/** People to switch a tab off for, found by name or email. */
export async function searchPeople(search) {
  const { data } = await api.get("/features/people", { params: { search } });
  return data.people;
}

/**
 * Switch a tab: `state` is "on", "off_all" or "off_some" (with `userIds`
 * and/or `roleIds`); `message` is shown to the people it is off for.
 */
export async function saveFeature(key, { state, message, userIds, roleIds }) {
  const { data } = await api.put(`/features/${key}`, { state, message, userIds, roleIds });
  return data.feature;
}

export const STATE_LABELS = {
  on: "On",
  off_all: "Off for everyone",
  off_some: "Off for some",
};
