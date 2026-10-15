const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One subscription's rules for the version of one platform's app making the
 * subscription check (services/appVersionService): whether the check must say
 * which version is calling, and the oldest version still accepted. Single
 * versions can be blocked too (SubscriptionVersionBlock).
 *
 * A row exists only once someone sets something; a subscription with no row
 * for a platform has no rules there, and accepts any version or none.
 */
class SubscriptionVersionRule extends Model {}

SubscriptionVersionRule.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    subscriptionId: { type: DataTypes.INTEGER, allowNull: false },
    platformId: { type: DataTypes.INTEGER, allowNull: false },
    versionRequired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    minVersion: { type: DataTypes.STRING(40), allowNull: true },
  },
  {
    sequelize,
    modelName: "SubscriptionVersionRule",
    tableName: "subscription_version_rules",
    indexes: [{ unique: true, fields: ["subscription_id", "platform_id"] }],
  }
);

SubscriptionVersionRule.associate = ({ Subscription, SubscriptionPlatform, SubscriptionVersionBlock }) => {
  SubscriptionVersionRule.belongsTo(Subscription, { foreignKey: "subscriptionId", as: "subscription" });
  SubscriptionVersionRule.belongsTo(SubscriptionPlatform, { foreignKey: "platformId", as: "platform" });
  SubscriptionVersionRule.hasMany(SubscriptionVersionBlock, { foreignKey: "ruleId", as: "blocks" });
};

module.exports = SubscriptionVersionRule;
