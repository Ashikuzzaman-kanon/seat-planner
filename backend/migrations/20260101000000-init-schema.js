"use strict";

/**
 * Initial schema.
 *
 * Access control is data-driven: `permissions` mirrors the code catalogue,
 * `roles` are created at runtime, and the two join tables compose them onto
 * users. There is no `role` column on `users` — privilege comes from the union
 * of the roles a user holds, never from rank.
 *
 * Folded into the initial migration rather than layered as an alter, because
 * this predates the first release of the ticketing system. From here on
 * migrations are strictly additive.
 *
 * Tables are created in foreign-key dependency order (referenced tables first).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    };

    const fk = (table, onDelete = "RESTRICT") => ({
      references: { model: table, key: "id" },
      onUpdate: "CASCADE",
      onDelete,
    });

    // ---------- Identity ----------
    await queryInterface.createTable("users", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      full_name: { type: Sequelize.STRING, allowNull: false },
      email: { type: Sequelize.STRING, allowNull: false, unique: true },
      password_hash: { type: Sequelize.STRING, allowNull: false },
      is_verified: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      verification_code: { type: Sequelize.STRING, allowNull: true },
      verification_code_expires: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    });

    // ---------- Access control ----------
    await queryInterface.createTable("permissions", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      key: { type: Sequelize.STRING(100), allowNull: false, unique: true },
      // `group_name`, not `group`: GROUP is a reserved word in MySQL.
      group_name: { type: Sequelize.STRING(60), allowNull: false },
      label: { type: Sequelize.STRING(150), allowNull: false },
      description: { type: Sequelize.STRING(500), allowNull: true },
      ...timestamps,
    });

    await queryInterface.createTable("roles", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      name: { type: Sequelize.STRING(60), allowNull: false, unique: true },
      description: { type: Sequelize.STRING(300), allowNull: true },
      // `super_admin` is structural — it cannot be edited or deleted, or the
      // install could be left with no way back in.
      is_system: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      // Granted automatically to every new registration.
      is_default: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      ...timestamps,
    });

    await queryInterface.createTable("role_permissions", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      role_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("roles", "CASCADE") },
      permission_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        ...fk("permissions", "CASCADE"),
      },
      ...timestamps,
    });
    await queryInterface.addConstraint("role_permissions", {
      fields: ["role_id", "permission_id"],
      type: "unique",
      name: "role_permissions_role_id_permission_id_unique",
    });

    await queryInterface.createTable("user_roles", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("users", "CASCADE") },
      role_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("roles", "CASCADE") },
      // Null when granted by the system itself, e.g. the default role on registration.
      granted_by_id: { type: Sequelize.INTEGER, allowNull: true, ...fk("users", "SET NULL") },
      ...timestamps,
    });
    await queryInterface.addConstraint("user_roles", {
      fields: ["user_id", "role_id"],
      type: "unique",
      name: "user_roles_user_id_role_id_unique",
    });

    // Long-lived credentials must be revocable, so they are tracked server-side.
    // Only a hash is stored: a leaked database still cannot mint sessions.
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

    // ---------- Reference data ----------
    for (const table of ["train_names", "coach_types", "coach_classes"]) {
      await queryInterface.createTable(table, {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        name: { type: Sequelize.STRING, allowNull: false, unique: true },
        ...timestamps,
      });
    }

    // ---------- Seat plans ----------
    await queryInterface.createTable("seat_plans", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      coach_no: { type: Sequelize.STRING, allowNull: false },
      status: {
        type: Sequelize.ENUM("draft", "pending", "approved", "rejected"),
        allowNull: false,
        defaultValue: "draft",
      },
      rejection_reason: { type: Sequelize.TEXT, allowNull: true },
      layout: { type: Sequelize.JSON, allowNull: false },
      approved_at: { type: Sequelize.DATE, allowNull: true },
      train_name_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("train_names") },
      coach_type_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("coach_types") },
      coach_class_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("coach_classes") },
      created_by_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("users") },
      approved_by_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        ...fk("users", "SET NULL"),
      },
      ...timestamps,
    });
  },

  async down(queryInterface) {
    // Reverse order: tables holding foreign keys go first.
    await queryInterface.dropTable("seat_plans");
    await queryInterface.dropTable("coach_classes");
    await queryInterface.dropTable("coach_types");
    await queryInterface.dropTable("train_names");
    await queryInterface.dropTable("refresh_tokens");
    await queryInterface.dropTable("user_roles");
    await queryInterface.dropTable("role_permissions");
    await queryInterface.dropTable("roles");
    await queryInterface.dropTable("permissions");
    await queryInterface.dropTable("users");
  },
};
