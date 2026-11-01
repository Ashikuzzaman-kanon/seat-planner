"use strict";

/**
 * Continuing a subscription that ended — cancelled, run out, or declined.
 *
 *   user_subscriptions.history       each earlier period of the same record:
 *                                    [{ status, requestedAt, startsAt, lastDay,
 *                                       endedAt, endedById, reason }], oldest
 *                                    first. The record itself carries on.
 *   user_subscriptions.requested_at  when it was last asked for — a record
 *                                    asked for again waits in the queue from
 *                                    then, not from when it was first made.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("user_subscriptions", "history", { type: Sequelize.JSON, allowNull: true });
    await queryInterface.addColumn("user_subscriptions", "requested_at", { type: Sequelize.DATE, allowNull: true });
    await queryInterface.sequelize.query("UPDATE user_subscriptions SET requested_at = created_at");
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("user_subscriptions", "requested_at");
    await queryInterface.removeColumn("user_subscriptions", "history");
  },
};
