const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A railway train as the seat-allocation data knows it (see the migration
 * 20260131000000-seat-allocation): the railway's number and name, and its
 * stations in order once a route file has been uploaded. Not the site's
 * trains, and never linked to them.
 */
class AllocationTrain extends Model {}

AllocationTrain.init(
  {
    number: { type: DataTypes.INTEGER, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    /** Station names in the order the train reaches them, or null if not uploaded yet. */
    stops: { type: DataTypes.JSON, allowNull: true },
    stopsUpdatedAt: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, modelName: "AllocationTrain", tableName: "allocation_trains" }
);

module.exports = AllocationTrain;
