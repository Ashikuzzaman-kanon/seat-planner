const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A class with seats on an allocated pair, by the railway's code (S_CHAIR,
 * SNIGDHA…), and how many. `seats` is null while the count is not known —
 * which is not the same as 0.
 */
class AllocationClass extends Model {}

AllocationClass.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    pairId: { type: DataTypes.INTEGER, allowNull: false },
    classCode: { type: DataTypes.STRING(20), allowNull: false },
    seats: { type: DataTypes.INTEGER, allowNull: true },
    updatedById: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    modelName: "AllocationClass",
    tableName: "allocation_classes",
    indexes: [{ unique: true, fields: ["pair_id", "class_code"] }],
  }
);

module.exports = AllocationClass;
