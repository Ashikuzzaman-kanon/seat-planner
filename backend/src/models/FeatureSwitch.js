const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * The switch for one feature (a tab of the app): on, off for everyone, or off
 * for the users and roles in its targets. A feature with no row is on.
 * The features are defined in code (constants/features.js).
 */
class FeatureSwitch extends Model {}

FeatureSwitch.init(
  {
    key: { type: DataTypes.STRING(40), primaryKey: true },
    state: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "on" },
    /** Shown to the people the feature is off for, in place of the page. */
    message: { type: DataTypes.STRING(300), allowNull: true },
    updatedById: { type: DataTypes.INTEGER, allowNull: true },
  },
  { sequelize, modelName: "FeatureSwitch", tableName: "feature_switches" }
);

FeatureSwitch.associate = ({ User, FeatureSwitchTarget }) => {
  FeatureSwitch.belongsTo(User, { foreignKey: "updatedById", as: "updatedBy" });
  FeatureSwitch.hasMany(FeatureSwitchTarget, { foreignKey: "featureKey", as: "targets" });
};

module.exports = FeatureSwitch;
