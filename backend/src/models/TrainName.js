const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A train.
 *
 * The table is still called `train_names` because it began life as a simple
 * lookup and seventeen files reference it by that association alias. Renaming
 * it would be a destructive migration for no functional gain, so it was
 * extended in place instead — the columns below are what turn it from a name
 * into a train.
 *
 * Bangladesh Railway numbers each direction separately (Madhumati runs as 755
 * up and 756 down), so both codes are recorded.
 */
class TrainName extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      name: this.name,
      code: this.code,
      upCode: this.upCode,
      downCode: this.downCode,
      notes: this.notes,
      isActive: this.isActive,
      // Present only when the caller eager-loaded the route.
      stops: this.stops?.map((s) => s.toPublicJSON()),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

TrainName.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false, unique: true },

    /** Display code, e.g. "755/756". */
    code: { type: DataTypes.STRING(20), allowNull: true },
    upCode: { type: DataTypes.STRING(20), allowNull: true },
    downCode: { type: DataTypes.STRING(20), allowNull: true },

    notes: { type: DataTypes.STRING(500), allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  { sequelize, modelName: "TrainName", tableName: "train_names" }
);

TrainName.associate = ({ RouteStop, FareRule, TrainCoach, TrainSchedule, Trip }) => {
  TrainName.hasMany(RouteStop, { foreignKey: "trainId", as: "stops", onDelete: "CASCADE" });
  TrainName.hasMany(FareRule, { foreignKey: "trainId", as: "fareRules" });
  TrainName.hasMany(TrainCoach, { foreignKey: "trainId", as: "coaches", onDelete: "CASCADE" });
  TrainName.hasMany(TrainSchedule, { foreignKey: "trainId", as: "schedules", onDelete: "CASCADE" });
  TrainName.hasMany(Trip, { foreignKey: "trainId", as: "trips", onDelete: "CASCADE" });
};

module.exports = TrainName;
