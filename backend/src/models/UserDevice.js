const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A device seen on an account.
 *
 * Nobody registers one: the first time a device checks in with the right
 * password and there is room, it is added. The order rows were created in is
 * the order devices hold their places in (see utils/subscriptionDevices
 * `placeOf`), which is why a row is never re-created to "update" it.
 *
 * `deviceId` is whatever the caller sent. It identifies an installation only
 * as well as the caller generates it — two machines sending the same id are
 * one device here.
 *
 * Blocked, a device is never valid and holds no place; it stays on record so
 * the same id cannot simply check in again and take a fresh one.
 */
class UserDevice extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      userId: this.userId,
      platformId: this.platformId,
      deviceId: this.deviceId,
      note: this.note,
      isBlocked: this.isBlocked,
      firstSeenAt: this.createdAt,
      lastSeenAt: this.lastSeenAt,
      checks: this.checks,
      appVersion: this.appVersion,
    };
  }
}

UserDevice.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    platformId: { type: DataTypes.INTEGER, allowNull: false },
    deviceId: { type: DataTypes.STRING(128), allowNull: false },
    /** Staff's own words about it: "Rahim's office laptop". */
    note: { type: DataTypes.STRING(200), allowNull: true },
    isBlocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lastSeenAt: { type: DataTypes.DATE, allowNull: false },
    /** How many times it has checked in. */
    checks: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    /** The app version it last checked in with, when it said. */
    appVersion: { type: DataTypes.STRING(40), allowNull: true },
  },
  {
    sequelize,
    modelName: "UserDevice",
    tableName: "user_devices",
    indexes: [{ unique: true, fields: ["user_id", "platform_id", "device_id"] }],
  }
);

UserDevice.associate = ({ User, SubscriptionPlatform }) => {
  UserDevice.belongsTo(User, { foreignKey: "userId", as: "user" });
  UserDevice.belongsTo(SubscriptionPlatform, { foreignKey: "platformId", as: "platform" });
};

module.exports = UserDevice;
