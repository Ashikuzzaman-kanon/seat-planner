"use strict";

/**
 * A pause on password attempts after too many wrong ones in a row.
 *
 * Until now nothing limited guessing: /auth/login answered every attempt, and
 * the subscription check API is a second place a password can be tried. The
 * count lives on the account rather than against the caller's address because
 * the site's traffic all arrives through its hosting proxy, so the API cannot
 * tell one caller's address from another's.
 *
 * Additive: three columns, all with defaults, so existing accounts start
 * unlocked with no failures.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("users", "failed_sign_ins", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn("users", "last_failed_sign_in_at", { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn("users", "locked_until", { type: Sequelize.DATE, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("users", "locked_until");
    await queryInterface.removeColumn("users", "last_failed_sign_in_at");
    await queryInterface.removeColumn("users", "failed_sign_ins");
  },
};
