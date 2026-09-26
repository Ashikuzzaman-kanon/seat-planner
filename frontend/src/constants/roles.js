/**
 * Role display helpers.
 *
 * Roles are created at runtime, so there is no fixed list to enumerate here —
 * only presentation. `super_admin` is the one name the system itself reserves.
 */

export const SUPER_ADMIN_ROLE = "super_admin";

/** "super_admin" -> "Super Admin" */
export function roleLabel(name) {
  if (!name) return "";
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const PALETTE = ["info", "success", "warning", "secondary", "contrast"];

/**
 * A stable colour per role name. Roles are user-created, so colours are derived
 * rather than configured — the same role always looks the same without anyone
 * having to pick.
 */
export function roleSeverity(name) {
  if (!name) return "secondary";
  if (name === SUPER_ADMIN_ROLE) return "danger";

  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
