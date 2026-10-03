"use strict";

/**
 * Let a draft seat plan be saved before anyone knows which train, coach type,
 * class or coach number it belongs to — a layout transcribed from a diagram
 * that names no train is still worth keeping. Submitting a plan for approval
 * is where those become required (services/seatPlanService.js).
 *
 * Plain MODIFY statements: the foreign keys on these columns stay exactly as
 * they are, only NOT NULL is dropped.
 */
const COLUMNS = [
  ["coach_no", "VARCHAR(255)"],
  ["train_name_id", "INT"],
  ["coach_type_id", "INT"],
  ["coach_class_id", "INT"],
];

module.exports = {
  async up(queryInterface) {
    for (const [column, type] of COLUMNS) {
      await queryInterface.sequelize.query(`ALTER TABLE seat_plans MODIFY ${column} ${type} NULL`);
    }
  },

  async down(queryInterface) {
    const [[{ incomplete }]] = await queryInterface.sequelize.query(
      `SELECT COUNT(*) AS incomplete FROM seat_plans WHERE ${COLUMNS.map(([c]) => `${c} IS NULL`).join(" OR ")}`
    );
    if (Number(incomplete) > 0) {
      throw new Error(
        `${incomplete} draft seat plan(s) have no train, coach type, class or coach number. ` +
          "Fill those in or delete the drafts before undoing this migration."
      );
    }
    for (const [column, type] of COLUMNS) {
      await queryInterface.sequelize.query(`ALTER TABLE seat_plans MODIFY ${column} ${type} NOT NULL`);
    }
  },
};
