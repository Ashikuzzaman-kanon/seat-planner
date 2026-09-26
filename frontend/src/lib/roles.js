import api from "@/lib/api";

export async function fetchRoles() {
  const { data } = await api.get("/roles");
  return data.roles;
}

/**
 * The permission catalogue annotated with `grantable`, which reflects the
 * escalation guard: a caller may only grant permissions they hold themselves.
 */
export async function fetchPermissionCatalogue() {
  const { data } = await api.get("/roles/permissions");
  return data.permissions;
}

export async function createRole({ name, description, permissions }) {
  const { data } = await api.post("/roles", { name, description, permissions });
  return data.role;
}

export async function updateRole(id, payload) {
  const { data } = await api.patch(`/roles/${id}`, payload);
  return data.role;
}

export async function deleteRole(id) {
  await api.delete(`/roles/${id}`);
}

export async function setUserRoles(userId, roleIds) {
  const { data } = await api.put(`/users/${userId}/roles`, { roleIds });
  return data.user;
}
