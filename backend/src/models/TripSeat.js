const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A single physical seat on a single departure.
 *
 * Seat plans store their layout as one JSON document, which is right for
 * drawing a coach and wrong for selling one. Availability has to ask questions
 * like "which window seats in this class are free between these two stations",
 * and that is a relational question. So at generation time the layout is
 * **flattened into rows** — one per seat — and Phase 4 sells against these.
 *
 * `attributes` carries the seat's features as a document as well, so an
 * attribute added to the catalogue later needs no migration here. The named
 * columns exist because they are the ones availability filters and indexes on.
 */
class TripSeat extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      tripId: this.tripId,
      tripCoachId: this.tripCoachId,
      coachClassId: this.coachClassId,
      seatNumber: this.seatNumber,
      rowIndex: this.rowIndex,
      cellIndex: this.cellIndex,
      isWindow: this.isWindow,
      windowType: this.windowType,
      chargingPort: this.chargingPort,
      fan: this.fan,
      note: this.note,
      attributes: this.attributes || {},
    };
  }
}

TripSeat.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tripId: { type: DataTypes.INTEGER, allowNull: false },
    tripCoachId: { type: DataTypes.INTEGER, allowNull: false },
    coachClassId: { type: DataTypes.INTEGER, allowNull: false },

    seatNumber: { type: DataTypes.STRING(10), allowNull: false },

    /** Where the seat sits in the plan, so a seat map can be redrawn from rows alone. */
    rowIndex: { type: DataTypes.INTEGER, allowNull: false },
    cellIndex: { type: DataTypes.INTEGER, allowNull: false },

    isWindow: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    windowType: { type: DataTypes.STRING(10), allowNull: true },
    chargingPort: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    fan: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    note: { type: DataTypes.STRING(300), allowNull: true },

    attributes: { type: DataTypes.JSON, allowNull: true },
  },
  {
    sequelize,
    modelName: "TripSeat",
    tableName: "trip_seats",
    indexes: [
      { unique: true, fields: ["trip_coach_id", "seat_number"] },
      // The shape availability queries in Phase 4 will actually use.
      { fields: ["trip_id", "coach_class_id"] },
      { fields: ["trip_id", "is_window"] },
    ],
  }
);

TripSeat.associate = ({ Trip, TripCoach, CoachClass }) => {
  TripSeat.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  TripSeat.belongsTo(TripCoach, { foreignKey: "tripCoachId", as: "coach" });
  TripSeat.belongsTo(CoachClass, { foreignKey: "coachClassId", as: "coachClass" });
};

module.exports = TripSeat;
