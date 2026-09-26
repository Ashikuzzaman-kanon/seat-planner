const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/** One explicit station-pair price inside a `table` fare rule. */
class FareTableEntry extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      fareRuleId: this.fareRuleId,
      fromStationId: this.fromStationId,
      toStationId: this.toStationId,
      fromStation: this.fromStation ? this.fromStation.toPublicJSON() : undefined,
      toStation: this.toStation ? this.toStation.toPublicJSON() : undefined,
      amount: Number(this.amount),
    };
  }
}

FareTableEntry.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    fareRuleId: { type: DataTypes.INTEGER, allowNull: false },
    fromStationId: { type: DataTypes.INTEGER, allowNull: false },
    toStationId: { type: DataTypes.INTEGER, allowNull: false },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  },
  {
    sequelize,
    modelName: "FareTableEntry",
    tableName: "fare_table_entries",
    indexes: [
      { unique: true, fields: ["fare_rule_id", "from_station_id", "to_station_id"] },
    ],
  }
);

FareTableEntry.associate = ({ FareRule, Station }) => {
  FareTableEntry.belongsTo(FareRule, { foreignKey: "fareRuleId", as: "rule" });
  FareTableEntry.belongsTo(Station, { foreignKey: "fromStationId", as: "fromStation" });
  FareTableEntry.belongsTo(Station, { foreignKey: "toStationId", as: "toStation" });
};

module.exports = FareTableEntry;
