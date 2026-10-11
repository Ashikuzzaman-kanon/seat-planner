"use strict";

/**
 * Subscriptions: something a person can ask to be subscribed to, and each
 * person's subscription to it from request to end.
 *
 * `user_subscriptions` holds one row per request and never reuses it — a
 * request that was declined, a subscription that ran out and the one that
 * followed it are three rows — so the history of who decided what stays.
 *
 * `live_key` is "<user>:<subscription>" while a row is pending or active and
 * NULL once it has ended. MySQL allows any number of NULLs under a unique
 * index, so the database itself guarantees a person has at most one live
 * subscription to a thing, however many requests arrive at once.
 *
 * `expires_at` is the first instant the subscription is no longer valid: the
 * start of the day after its last day, in Dhaka.
 *
 * Additive: two new tables.
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

    await queryInterface.createTable("subscriptions", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      code: { type: Sequelize.STRING(40), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(100), allowNull: false, unique: true },
      description: { type: Sequelize.STRING(500), allowNull: true },
      is_open: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_by_id: user(true, "SET NULL"),
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable("user_subscriptions", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      subscription_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "subscriptions", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      user_id: user(false, "CASCADE"),
      status: {
        type: Sequelize.ENUM("pending", "active", "declined", "cancelled", "expired"),
        allowNull: false,
        defaultValue: "pending",
      },
      live_key: { type: Sequelize.STRING(40), allowNull: true },

      decided_by_id: user(true, "SET NULL"),
      decided_at: { type: Sequelize.DATE, allowNull: true },
      decision_note: { type: Sequelize.STRING(500), allowNull: true },

      starts_at: { type: Sequelize.DATE, allowNull: true },
      expires_at: { type: Sequelize.DATE, allowNull: true },
      reminded_at: { type: Sequelize.DATE, allowNull: true },

      ended_by_id: user(true, "SET NULL"),
      ended_at: { type: Sequelize.DATE, allowNull: true },
      end_reason: { type: Sequelize.STRING(500), allowNull: true },

      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex("user_subscriptions", ["live_key"], {
      unique: true,
      name: "user_subscriptions_live",
    });
    // "What does this person hold" — asked by the page and by the check API.
    await queryInterface.addIndex("user_subscriptions", ["user_id", "status"], {
      name: "user_subscriptions_user_status",
    });
    // The request queue and the subscriber list.
    await queryInterface.addIndex("user_subscriptions", ["subscription_id", "status"], {
      name: "user_subscriptions_subscription_status",
    });
    // The hourly sweep finding what has run out.
    await queryInterface.addIndex("user_subscriptions", ["status", "expires_at"], {
      name: "user_subscriptions_status_expires",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("user_subscriptions");
    await queryInterface.dropTable("subscriptions");
  },
};
