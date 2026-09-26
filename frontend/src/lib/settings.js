import api from "@/lib/api";

export async function fetchSettings() {
  const { data } = await api.get("/settings");
  return data.settings;
}

export async function updateSetting(key, value) {
  const { data } = await api.put(`/settings/${key}`, { value });
  return data.setting;
}
