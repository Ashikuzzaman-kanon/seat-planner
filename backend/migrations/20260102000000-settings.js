"use strict";

/**
 * The configuration store.
 *
 * Rows are overrides only — a setting with no row uses the default declared in
 * `constants/settingDefinitions.js`. `scope` / `scope_id` are present from the
 * start so per-train and per-class overrides remain an additive change later.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("settings", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      key: { type: Sequelize.STRING(100), allowNull: false },
      scope: { type: Sequelize.STRING(20), allowNull: false, defaultValue: "global" },
      scope_id: { type: Sequelize.INTEGER, allowNull: true },
      value: { type: Sequelize.JSON, allowNull: false },
      updated_by_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addConstraint("settings", {
      fields: ["key", "scope", "scope_id"],
      type: "unique",
      name: "settings_key_scope_scope_id_unique",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("settings");
  },
};
