"use strict";

/**
 * Durable jobs (Phase 8B).
 *
 * Work too big to trust to one request — cancelling a departure refunds every
 * ticket on it — goes into this table first and is done by a worker from here.
 * A request that dies part-way, or a process that restarts in the middle of a
 * mass refund, leaves the job behind; the next worker to look finds it and
 * carries on.
 *
 * ## The columns that make that true
 *
 * - `status` + `run_after`: what is due. A failed attempt goes back to
 *   `queued` with `run_after` pushed out, so retries need no second mechanism.
 * - `locked_by` + `lease_expires_at`: who is working on it, and until when. A
 *   worker renews its lease while it runs; one that dies stops renewing, the
 *   lease lapses, and the job is claimable again. No lock is held in the
 *   database while the work happens, so a dead worker cannot leave one behind.
 * - `attempts` / `max_attempts`: when to stop retrying and call it failed, so a
 *   job that can never succeed is surfaced to a person instead of looping.
 * - `dedupe_key`: one live job per subject — two clicks on "cancel" do not
 *   queue two mass refunds.
 *
 * Additive: one new table, nothing existing touched.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("jobs", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },

      type: { type: Sequelize.STRING(80), allowNull: false },
      payload: { type: Sequelize.JSON, allowNull: false },

      status: {
        type: Sequelize.ENUM("queued", "running", "succeeded", "failed"),
        allowNull: false,
        defaultValue: "queued",
      },
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },

      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      max_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 5 },
      run_after: { type: Sequelize.DATE, allowNull: false },

      locked_by: { type: Sequelize.STRING(120), allowNull: true },
      lease_expires_at: { type: Sequelize.DATE, allowNull: true },

      started_at: { type: Sequelize.DATE, allowNull: true },
      finished_at: { type: Sequelize.DATE, allowNull: true },

      last_error: { type: Sequelize.TEXT, allowNull: true },
      progress: { type: Sequelize.JSON, allowNull: true },
      result: { type: Sequelize.JSON, allowNull: true },

      dedupe_key: { type: Sequelize.STRING(160), allowNull: true },
      label: { type: Sequelize.STRING(200), allowNull: true },

      created_by_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },

      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // "What is due" — asked every couple of seconds by every worker.
    await queryInterface.addIndex("jobs", ["status", "run_after"]);
    await queryInterface.addIndex("jobs", ["status", "lease_expires_at"]);
    await queryInterface.addIndex("jobs", ["type", "status"]);
    await queryInterface.addIndex("jobs", ["dedupe_key"]);
    await queryInterface.addIndex("jobs", ["created_at"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("jobs");
  },
};
