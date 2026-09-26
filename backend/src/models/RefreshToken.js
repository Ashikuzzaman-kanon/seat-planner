const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A server-side record of an issued refresh token.
 *
 * Access tokens are short-lived and stateless; refresh tokens are long-lived
 * and therefore must be revocable — that is what makes "revoke any role at any
 * time" real rather than nominal.
 *
 * Only a hash of the token is stored. A leaked database still cannot be used to
 * mint sessions.
 */
class RefreshToken extends Model {
  get isActive() {
    return !this.revokedAt && this.expiresAt > new Date();
  }
}

RefreshToken.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    revokedAt: { type: DataTypes.DATE, allowNull: true },

    /** Context captured at issue time, to make suspicious sessions identifiable. */
    userAgent: { type: DataTypes.STRING(300), allowNull: true },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true },
  },
  {
    sequelize,
    modelName: "RefreshToken",
    tableName: "refresh_tokens",
    indexes: [{ fields: ["user_id"] }],
  }
);

RefreshToken.associate = ({ User }) => {
  RefreshToken.belongsTo(User, { foreignKey: "userId", as: "user" });
};

module.exports = RefreshToken;
