"use strict";

/**
 * Changing an approved seat plan, and seat plans for subscribers.
 *
 *   seat_plans.revision_of_id        set on an editable copy of an approved
 *                                    plan. The approved plan keeps being used
 *                                    until the copy is approved; then the copy's
 *                                    content replaces it and the copy goes. A
 *                                    copy goes with its plan if that is deleted.
 *   subscriptions.includes_seat_plans whether holding this subscription lets an
 *                                    app outside fetch seat plans. Off for every
 *                                    subscription to begin with.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("seat_plans", "revision_of_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "seat_plans", key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    // One copy at a time per plan, even if Edit is pressed twice at once.
    await queryInterface.addIndex("seat_plans", ["revision_of_id"], { unique: true, name: "seat_plans_one_revision" });
    await queryInterface.addColumn("subscriptions", "includes_seat_plans", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("subscriptions", "includes_seat_plans");
    // Copies are not plans of their own; they go with the column.
    await queryInterface.sequelize.query("DELETE FROM seat_plans WHERE revision_of_id IS NOT NULL");
    await queryInterface.removeColumn("seat_plans", "revision_of_id");
  },
};
