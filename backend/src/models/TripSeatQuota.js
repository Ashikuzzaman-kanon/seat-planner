const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A specific seat on a specific departure, held back for one station pair.
 *
 * Absence is the default: a seat with no row here is **open**, sellable for any
 * stretch of the route. A seat with a row sells only as exactly that pair,
 * until `releaseAt` passes or someone releases it by hand — after which it
 * behaves as open again.
 */
class TripSeatQuota extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      tripId: this.tripId,
      tripSeatId: this.tripSeatId,
      fromStationId: this.fromStationId,
      toStationId: this.toStationId,
      releaseAt: this.releaseAt,
      releasedAt: this.releasedAt,
      ruleId: this.ruleId,
      isReleased: Boolean(this.releasedAt) || (this.releaseAt && this.releaseAt <= new Date()),
    };
  }
}

TripSeatQuota.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tripId: { type: DataTypes.INTEGER, allowNull: false },

    /** One reservation per seat: a seat cannot be held for two pairs at once. */
    tripSeatId: { type: DataTypes.INTEGER, allowNull: false, unique: true },

    fromStationId: { type: DataTypes.INTEGER, allowNull: false },
    toStationId: { type: DataTypes.INTEGER, allowNull: false },

    /** When it falls back to open sale. Null means it never does. */
    releaseAt: { type: DataTypes.DATE, allowNull: true },
    releasedAt: { type: DataTypes.DATE, allowNull: true },

    /** Which standing rule produced this, if any. Null for a hand-placed hold. */
    ruleId: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    modelName: "TripSeatQuota",
    tableName: "trip_seat_quotas",
    indexes: [
      { unique: true, fields: ["trip_seat_id"] },
      // The release job scans on exactly this.
      { fields: ["release_at", "released_at"] },
      { fields: ["trip_id"] },
    ],
  }
);

TripSeatQuota.associate = ({ Trip, TripSeat, Station, TrainQuotaRule }) => {
  TripSeatQuota.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  TripSeatQuota.belongsTo(TripSeat, { foreignKey: "tripSeatId", as: "seat" });
  TripSeatQuota.belongsTo(Station, { foreignKey: "fromStationId", as: "fromStation" });
  TripSeatQuota.belongsTo(Station, { foreignKey: "toStationId", as: "toStation" });
  TripSeatQuota.belongsTo(TrainQuotaRule, { foreignKey: "ruleId", as: "rule" });
};

module.exports = TripSeatQuota;
