const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One coach in a train's **default** composition — the line-up it normally
 * runs with.
 *
 * This is a template, not an inventory record. Each generated departure copies
 * it into `trip_coaches`, so pulling a coach off Tuesday's train never touches
 * Wednesday's.
 *
 * The coach's class and layout both come from the seat plan it points at, so
 * there is nothing to keep in sync.
 */
class TrainCoach extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      trainId: this.trainId,
      position: this.position,
      coachCode: this.coachCode,
      seatPlanId: this.seatPlanId,
      seatPlan: this.seatPlan
        ? {
            id: this.seatPlan.id,
            coachNo: this.seatPlan.coachNo,
            status: this.seatPlan.status,
            coachClass: this.seatPlan.coachClass
              ? { id: this.seatPlan.coachClass.id, name: this.seatPlan.coachClass.name }
              : null,
            coachType: this.seatPlan.coachType
              ? { id: this.seatPlan.coachType.id, name: this.seatPlan.coachType.name }
              : null,
          }
        : undefined,
      isActive: this.isActive,
    };
  }
}

TrainCoach.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    trainId: { type: DataTypes.INTEGER, allowNull: false },
    seatPlanId: { type: DataTypes.INTEGER, allowNull: false },

    /** Order along the rake, from the engine back. */
    position: { type: DataTypes.INTEGER, allowNull: false },

    /** Operating letter passengers see on the side of the coach, e.g. "KA", "GHA". */
    coachCode: { type: DataTypes.STRING(10), allowNull: false },

    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    sequelize,
    modelName: "TrainCoach",
    tableName: "train_coaches",
    indexes: [
      { unique: true, fields: ["train_id", "position"] },
      { unique: true, fields: ["train_id", "coach_code"] },
    ],
  }
);

TrainCoach.associate = ({ TrainName, SeatPlan }) => {
  TrainCoach.belongsTo(TrainName, { foreignKey: "trainId", as: "train" });
  TrainCoach.belongsTo(SeatPlan, { foreignKey: "seatPlanId", as: "seatPlan" });
};

module.exports = TrainCoach;
