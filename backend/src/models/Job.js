const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A piece of work done after the request that asked for it (Phase 8B).
 *
 * See the migration for why each column exists. The short version: a job is
 * written before its work starts, claimed under a lease rather than a lock, and
 * retried with backoff — so a mass refund survives a restart part-way through
 * instead of dying with the request that started it.
 */
const JOB_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  /** Gave up after `max_attempts`. Needs a person: retry it, or deal with why. */
  FAILED: "failed",
});

const FINISHED = Object.freeze([JOB_STATUS.SUCCEEDED, JOB_STATUS.FAILED]);

class Job extends Model {
  get isFinished() {
    return FINISHED.includes(this.status);
  }

  toPublicJSON() {
    return {
      id: this.id,
      type: this.type,
      label: this.label,
      status: this.status,
      priority: this.priority,
      attempts: this.attempts,
      maxAttempts: this.maxAttempts,
      runAfter: this.runAfter,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      lastError: this.lastError,
      progress: this.progress,
      result: this.result,
      payload: this.payload,
      createdById: this.createdById,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

Job.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    type: { type: DataTypes.STRING(80), allowNull: false },
    payload: { type: DataTypes.JSON, allowNull: false },

    status: {
      type: DataTypes.ENUM(...Object.values(JOB_STATUS)),
      allowNull: false,
      defaultValue: JOB_STATUS.QUEUED,
    },
    /** Higher runs first. Refunds outrank the messages that describe them. */
    priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    maxAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
    runAfter: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },

    /** "host:pid:boot" of the worker holding it, so an orphan can be recognised. */
    lockedBy: { type: DataTypes.STRING(120), allowNull: true },
    leaseExpiresAt: { type: DataTypes.DATE, allowNull: true },

    startedAt: { type: DataTypes.DATE, allowNull: true },
    finishedAt: { type: DataTypes.DATE, allowNull: true },

    lastError: { type: DataTypes.TEXT, allowNull: true },
    progress: { type: DataTypes.JSON, allowNull: true },
    result: { type: DataTypes.JSON, allowNull: true },

    dedupeKey: { type: DataTypes.STRING(160), allowNull: true },
    /** Said to an operator on the jobs screen, so it is a phrase, not a type name. */
    label: { type: DataTypes.STRING(200), allowNull: true },

    createdById: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    modelName: "Job",
    tableName: "jobs",
    indexes: [
      { fields: ["status", "run_after"] },
      { fields: ["status", "lease_expires_at"] },
      { fields: ["type", "status"] },
      { fields: ["dedupe_key"] },
      { fields: ["created_at"] },
    ],
  }
);

Job.associate = ({ User }) => {
  Job.belongsTo(User, { foreignKey: "createdById", as: "createdBy" });
};

module.exports = Job;
module.exports.JOB_STATUS = JOB_STATUS;
module.exports.FINISHED = FINISHED;
