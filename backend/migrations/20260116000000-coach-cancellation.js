"use strict";

/**
 * Cancelling one coach of a departure (§14.1).
 *
 * `trip_coaches.status` already has `cancelled`, and the sellable-seat query
 * already filters on `active` — so a cancelled coach leaves sale with no
 * further work. What it could not do was say why, or when, or who. A trip
 * records its cancellation reason; a coach cancelled for a broken air
 * conditioner deserves the same, because the passengers moved off it will ask.
 *
 * Additive: three nullable columns, nothing existing touched.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("trip_coaches", "cancellation_reason", {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addColumn("trip_coaches", "cancelled_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn("trip_coaches", "cancelled_by_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "users", key: "id" },
      onDelete: "SET NULL",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("trip_coaches", "cancelled_by_id");
    await queryInterface.removeColumn("trip_coaches", "cancelled_at");
    await queryInterface.removeColumn("trip_coaches", "cancellation_reason");
  },
};
