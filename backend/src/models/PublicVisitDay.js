const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/** A day's totals for the seat allocation requests of one channel (public, app), kept after the requests are deleted. */
class PublicVisitDay extends Model {}

PublicVisitDay.init(
  {
    day: { type: DataTypes.DATEONLY, primaryKey: true },
    channel: { type: DataTypes.STRING(10), primaryKey: true, defaultValue: "public" },
    requests: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    searches: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    visitors: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    prompted: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    blocked: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    /** The most searched journeys that day: [{ journey, searches }]. */
    journeys: { type: DataTypes.JSON, allowNull: true },
  },
  { sequelize, modelName: "PublicVisitDay", tableName: "public_visit_days" }
);

module.exports = PublicVisitDay;
