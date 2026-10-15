const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A version of one platform's app that the subscription check turns away,
 * whatever the platform's minimum version says — a release with a fault in it,
 * say, when the ones either side of it are fine.
 *
 * `version` is stored as it was cleaned (utils/appVersion `cleanVersion`), and
 * compared by its numbers, so "1.4" here also blocks a caller sending "1.4.0".
 */
class SubscriptionBlockedVersion extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      platformId: this.platformId,
      version: this.version,
      note: this.note,
      createdAt: this.createdAt,
      createdBy: this.createdBy ? { id: this.createdBy.id, fullName: this.createdBy.fullName } : null,
    };
  }
}

SubscriptionBlockedVersion.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    platformId: { type: DataTypes.INTEGER, allowNull: false },
    version: { type: DataTypes.STRING(40), allowNull: false },
    note: { type: DataTypes.STRING(200), allowNull: true },
    createdById: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    modelName: "SubscriptionBlockedVersion",
    tableName: "subscription_blocked_versions",
    indexes: [{ unique: true, fields: ["platform_id", "version"] }],
  }
);

SubscriptionBlockedVersion.associate = ({ SubscriptionPlatform, User }) => {
  SubscriptionBlockedVersion.belongsTo(SubscriptionPlatform, { foreignKey: "platformId", as: "platform" });
  SubscriptionBlockedVersion.belongsTo(User, { foreignKey: "createdById", as: "createdBy" });
};

module.exports = SubscriptionBlockedVersion;
