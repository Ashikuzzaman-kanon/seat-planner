const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Which days of the week a train runs, and over what period.
 *
 * Effective dates rather than a single flag, so a seasonal timetable change is
 * a new row with a start date instead of an edit that silently rewrites
 * history. Trip generation asks which schedule is in force on each date.
 *
 * `runsOn` holds JavaScript day numbers — 0 is Sunday, matching `getDay()`,
 * which is also how the Bangladesh week is usually written down.
 */
class TrainSchedule extends Model {
  /** Does this schedule cover `date` (a YYYY-MM-DD string) at all? */
  coversDate(date) {
    if (!this.isActive) return false;
    if (this.effectiveFrom && date < this.effectiveFrom) return false;
    if (this.effectiveTo && date > this.effectiveTo) return false;
    return true;
  }

  /** Does the train actually run on this weekday? */
  runsOnDay(dayNumber) {
    return Array.isArray(this.runsOn) && this.runsOn.includes(dayNumber);
  }

  toPublicJSON() {
    return {
      id: this.id,
      trainId: this.trainId,
      runsOn: this.runsOn || [],
      effectiveFrom: this.effectiveFrom,
      effectiveTo: this.effectiveTo,
      isActive: this.isActive,
    };
  }
}

TrainSchedule.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    trainId: { type: DataTypes.INTEGER, allowNull: false },

    /** Array of 0–6, Sunday first. An empty array means the train never runs. */
    runsOn: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },

    effectiveFrom: { type: DataTypes.DATEONLY, allowNull: true },
    effectiveTo: { type: DataTypes.DATEONLY, allowNull: true },

    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    sequelize,
    modelName: "TrainSchedule",
    tableName: "train_schedules",
    indexes: [{ fields: ["train_id"] }],
  }
);

TrainSchedule.associate = ({ TrainName }) => {
  TrainSchedule.belongsTo(TrainName, { foreignKey: "trainId", as: "train" });
};

module.exports = TrainSchedule;
