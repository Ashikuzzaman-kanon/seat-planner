"use strict";

/**
 * Profiles, restricted accounts, and app versions on the subscription check.
 *
 *   users                          gains `last_sign_in_at`, set each time the
 *                                  account signs in with its password, and
 *                                  `restricted_at`, set while the account is
 *                                  restricted. The flag is what every request
 *                                  checks; the history is the table below.
 *   account_restrictions           every restriction placed on an account and
 *                                  every lifting of one: who, when and why.
 *                                  A row with no `lifted_at` is in force.
 *   subscription_platforms         gains `version_required` and `min_version`:
 *                                  whether a check from this platform must say
 *                                  which version of the app is calling, and the
 *                                  oldest version still let through.
 *   subscription_blocked_versions  versions of a platform's app that are turned
 *                                  away whatever the minimum says.
 *   user_devices                   gains `app_version`: the version a device
 *                                  last checked in with.
 *
 * Additive: two tables, five nullable or defaulted columns. Nothing changes
 * for anyone until a restriction is placed or a version rule is set.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const user = (allowNull, onDelete) => ({
      type: Sequelize.INTEGER,
      allowNull,
      references: { model: "users", key: "id" },
      onDelete,
      onUpdate: "CASCADE",
    });
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    };

    await queryInterface.addColumn("users", "last_sign_in_at", { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn("users", "restricted_at", { type: Sequelize.DATE, allowNull: true });

    await queryInterface.createTable("account_restrictions", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: user(false, "CASCADE"),
      reason: { type: Sequelize.STRING(500), allowNull: false },
      restricted_by_id: user(true, "SET NULL"),
      restricted_at: { type: Sequelize.DATE, allowNull: false },
      lifted_at: { type: Sequelize.DATE, allowNull: true },
      lifted_by_id: user(true, "SET NULL"),
      lift_note: { type: Sequelize.STRING(500), allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex("account_restrictions", ["user_id", "restricted_at"], {
      name: "account_restrictions_user_newest",
    });

    await queryInterface.addColumn("subscription_platforms", "version_required", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn("subscription_platforms", "min_version", { type: Sequelize.STRING(40), allowNull: true });

    await queryInterface.createTable("subscription_blocked_versions", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      platform_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "subscription_platforms", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      version: { type: Sequelize.STRING(40), allowNull: false },
      note: { type: Sequelize.STRING(200), allowNull: true },
      created_by_id: user(true, "SET NULL"),
      ...timestamps,
    });
    await queryInterface.addIndex("subscription_blocked_versions", ["platform_id", "version"], {
      unique: true,
      name: "subscription_blocked_versions_one_each",
    });

    await queryInterface.addColumn("user_devices", "app_version", { type: Sequelize.STRING(40), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("user_devices", "app_version");
    await queryInterface.dropTable("subscription_blocked_versions");
    await queryInterface.removeColumn("subscription_platforms", "min_version");
    await queryInterface.removeColumn("subscription_platforms", "version_required");
    await queryInterface.dropTable("account_restrictions");
    await queryInterface.removeColumn("users", "restricted_at");
    await queryInterface.removeColumn("users", "last_sign_in_at");
  },
};
