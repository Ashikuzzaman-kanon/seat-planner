"use strict";

/**
 * In-app notifications: what happened that a person should know about, kept
 * where they will see it the next time they open the app — whether or not an
 * email reached them.
 *
 * `dedupe_key` makes writing one idempotent per person: a queued job that is
 * retried after its email failed must not leave a second copy in the inbox.
 * MySQL allows any number of NULLs under a unique index, so a notification
 * with no key is never refused.
 *
 * Additive: one new table.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("notifications", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      type: { type: Sequelize.STRING(64), allowNull: false },
      category: { type: Sequelize.STRING(32), allowNull: false },
      tone: {
        type: Sequelize.ENUM("info", "success", "warning", "danger", "neutral"),
        allowNull: false,
        defaultValue: "info",
      },
      title: { type: Sequelize.STRING(200), allowNull: false },
      body: { type: Sequelize.STRING(1000), allowNull: true },
      link: { type: Sequelize.STRING(300), allowNull: true },
      dedupe_key: { type: Sequelize.STRING(150), allowNull: true },
      read_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex("notifications", ["user_id", "dedupe_key"], {
      unique: true,
      name: "notifications_user_dedupe",
    });
    // The inbox reads newest first, and the bell counts what is unread.
    await queryInterface.addIndex("notifications", ["user_id", "id"], { name: "notifications_user_newest" });
    await queryInterface.addIndex("notifications", ["user_id", "read_at"], { name: "notifications_user_unread" });
    // Pruning old notifications scans by age.
    await queryInterface.addIndex("notifications", ["created_at"], { name: "notifications_created" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("notifications");
  },
};
