const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A mirror of the code-defined permission catalogue, persisted so that
 * `role_permissions` can reference it with a real foreign key.
 *
 * Rows are synced from `constants/permissions.js` — never authored by hand.
 */
class Permission extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      key: this.key,
      group: this.groupName,
      label: this.label,
      description: this.description,
    };
  }
}

Permission.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    key: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    // Stored as `group_name`: GROUP is a reserved word in MySQL.
    groupName: { type: DataTypes.STRING(60), allowNull: false },
    label: { type: DataTypes.STRING(150), allowNull: false },
    description: { type: DataTypes.STRING(500), allowNull: true },
  },
  { sequelize, modelName: "Permission", tableName: "permissions" }
);

Permission.associate = ({ Role, RolePermission }) => {
  Permission.belongsToMany(Role, {
    through: RolePermission,
    foreignKey: "permissionId",
    otherKey: "roleId",
    as: "roles",
  });
};

module.exports = Permission;
