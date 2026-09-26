"use strict";

/**
 * Per-departure control over which return policies are offered.
 *
 * Both default to on, so every departure already generated keeps behaving
 * exactly as it did. Switching one off is a deliberate act by someone holding
 * the permission — a train that always sells out has no need to offer a
 * demand-based return, and one being wound down may want to stop accepting
 * convenient returns without stopping sales.
 *
 * Additive per §16.3: two nullable-with-default columns and nothing altered.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("trips", "convenient_return_enabled", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });

    await queryInterface.addColumn("trips", "demand_return_enabled", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });

    // `disruption` joins the refund types a row may carry. Widening keeps every
    // refund already recorded readable.
    await queryInterface.changeColumn("refunds", "type", {
      type: Sequelize.STRING(20),
      allowNull: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("trips", "convenient_return_enabled");
    await queryInterface.removeColumn("trips", "demand_return_enabled");
  },
};
