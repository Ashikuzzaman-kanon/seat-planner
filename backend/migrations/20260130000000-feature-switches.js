"use strict";

/**
 * Switches that turn a tab of the app off, for everyone or for some.
 *
 *   feature_switches         one row per feature that has ever been switched:
 *                            its state, an optional message for the people it
 *                            is off for, and who changed it last. A feature
 *                            with no row is on.
 *   feature_switch_targets   for state `off_some`: the users and roles it is
 *                            off for, one per row (a user or a role, never
 *                            both). Removing a user or role removes its rows.
 *
 * The features themselves are defined in code (src/constants/features.js).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("feature_switches", {
      key: { type: Sequelize.STRING(40), primaryKey: true },
      state: { type: Sequelize.STRING(20), allowNull: false, defaultValue: "on" },
      message: { type: Sequelize.STRING(300), allowNull: true },
      updated_by_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable("feature_switch_targets", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      feature_key: {
        type: Sequelize.STRING(40),
        allowNull: false,
        references: { model: "feature_switches", key: "key" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      role_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "roles", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("feature_switch_targets", ["feature_key", "user_id"], {
      unique: true,
      name: "feature_switch_targets_user",
    });
    await queryInterface.addIndex("feature_switch_targets", ["feature_key", "role_id"], {
      unique: true,
      name: "feature_switch_targets_role",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("feature_switch_targets");
    await queryInterface.dropTable("feature_switches");
  },
};
