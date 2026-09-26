"use strict";

/**
 * Bring a database from the first deployed release into dynamic RBAC.
 *
 * ## Why this exists
 *
 * The first release stored access as a `role` column on `users` — one of user,
 * planner, admin, super_admin — with a fixed permission matrix in code. The
 * ticketing work replaced that with roles and permissions as data, and folded
 * the new tables into the initial migration, because at the time nothing had
 * been released on top of it.
 *
 * Something had: the live deployment ran the *old* initial migration. A
 * database built that way already has the initial migration marked as done, so
 * it will never gain the roles tables from it — and the new code, which reads
 * them on every request and at boot, would not start.
 *
 * ## What it does
 *
 * Only on a database that still has `users.role`. On one built by the current
 * initial migration there is no such column, and this does nothing.
 *
 * 1. Creates the access-control tables the current initial migration would have.
 * 2. Recreates the old roles as data, with exactly the permissions the old
 *    matrix gave them — the permission keys did not change — so nobody gains
 *    or loses anything by the upgrade. `user` becomes the default role for new
 *    registrations, with the buying baseline the super-admin seeder gives it.
 * 3. Gives every existing account the role its column named, plus the default
 *    role, which every registration now receives.
 * 4. Drops the column. From here access comes only from roles held.
 *
 * Everyone is signed out by the upgrade: sessions are now refresh tokens,
 * which the old release never issued.
 */

const LEGACY = {
  planner: ["plan:view", "plan:create", "plan:update", "plan:delete"],
  admin: [
    "plan:view",
    "plan:create",
    "plan:update",
    "plan:delete",
    "plan:approve",
    "reference:manage",
    "user:view",
  ],
};

/** What `seed:superadmin` gives the default role: browse plans, buy, return, queue. */
const DEFAULT_BASELINE = ["plan:view", "booking:create", "refund:request", "waitlist:join"];

const tableNames = async (queryInterface) =>
  (await queryInterface.showAllTables()).map((t) => (typeof t === "string" ? t : t.tableName));

