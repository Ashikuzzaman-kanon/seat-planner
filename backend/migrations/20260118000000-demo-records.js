"use strict";

/**
 * Demo data bookkeeping.
 *
 * The super admin can fill an empty system with demonstration data — accounts,
 * seat plans, a network, departures, sample bookings — and take it away again.
 * "Take it away" must mean exactly what the demo put there and nothing else,
 * on a database that real people are also using. So every row the demo
 * creates is written down here, in the same transaction that created it: the
 * list is what gets deleted, and anything not on it is never touched.
 *
 * `model` is the Sequelize model name rather than the table name, because the
 * deletion goes back through the model.
 *
 * Additive: one new table, nothing existing touched.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("demo_records", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      model: { type: Sequelize.STRING(64), allowNull: false },
      record_id: { type: Sequelize.INTEGER, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex("demo_records", ["model", "record_id"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("demo_records");
  },
};
