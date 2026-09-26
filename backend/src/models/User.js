const { Model, DataTypes } = require("sequelize");
const bcrypt = require("bcryptjs");
const sequelize = require("../config/database");
const { RESERVED_ROLES } = require("../constants/roles");

class User extends Model {
  /** Compare a plaintext password against the stored hash. */
  async verifyPassword(plain) {
    return bcrypt.compare(plain, this.passwordHash);
  }

  /** Role names held by this user. Requires `roles` to have been eager-loaded. */
  roleNames() {
    return (this.roles || []).map((r) => r.name);
  }

  /**
   * True if any held role is the super admin role, which implicitly carries
   * every permission in the catalogue. Requires `roles` to be loaded.
   */
  isSuperAdmin() {
    return this.roleNames().includes(RESERVED_ROLES.SUPER_ADMIN);
  }

  /** Safe representation for API responses (never leak secrets). */
  /**
   * Whether this account can buy a ticket yet.
   *
   * The details are needed once, before the first purchase, so a passenger
   * confirms rather than re-types them at every checkout.
   */
  get hasTravelProfile() {
    return Boolean(this.fullName && this.nid && this.dateOfBirth);
  }

  toPublicJSON() {
    return {
      id: this.id,
      fullName: this.fullName,
      email: this.email,
      isVerified: this.isVerified,
      nid: this.nid || null,
      dateOfBirth: this.dateOfBirth || null,
      hasTravelProfile: this.hasTravelProfile,
      // Present only when the caller eager-loaded roles.
      roles: this.roles?.map((r) => ({ id: r.id, name: r.name })),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

User.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    fullName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    passwordHash: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    isVerified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // OTP used for both email verification and password reset.
    verificationCode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    verificationCodeExpires: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    /**
     * The account holder's own travel identity, reused at checkout.
     *
     * Nullable because every account predates this; the requirement is enforced
     * at the first booking rather than by the column, so existing passengers
     * are asked once when they next buy rather than locked out on sight.
     */
    nid: { type: DataTypes.STRING(17), allowNull: true },
    dateOfBirth: { type: DataTypes.DATEONLY, allowNull: true },
  },
  {
    sequelize,
    modelName: "User",
    tableName: "users",
  }
);

User.associate = ({ Role, UserRole, RefreshToken }) => {
  User.belongsToMany(Role, {
    through: UserRole,
    foreignKey: "userId",
    otherKey: "roleId",
    as: "roles",
  });

  User.hasMany(RefreshToken, { foreignKey: "userId", as: "refreshTokens" });
};

module.exports = User;
