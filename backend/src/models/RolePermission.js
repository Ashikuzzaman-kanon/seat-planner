const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/** Join table: which permissions a role grants. */
class RolePermission extends Model {}

RolePermission.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    roleId: { type: DataTypes.INTEGER, allowNull: false },
    permissionId: { type: DataTypes.INTEGER, allowNull: false },
  },
  {
    sequelize,
    modelName: "RolePermission",
    tableName: "role_permissions",
    indexes: [{ unique: true, fields: ["role_id", "permission_id"] }],
  }
);

module.exports = RolePermission;
