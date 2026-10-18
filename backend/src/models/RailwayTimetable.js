const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A timetable fetched from the railway by "Check with the railway"
 * (services/railwaySyncService): what it published, what it would change
 * here, and — once applied — what was done. The newest applied one is the
 * timetable Load works from.
 */
const TIMETABLE_STATUS = Object.freeze({ CHECKED: "checked", APPLIED: "applied" });

class RailwayTimetable extends Model {
  /** The timetable itself, in the shape of the committed snapshot. */
  asSnapshot() {
    return { source: this.source, requestedFor: this.requestedFor, fetchedAt: this.fetchedAt.toISOString(), trains: this.trains };
  }

  toPublicJSON() {
    const who = (u) => (u ? { id: u.id, fullName: u.fullName } : null);
    return {
      id: this.id,
      status: this.status,
      requestedFor: this.requestedFor,
      fetchedAt: this.fetchedAt,
      // Left out when listed without the timetable itself.
      trains: Array.isArray(this.trains) ? this.trains.length : undefined,
      unpublished: this.unpublished,
      failed: this.failed,
      diff: this.diff,
      report: this.report,
      checkedBy: who(this.checkedBy),
      appliedBy: who(this.appliedBy),
      appliedAt: this.appliedAt,
    };
  }
}

RailwayTimetable.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    status: { type: DataTypes.STRING(20), allowNull: false },
    source: { type: DataTypes.STRING(300), allowNull: false },
    requestedFor: { type: DataTypes.DATEONLY, allowNull: false },
    fetchedAt: { type: DataTypes.DATE, allowNull: false },
    trains: { type: DataTypes.JSON, allowNull: false },
    unpublished: { type: DataTypes.JSON, allowNull: false },
    failed: { type: DataTypes.JSON, allowNull: false },
    diff: { type: DataTypes.JSON, allowNull: false },
    report: { type: DataTypes.JSON, allowNull: true },
    checkedById: { type: DataTypes.INTEGER, allowNull: true },
    appliedById: { type: DataTypes.INTEGER, allowNull: true },
    appliedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    modelName: "RailwayTimetable",
    tableName: "railway_timetables",
    indexes: [{ fields: ["status", "id"] }],
  }
);

RailwayTimetable.associate = ({ User }) => {
  RailwayTimetable.belongsTo(User, { foreignKey: "checkedById", as: "checkedBy" });
  RailwayTimetable.belongsTo(User, { foreignKey: "appliedById", as: "appliedBy" });
};

module.exports = RailwayTimetable;
module.exports.TIMETABLE_STATUS = TIMETABLE_STATUS;