module.exports = {
  async up(queryInterface, Sequelize) {
    const users = await queryInterface.describeTable("users");
    if (!users.role) return; // Built by the current initial migration: nothing to bridge.

    const existing = new Set(await tableNames(queryInterface));
    const now = new Date();
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    };
    const fk = (table, onDelete = "RESTRICT") => ({
      references: { model: table, key: "id" },
      onUpdate: "CASCADE",
      onDelete,
    });

    /* ---------------- 1. The tables ---------------- */

    if (!existing.has("permissions")) {
      await queryInterface.createTable("permissions", {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        key: { type: Sequelize.STRING(100), allowNull: false, unique: true },
        group_name: { type: Sequelize.STRING(60), allowNull: false },
        label: { type: Sequelize.STRING(150), allowNull: false },
        description: { type: Sequelize.STRING(500), allowNull: true },
        ...timestamps,
      });
    }

    if (!existing.has("roles")) {
      await queryInterface.createTable("roles", {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        name: { type: Sequelize.STRING(60), allowNull: false, unique: true },
        description: { type: Sequelize.STRING(300), allowNull: true },
        is_system: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        is_default: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        ...timestamps,
      });
    }

    if (!existing.has("role_permissions")) {
      await queryInterface.createTable("role_permissions", {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        role_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("roles", "CASCADE") },
        permission_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("permissions", "CASCADE") },
        ...timestamps,
      });
      await queryInterface.addConstraint("role_permissions", {
        fields: ["role_id", "permission_id"],
        type: "unique",
        name: "role_permissions_role_id_permission_id_unique",
      });
    }

    if (!existing.has("user_roles")) {
      await queryInterface.createTable("user_roles", {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        user_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("users", "CASCADE") },
        role_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("roles", "CASCADE") },
        granted_by_id: { type: Sequelize.INTEGER, allowNull: true, ...fk("users", "SET NULL") },
        ...timestamps,
      });
      await queryInterface.addConstraint("user_roles", {
        fields: ["user_id", "role_id"],
        type: "unique",
        name: "user_roles_user_id_role_id_unique",
      });
    }

    if (!existing.has("refresh_tokens")) {
      await queryInterface.createTable("refresh_tokens", {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        user_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("users", "CASCADE") },
        token_hash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
        expires_at: { type: Sequelize.DATE, allowNull: false },
        revoked_at: { type: Sequelize.DATE, allowNull: true },
        user_agent: { type: Sequelize.STRING(300), allowNull: true },
        ip_address: { type: Sequelize.STRING(64), allowNull: true },
        ...timestamps,
      });
      await queryInterface.addIndex("refresh_tokens", ["user_id"]);
    }

    /* ---------------- 2. The permissions the roles need ---------------- */

    // Labels from the catalogue in code; the server re-syncs the whole
    // catalogue on every boot, so these rows are only what the grants below
    // need to point at.
    const { PERMISSION_CATALOGUE } = require("../src/constants/permissions");
    const catalogue = new Map(PERMISSION_CATALOGUE.map((p) => [p.key, p]));
    const needed = [...new Set([...DEFAULT_BASELINE, ...LEGACY.planner, ...LEGACY.admin])];
    await queryInterface.bulkInsert(
      "permissions",
      needed.map((key) => ({
        key,
        group_name: catalogue.get(key)?.group || "Other",
        label: catalogue.get(key)?.label || key,
        description: catalogue.get(key)?.description || null,
        created_at: now,
        updated_at: now,
      })),
      { ignoreDuplicates: true }
    );

    const [permRows] = await queryInterface.sequelize.query("SELECT id, `key` FROM permissions");
    const permId = new Map(permRows.map((p) => [p.key, p.id]));

    /* ---------------- 3. The roles ---------------- */

    const roles = [
      {
        name: "super_admin",
        description: "Full access to everything. Cannot be edited or deleted.",
        is_system: true,
        is_default: false,
        grants: [], // holds everything implicitly
      },
      {
        name: "user",
        description: "Baseline capability granted to every new registration.",
        is_system: false,
        is_default: true,
        grants: DEFAULT_BASELINE,
      },
      {
        name: "planner",
        description: "Draws seat plans (carried over from the first release).",
        is_system: false,
        is_default: false,
        grants: LEGACY.planner,
      },
      {
        name: "admin",
        description: "Approves plans and keeps reference data (carried over from the first release).",
        is_system: false,
        is_default: false,
        grants: LEGACY.admin,
      },
    ];

    await queryInterface.bulkInsert(
      "roles",
      roles.map(({ grants, ...r }) => ({ ...r, created_at: now, updated_at: now })),
      { ignoreDuplicates: true }
    );
    const [roleRows] = await queryInterface.sequelize.query("SELECT id, name FROM roles");
    const roleId = new Map(roleRows.map((r) => [r.name, r.id]));

    const grants = roles.flatMap((r) =>
      r.grants
        .filter((key) => permId.has(key))
        .map((key) => ({
          role_id: roleId.get(r.name),
          permission_id: permId.get(key),
          created_at: now,
          updated_at: now,
        }))
    );
    if (grants.length) await queryInterface.bulkInsert("role_permissions", grants, { ignoreDuplicates: true });

    /* ---------------- 4. Who holds what ---------------- */

    const [people] = await queryInterface.sequelize.query("SELECT id, role FROM users");
    const holdings = [];
    for (const person of people) {
      const legacy = roleId.has(person.role) ? person.role : "user";
      holdings.push({ user_id: person.id, role_id: roleId.get(legacy), created_at: now, updated_at: now });
      // Every registration now also receives the default role.
      if (legacy !== "user" && legacy !== "super_admin") {
        holdings.push({ user_id: person.id, role_id: roleId.get("user"), created_at: now, updated_at: now });
      }
    }
    if (holdings.length) await queryInterface.bulkInsert("user_roles", holdings, { ignoreDuplicates: true });

    await queryInterface.removeColumn("users", "role");
  },

  /**
   * Put the column back, from the roles each account holds — the most
   * privileged of the four legacy roles wins. The tables are left: on a
   * database built by the current initial migration they belong to it.
   */
  async down(queryInterface, Sequelize) {
    const users = await queryInterface.describeTable("users");
    if (users.role) return;

    await queryInterface.addColumn("users", "role", {
      type: Sequelize.ENUM("user", "planner", "admin", "super_admin"),
      allowNull: false,
      defaultValue: "user",
    });
    for (const name of ["planner", "admin", "super_admin"]) {
      await queryInterface.sequelize.query(
        "UPDATE users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id " +
          "SET u.role = :name WHERE r.name = :name",
        { replacements: { name } }
      );
    }
  },
};
