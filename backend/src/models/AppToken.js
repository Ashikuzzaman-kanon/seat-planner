const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * What a subscriber's app signs in with after its first check
 * (services/appTokenService): the app sends it in place of the email and
 * password.
 *
 * Tied to one account and one device. Only a hash is stored, as for refresh
 * tokens. It stops working when its time is up, or is revoked when the
 * password changes, the account is restricted, or staff remove or block the
 * device — and a new sign-in from the same device replaces it.
 */
class AppToken extends Model {
  get isActive() {
    return !this.revokedAt && this.expiresAt > new Date();
  }
}

AppToken.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    deviceId: { type: DataTypes.STRING(128), allowNull: false },
    platformValue: { type: DataTypes.STRING(40), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
    lastUsedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    modelName: "AppToken",
    tableName: "app_tokens",
    indexes: [{ fields: ["user_id", "device_id"] }],
  }
);

AppToken.associate = ({ User }) => {
  AppToken.belongsTo(User, { foreignKey: "userId", as: "user" });
};

module.exports = AppToken;
