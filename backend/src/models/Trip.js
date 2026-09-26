const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One departure: a train on a date.
 *
 * This is the object tickets attach to. A ticket is never for "Ekota Express",
 * it is for Ekota Express on the 4th — and cancelling the 4th must not touch
 * the 5th. Every downstream concept in the system hangs off this row.
 *
 * `departureDate` is the date the train leaves its **origin**. Stops reached
 * after midnight are found by adding the route stop's day offset.
 */
const TRIP_STATUS = Object.freeze({
  SCHEDULED: "scheduled",
  CANCELLED: "cancelled",
  DEPARTED: "departed",
  COMPLETED: "completed",
});

class Trip extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      trainId: this.trainId,
      train: this.train ? { id: this.train.id, name: this.train.name, code: this.train.code } : undefined,
      departureDate: this.departureDate,
      status: this.status,
      cancellationReason: this.cancellationReason,
      generatedAt: this.generatedAt,

      // Which return policies this departure offers. Both on unless someone
      // with the permission has turned one off.
      convenientReturnEnabled: this.convenientReturnEnabled,
      demandReturnEnabled: this.demandReturnEnabled,
      standingEnabled: this.standingEnabled,
      coaches: this.coaches?.map((c) => c.toPublicJSON()),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

Trip.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    trainId: { type: DataTypes.INTEGER, allowNull: false },

    departureDate: { type: DataTypes.DATEONLY, allowNull: false },

    status: {
      type: DataTypes.ENUM(...Object.values(TRIP_STATUS)),
      allowNull: false,
      defaultValue: TRIP_STATUS.SCHEDULED,
    },
    cancellationReason: { type: DataTypes.STRING(500), allowNull: true },

    generatedAt: { type: DataTypes.DATE, allowNull: true },

    /**
     * Per-departure control over the two passenger-facing return policies.
     *
     * Global settings decide how much each one deducts; these decide whether it
     * is offered here at all. A train that always sells out gains nothing from
     * a demand-based return, and one being wound down may want to stop
     * accepting returns without stopping sales.
     */
    convenientReturnEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    demandReturnEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

    /**
     * Whether connecting standing may be sold on this departure at all (§10).
     *
     * How many may stand is a property of the coach class; whether it happens
     * on this particular service is an operational call — a train already
     * carrying a crowd, or a working where standing is unsafe. This switch can
     * only restrict what the class allows, never extend it.
     */
    standingEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    sequelize,
    modelName: "Trip",
    tableName: "trips",
    indexes: [
      // Also the guard that makes generation idempotent — a second run cannot
      // create a duplicate departure.
      { unique: true, fields: ["train_id", "departure_date"] },
      { fields: ["departure_date"] },
    ],
  }
);

Trip.associate = ({ TrainName, TripCoach, TripSeat }) => {
  Trip.belongsTo(TrainName, { foreignKey: "trainId", as: "train" });
  Trip.hasMany(TripCoach, { foreignKey: "tripId", as: "coaches", onDelete: "CASCADE" });
  Trip.hasMany(TripSeat, { foreignKey: "tripId", as: "seats", onDelete: "CASCADE" });
};

module.exports = Trip;
module.exports.TRIP_STATUS = TRIP_STATUS;
