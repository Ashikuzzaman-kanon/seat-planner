"use strict";

/**
 * When a long-departed train's unsold seats were cleared, and how many.
 *
 * Every seat of every departure is a row, and on a small database the seats
 * nobody bought on a train that left months ago are most of what it holds. The
 * daily sweep (services/seatRetentionService.js) deletes those rows — never a
 * seat a ticket or a refund points at — and notes it here, so the departure
 * says why its seat map is sparse and cannot be rebuilt into something it was
 * not.
 *
 * Additive: two nullable columns.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("trips", "seats_cleared_at", { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn("trips", "seats_cleared", { type: Sequelize.INTEGER, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("trips", "seats_cleared");
    await queryInterface.removeColumn("trips", "seats_cleared_at");
  },
};
