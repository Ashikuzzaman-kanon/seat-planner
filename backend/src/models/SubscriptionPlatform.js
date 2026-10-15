const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A kind of device a subscription can be used on: "windows", "android".
 *
 * Data rather than a list in the code, so adding one is a row. Each platform
 * has its own device count on every subscription — there is no grouping, so
 * `android` and `ios` are two counts if both exist.
 *
 * `value` is what a caller sends as `platform`. Like a subscription's code it
 * is set once: a caller built to send `windows` must keep working whatever the
 * platform is later called on screen (`name`).
 *
 * Switched off (`isActive` false), nobody can ask for devices on it and no
 * check from it is valid; the devices already on record stay on record.
 */
class SubscriptionPlatform extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      value: this.value,
      name: this.name,
      isActive: this.isActive,
      versionRequired: this.versionRequired,
      minVersion: this.minVersion,
    };
  }
}

SubscriptionPlatform.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    value: { type: DataTypes.STRING(40), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(60), allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdById: { type: DataTypes.INTEGER, allowNull: true },
    /**
     * The app's version rules for this platform (services/appVersionService):
     * whether a check must say which version is calling, and the oldest
     * version still let through. Single versions can also be blocked
     * (SubscriptionBlockedVersion).
     */
    versionRequired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    minVersion: { type: DataTypes.STRING(40), allowNull: true },
  },
  { sequelize, modelName: "SubscriptionPlatform", tableName: "subscription_platforms" }
);

SubscriptionPlatform.associate = ({ UserDevice, SubscriptionBlockedVersion }) => {
  SubscriptionPlatform.hasMany(UserDevice, { foreignKey: "platformId", as: "devices" });
  SubscriptionPlatform.hasMany(SubscriptionBlockedVersion, { foreignKey: "platformId", as: "blockedVersions" });
};

module.exports = SubscriptionPlatform;
