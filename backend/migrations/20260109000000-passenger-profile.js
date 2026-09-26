"use strict";

/**
 * The account holder's own travel identity.
 *
 * Every ticket already carries its passenger's name, National ID and date of
 * birth, typed in at checkout. That is right for a ticket — one booking can
 * carry four different people — but it means the person buying re-types their
 * own details every single time, and a mistyped digit is only discovered by a
 * ticket checker on a platform.
 *
 * Holding them once on the account makes the common case (booking for
 * yourself) a matter of confirming rather than typing, and gives the railway a
 * verified identity behind each account.
 *
 * Nullable, because every account that already exists predates this. The
 * requirement to fill them in is enforced at the first booking, not by the
 * column.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("users", "nid", {
      type: Sequelize.STRING(17),
      allowNull: true,
    });

    await queryInterface.addColumn("users", "date_of_birth", {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });

    // Looked up when a ticket checker traces a National ID back to an account,
    // and when the abuse scoring in phase 7 asks how many accounts share one.
    // Not unique: a parent may legitimately hold the account a child travels on.
    await queryInterface.addIndex("users", ["nid"], { name: "users_nid" });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("users", "users_nid");
    await queryInterface.removeColumn("users", "date_of_birth");
    await queryInterface.removeColumn("users", "nid");
  },
};
