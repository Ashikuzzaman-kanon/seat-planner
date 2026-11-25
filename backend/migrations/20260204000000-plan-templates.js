"use strict";

/**
 * Seat plan templates.
 *
 *   seat_plans.is_template  a template: a layout kept to start new plans from.
 *                           It keeps its train, coach, type and class as
 *                           labels, but is never in a train's coaches, a
 *                           departure, the seat-plan API or the railway
 *                           loader, and never conflicts with a plan — so a
 *                           plan can be moved here to free its train and
 *                           coach for a new one.
 *
 * Undoing it makes every template a plain plan again; two plans may then
 * share a train and coach, which saving a change to either will point out.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("seat_plans", "is_template", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      after: "status",
    });
    await queryInterface.addIndex("seat_plans", ["is_template"], { name: "seat_plans_by_template" });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("seat_plans", "seat_plans_by_template");
    await queryInterface.removeColumn("seat_plans", "is_template");
  },
};
