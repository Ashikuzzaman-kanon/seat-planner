"use strict";

/**
 * How many devices a subscription may be used on.
 *
 *   subscription_platforms  the kinds of device there are — "windows",
 *                           "android" — as data, so a new kind is a row and
 *                           not a deploy. `value` is what a caller sends as
 *                           `platform`, and never changes once made.
 *   user_subscriptions      gains `device_limits`: how many devices of each
 *                           platform this person's subscription allows, as
 *                           { "<platform id>": count }. Asked for when
 *                           subscribing, settled by whoever approves.
 *   user_devices            the devices seen on an account, in the order they
 *                           first checked in. That order is the rule: a
 *                           subscription allowing two Windows devices is valid
 *                           on the account's first two.
 *   user_device_refusals    the checks that were turned away, and why. The
 *                           caller is told only `valid: false`; the reason
 *                           lives here, for staff. One row per device and
 *                           reason with a count, so a device trying a thousand
 *                           times is still one row.
 *
 * Starts with two platforms, and gives every existing subscription one device
 * of each — nobody already subscribed is locked out by this arriving.
 *
 * Additive: three new tables and one nullable column.
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
    const now = new Date();

    await queryInterface.createTable("subscription_platforms", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      value: { type: Sequelize.STRING(40), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(60), allowNull: false },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_by_id: user(true, "SET NULL"),
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.bulkInsert("subscription_platforms", [
      { value: "windows", name: "Windows", is_active: true, created_at: now, updated_at: now },
      { value: "android", name: "Android", is_active: true, created_at: now, updated_at: now },
    ]);

    await queryInterface.addColumn("user_subscriptions", "device_limits", { type: Sequelize.JSON, allowNull: true });
    const platforms = await queryInterface.sequelize.query("SELECT id FROM subscription_platforms ORDER BY id", {
      type: Sequelize.QueryTypes.SELECT,
    });
    const oneOfEach = Object.fromEntries(platforms.map((p) => [String(p.id), 1]));
    await queryInterface.sequelize.query("UPDATE user_subscriptions SET device_limits = :limits", {
      replacements: { limits: JSON.stringify(oneOfEach) },
    });

    await queryInterface.createTable("user_devices", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: user(false, "CASCADE"),
      platform_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "subscription_platforms", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      device_id: { type: Sequelize.STRING(128), allowNull: false },
      note: { type: Sequelize.STRING(200), allowNull: true },
      is_blocked: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      last_seen_at: { type: Sequelize.DATE, allowNull: false },
      checks: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("user_devices", ["user_id", "platform_id", "device_id"], {
      unique: true,
      name: "user_devices_one_each",
    });

    await queryInterface.createTable("user_device_refusals", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: user(false, "CASCADE"),
      // As the caller sent them, cut to fit — empty when it sent none.
      platform_value: { type: Sequelize.STRING(40), allowNull: false, defaultValue: "" },
      device_id: { type: Sequelize.STRING(128), allowNull: false, defaultValue: "" },
      reason: { type: Sequelize.STRING(32), allowNull: false },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      last_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("user_device_refusals", ["user_id", "reason", "platform_value", "device_id"], {
      unique: true,
      name: "user_device_refusals_one_each",
    });
    // Reading one account's newest, and pruning everyone's oldest.
    await queryInterface.addIndex("user_device_refusals", ["user_id", "last_at"], { name: "user_device_refusals_user_newest" });
    await queryInterface.addIndex("user_device_refusals", ["last_at"], { name: "user_device_refusals_age" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("user_device_refusals");
    await queryInterface.dropTable("user_devices");
    await queryInterface.removeColumn("user_subscriptions", "device_limits");
    await queryInterface.dropTable("subscription_platforms");
  },
};
