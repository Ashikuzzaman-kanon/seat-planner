const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One stop on a train's route.
 *
 * `dayOffset` is what makes overnight trains work: a train leaving at 23:30
 * with offset 0 reaches a later stop at 06:00 with offset 1. Without it, every
 * arrival time on a night train sorts before its own departure.
 *
 * `distanceKm` is cumulative from the origin, which is what the distance-based
 * fare rule measures against.
 */
class RouteStop extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      trainId: this.trainId,
      sequence: this.sequence,
      stationId: this.stationId,
      station: this.station ? this.station.toPublicJSON() : undefined,
      arrivalTime: this.arrivalTime,
      departureTime: this.departureTime,
      dayOffset: this.dayOffset,
      distanceKm: this.distanceKm === null ? null : Number(this.distanceKm),
      haltMinutes: this.haltMinutes,
    };
  }
}

RouteStop.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    trainId: { type: DataTypes.INTEGER, allowNull: false },
    stationId: { type: DataTypes.INTEGER, allowNull: false },

    /** 1-based position along the route. */
    sequence: { type: DataTypes.INTEGER, allowNull: false },

    /** Null at the origin (nothing arrives) and at the terminus (nothing departs). */
    arrivalTime: { type: DataTypes.TIME, allowNull: true },
    departureTime: { type: DataTypes.TIME, allowNull: true },

    /** Days after the origin's departure date. 0 for a same-day stop. */
    dayOffset: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

    /** Cumulative kilometres from the origin. */
    distanceKm: { type: DataTypes.DECIMAL(8, 2), allowNull: true },

    haltMinutes: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    modelName: "RouteStop",
    tableName: "route_stops",
    indexes: [
      { unique: true, fields: ["train_id", "sequence"] },
      { unique: true, fields: ["train_id", "station_id"] },
    ],
  }
);

RouteStop.associate = ({ TrainName, Station }) => {
  RouteStop.belongsTo(TrainName, { foreignKey: "trainId", as: "train" });
  RouteStop.belongsTo(Station, { foreignKey: "stationId", as: "station" });
};

module.exports = RouteStop;
