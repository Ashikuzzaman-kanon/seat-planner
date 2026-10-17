"use strict";

/**
 * A subscription's app: where to get it, notices about its versions, and a
 * sign-in that lasts.
 *
 *   subscriptions.app_url      where the subscription's app is got from: the
 *                              button subscribers see. Empty until someone
 *                              sets it.
 *   subscription_app_notices   every notice sent to subscribers about a
 *                              version of a platform's app — a new one out, or
 *                              an old one going away — with who sent it, to
 *                              how many, and whether by email too.
 *   app_tokens                 what an app signs in with after the first
 *                              check: one live token per account and device,
 *                              stored only as a hash, ended by its time, a new
 *                              password, a restriction, or the device being
 *                              removed or blocked.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    };
    const points = (model, onDelete, allowNull = false) => ({
      type: Sequelize.INTEGER,
      allowNull,
      references: { model, key: "id" },
      onDelete,
      onUpdate: "CASCADE",
    });

    await queryInterface.addColumn("subscriptions", "app_url", { type: Sequelize.STRING(500), allowNull: true });

    await queryInterface.createTable("subscription_app_notices", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      subscription_id: points("subscriptions", "CASCADE"),
      platform_id: points("subscription_platforms", "CASCADE"),
      kind: { type: Sequelize.STRING(20), allowNull: false },
      version: { type: Sequelize.STRING(40), allowNull: false },
      message: { type: Sequelize.STRING(1000), allowNull: false },
      emailed: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      recipients: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      sent_by_id: points("users", "SET NULL", true),
      ...timestamps,
    });
    await queryInterface.addIndex("subscription_app_notices", ["subscription_id", "created_at"], {
      name: "subscription_app_notices_newest",
    });

    await queryInterface.createTable("app_tokens", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: points("users", "CASCADE"),
      token_hash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      device_id: { type: Sequelize.STRING(128), allowNull: false },
      platform_value: { type: Sequelize.STRING(40), allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      revoked_at: { type: Sequelize.DATE, allowNull: true },
      last_used_at: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex("app_tokens", ["user_id", "device_id"], { name: "app_tokens_by_device" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("app_tokens");
    await queryInterface.dropTable("subscription_app_notices");
    await queryInterface.removeColumn("subscriptions", "app_url");
  },
};
