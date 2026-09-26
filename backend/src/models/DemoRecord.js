const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One row the demo data created — see the migration, and `utils/demoCapture`
 * for how these are written without the seeding code knowing about them.
 */
class DemoRecord extends Model {}

DemoRecord.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    model: { type: DataTypes.STRING(64), allowNull: false },
    recordId: { type: DataTypes.INTEGER, allowNull: false },
  },
  {
    sequelize,
    modelName: "DemoRecord",
    tableName: "demo_records",
    updatedAt: false,
    indexes: [{ fields: ["model", "record_id"] }],
  }
);

module.exports = DemoRecord;
