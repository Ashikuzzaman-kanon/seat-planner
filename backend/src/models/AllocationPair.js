const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One railway train and one from → to pair it was checked for: whether the
 * railway sets seats aside for it, and when that was found. A pair with no
 * row has not been checked.
 */
const ALLOCATION_STATUS = Object.freeze({ ALLOCATED: "allocated", NOT_ALLOCATED: "not_allocated" });
/** census: from an uploaded census file; manual: typed in on the site. */
const ALLOCATION_SOURCE = Object.freeze({ CENSUS: "census", MANUAL: "manual" });

class AllocationPair extends Model {}

AllocationPair.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    trainNumber: { type: DataTypes.INTEGER, allowNull: false },
    fromStation: { type: DataTypes.STRING(100), allowNull: false },
    toStation: { type: DataTypes.STRING(100), allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false },
    checkedAt: { type: DataTypes.DATE, allowNull: true },
    source: { type: DataTypes.STRING(20), allowNull: false },
    updatedById: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    modelName: "AllocationPair",
    tableName: "allocation_pairs",
    indexes: [{ unique: true, fields: ["train_number", "from_station", "to_station"] }],
  }
);

AllocationPair.associate = ({ AllocationClass, AllocationTrain }) => {
  AllocationPair.hasMany(AllocationClass, { foreignKey: "pairId", as: "classes" });
  AllocationPair.belongsTo(AllocationTrain, { foreignKey: "trainNumber", targetKey: "number", as: "train" });
};

module.exports = AllocationPair;
module.exports.ALLOCATION_STATUS = ALLOCATION_STATUS;
module.exports.ALLOCATION_SOURCE = ALLOCATION_SOURCE;
