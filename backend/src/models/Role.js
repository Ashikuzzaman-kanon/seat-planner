const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const { RESERVED_ROLES } = require("../constants/roles");

/**
 * A runtime-created role: a named bundle of permissions. Flat — no rank or
 * hierarchy. A user may hold several, and their effective permissions are the
 * union of all of them.
 */
class Role extends Model {
  /** The super admin role holds every permission implicitly, forever. */
  get isSuperAdmin() {
    return this.name === RESERVED_ROLES.SUPER_ADMIN;
  }

  toPublicJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      isSystem: this.isSystem,
      isDefault: this.isDefault,
      // Only present when the caller eager-loaded permissions.
      permissions: this.permissions?.map((p) => p.key),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

Role.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: {
      type: DataTypes.STRING(60),
      allowNull: false,
      unique: true,
      validate: { notEmpty: true },
    },
    description: { type: DataTypes.STRING(300), allowNull: true },

    /**
     * System roles are structural: `super_admin` cannot be edited or deleted,
     * because losing it would leave the install with no way back in.
     */
    isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

    /** Assigned automatically to every new registration. Exactly one role holds this. */
    isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  { sequelize, modelName: "Role", tableName: "roles" }
);

Role.associate = ({ Permission, RolePermission, User, UserRole }) => {
  Role.belongsToMany(Permission, {
    through: RolePermission,
    foreignKey: "roleId",
    otherKey: "permissionId",
    as: "permissions",
  });

  Role.belongsToMany(User, {
    through: UserRole,
    foreignKey: "roleId",
    otherKey: "userId",
    as: "users",
  });
};

module.exports = Role;
