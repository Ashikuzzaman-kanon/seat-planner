const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A check that was turned away because of the device, and why.
 *
 * The caller of the check API is told only `valid: false` — never the reason,
 * which would tell someone probing the limit exactly what to change. The
 * reason is kept here instead, for whoever looks after the account.
 *
 * One row per account, reason, platform and device, counting attempts: a
 * device that tries a thousand times is one row, not a thousand. What the
 * caller sent is stored as sent (cut to fit), since a refusal is often about
 * exactly that — a platform nobody created, an id that is not one.
 */
class UserDeviceRefusal extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      userId: this.userId,
      platform: this.platformValue || null,
      deviceId: this.deviceId || null,
      reason: this.reason,
      attempts: this.attempts,
      firstAt: this.createdAt,
      lastAt: this.lastAt,
    };
  }
}

UserDeviceRefusal.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    platformValue: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "" },
    deviceId: { type: DataTypes.STRING(128), allowNull: false, defaultValue: "" },
    /** One of utils/subscriptionDevices REASON. */
    reason: { type: DataTypes.STRING(32), allowNull: false },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    lastAt: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: "UserDeviceRefusal",
    tableName: "user_device_refusals",
    indexes: [
      { unique: true, fields: ["user_id", "reason", "platform_value", "device_id"] },
      { fields: ["user_id", "last_at"] },
      { fields: ["last_at"] },
    ],
  }
);

UserDeviceRefusal.associate = ({ User }) => {
  UserDeviceRefusal.belongsTo(User, { foreignKey: "userId", as: "user" });
};

module.exports = UserDeviceRefusal;
