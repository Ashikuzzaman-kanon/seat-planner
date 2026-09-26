"use strict";

/**
 * Standing, on or off, for one departure.
 *
 * Capacity is set per coach class, which is the right place for it — a Shovon
 * coach has floor space and an AC cabin does not, and that is a fact about the
 * class rather than about any particular train.
 *
 * But an operator sometimes needs to stop selling standing on one service
 * without changing what every Shovon coach in the country does: a train already
 * carrying a crowd, a special working, a route with a long tunnel section. This
 * is that switch, and it can only ever be more restrictive than the class.
 *
 * On by default, so nothing changes for departures that already exist.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("trips", "standing_enabled", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("trips", "standing_enabled");
  },
};
