const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Join table: which roles a user holds. Records who granted each one, so the
 * audit trail can answer "who gave this person this access, and when".
 */
class UserRole extends Model {}

UserRole.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    roleId: { type: DataTypes.INTEGER, allowNull: false },

    /** Null for roles granted by the system itself, e.g. the default role on registration. */
    grantedById: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    modelName: "UserRole",
    tableName: "user_roles",
    indexes: [{ unique: true, fields: ["user_id", "role_id"] }],
  }
);

module.exports = UserRole;
