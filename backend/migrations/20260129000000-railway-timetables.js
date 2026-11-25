"use strict";

/**
 * Timetables fetched from the railway by a running server.
 *
 *   railway_timetables   each check with the railway: what it published
 *                        (`trains`, as the API sent them), what it would
 *                        change here (`diff`), and — once applied — what was
 *                        done (`report`). The newest applied one is the
 *                        timetable Load works from, in place of the snapshot
 *                        committed with the code, so loading again never puts
 *                        an older timetable back.
 *
 * `status`: checked (waiting to be reviewed and applied) or applied. A newer
 * check replaces one that was never applied.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const user = {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "users", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    };
    await queryInterface.createTable("railway_timetables", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      status: { type: Sequelize.STRING(20), allowNull: false },
      source: { type: Sequelize.STRING(300), allowNull: false },
      requested_for: { type: Sequelize.DATEONLY, allowNull: false },
      fetched_at: { type: Sequelize.DATE, allowNull: false },
      trains: { type: Sequelize.JSON, allowNull: false },
      unpublished: { type: Sequelize.JSON, allowNull: false },
      failed: { type: Sequelize.JSON, allowNull: false },
      diff: { type: Sequelize.JSON, allowNull: false },
      report: { type: Sequelize.JSON, allowNull: true },
      checked_by_id: user,
      applied_by_id: user,
      applied_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("railway_timetables", ["status", "id"], { name: "railway_timetables_by_status" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("railway_timetables");
  },
};
