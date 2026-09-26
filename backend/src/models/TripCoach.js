const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A coach on one specific departure — copied from the train's default
 * composition when the trip is generated.
 *
 * Copied rather than referenced on purpose: adding or removing a coach is an
 * operation on a single departure, and the record of what actually ran on the
 * 4th must survive any later change to the standard line-up.
 */
const TRIP_COACH_STATUS = Object.freeze({ ACTIVE: "active", CANCELLED: "cancelled" });

class TripCoach extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      tripId: this.tripId,
      position: this.position,
      coachCode: this.coachCode,
      seatPlanId: this.seatPlanId,
      coachClassId: this.coachClassId,
      coachClass: this.coachClass ? { id: this.coachClass.id, name: this.coachClass.name } : undefined,
      seatCount: this.seatCount,
      cancellationReason: this.cancellationReason,
      cancelledAt: this.cancelledAt,
      status: this.status,
    };
  }
}

TripCoach.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tripId: { type: DataTypes.INTEGER, allowNull: false },

    position: { type: DataTypes.INTEGER, allowNull: false },
    coachCode: { type: DataTypes.STRING(10), allowNull: false },

    /** The layout this coach was built from, kept for traceability. */
    seatPlanId: { type: DataTypes.INTEGER, allowNull: false },
    coachClassId: { type: DataTypes.INTEGER, allowNull: false },

    /** Denormalised so a departure listing does not have to count seat rows. */
    seatCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

    status: {
      type: DataTypes.ENUM(...Object.values(TRIP_COACH_STATUS)),
      allowNull: false,
      defaultValue: TRIP_COACH_STATUS.ACTIVE,
    },

    /** Why it was taken out of service — the passengers moved off it will ask. */
    cancellationReason: { type: DataTypes.STRING(500), allowNull: true },
    cancelledAt: { type: DataTypes.DATE, allowNull: true },
    cancelledById: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    modelName: "TripCoach",
    tableName: "trip_coaches",
    indexes: [{ unique: true, fields: ["trip_id", "coach_code"] }],
  }
);

TripCoach.associate = ({ Trip, SeatPlan, CoachClass, TripSeat }) => {
  TripCoach.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  TripCoach.belongsTo(SeatPlan, { foreignKey: "seatPlanId", as: "seatPlan" });
  TripCoach.belongsTo(CoachClass, { foreignKey: "coachClassId", as: "coachClass" });
  TripCoach.hasMany(TripSeat, { foreignKey: "tripCoachId", as: "seats", onDelete: "CASCADE" });
};

module.exports = TripCoach;
module.exports.TRIP_COACH_STATUS = TRIP_COACH_STATUS;
