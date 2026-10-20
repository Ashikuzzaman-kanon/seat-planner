const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/** One user or one role a feature is switched off for (state `off_some`). */
class FeatureSwitchTarget extends Model {}

FeatureSwitchTarget.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    featureKey: { type: DataTypes.STRING(40), allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: true },
    roleId: { type: DataTypes.INTEGER, allowNull: true },
  },
  { sequelize, modelName: "FeatureSwitchTarget", tableName: "feature_switch_targets" }
);

FeatureSwitchTarget.associate = ({ User, Role }) => {
  FeatureSwitchTarget.belongsTo(User, { foreignKey: "userId", as: "user" });
  FeatureSwitchTarget.belongsTo(Role, { foreignKey: "roleId", as: "role" });
};

module.exports = FeatureSwitchTarget;
