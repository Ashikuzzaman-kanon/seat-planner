"use strict";

/**
 * Visits to the public Seat Allocation page (/seat-allocation), which anyone
 * may open without signing in.
 *
 *   public_visits      one row per request: when, the visitor's internet
 *                      address and rough location, browser, operating system
 *                      and device, language, the page they came from, a
 *                      random id their browser keeps, who they are if signed
 *                      in, what they searched, how many results, and what
 *                      happened (shown, asked to sign in, turned away…).
 *                      `query_key` is the search in a fixed form, so the free
 *                      searches of a day can be counted. Deleted after the
 *                      number of days set in Settings.
 *   public_visit_days  each day's totals, kept after the visits themselves
 *                      are deleted.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("public_visits", {
      id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true },
      kind: { type: Sequelize.STRING(20), allowNull: false },
      outcome: { type: Sequelize.STRING(20), allowNull: false },
      ip: { type: Sequelize.STRING(64), allowNull: true },
      country: { type: Sequelize.STRING(8), allowNull: true },
      city: { type: Sequelize.STRING(80), allowNull: true },
      visitor_id: { type: Sequelize.STRING(64), allowNull: true },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      user_agent: { type: Sequelize.STRING(400), allowNull: true },
      browser: { type: Sequelize.STRING(40), allowNull: true },
      os: { type: Sequelize.STRING(40), allowNull: true },
      device: { type: Sequelize.STRING(20), allowNull: true },
      language: { type: Sequelize.STRING(60), allowNull: true },
      referrer: { type: Sequelize.STRING(300), allowNull: true },
      query: { type: Sequelize.JSON, allowNull: true },
      query_key: { type: Sequelize.STRING(300), allowNull: true },
      results: { type: Sequelize.INTEGER, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("public_visits", ["created_at"], { name: "public_visits_by_time" });
    await queryInterface.addIndex("public_visits", ["visitor_id", "created_at"], { name: "public_visits_by_visitor" });
    await queryInterface.addIndex("public_visits", ["ip", "created_at"], { name: "public_visits_by_ip" });

    await queryInterface.createTable("public_visit_days", {
      day: { type: Sequelize.DATEONLY, primaryKey: true },
      requests: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      searches: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      visitors: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      prompted: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      blocked: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      journeys: { type: Sequelize.JSON, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("public_visit_days");
    await queryInterface.dropTable("public_visits");
  },
};
