/**
 * Roles are database rows created at runtime — this file holds only the two
 * names the system itself depends on.
 *
 * The old static hierarchy (user < planner < admin < super_admin) and its
 * hardcoded permission matrix are gone. Roles are flat: privilege comes purely
 * from the permissions attached to a role, never from rank.
 */

const RESERVED_ROLES = Object.freeze({
  /**
   * The only predefined role. Implicitly holds every permission in the
   * catalogue — including ones added by future features — so it can never be
   * locked out by a catalogue change. Cannot be edited or deleted.
   */
  SUPER_ADMIN: "super_admin",

  /**
   * Granted automatically to every new registration. Editable: an administrator
   * may change what baseline capability a new account starts with.
   */
  DEFAULT: "user",
});

module.exports = { RESERVED_ROLES };
