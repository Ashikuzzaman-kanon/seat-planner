const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const { SETTING_SCOPES } = require("../constants/settingDefinitions");

/**
 * A stored override for one entry in the settings catalogue.
 *
 * Absence means "use the declared default", so the table only ever holds values
 * somebody deliberately changed — which also makes the audit trail meaningful.
 */
class Setting extends Model {}

Setting.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    key: { type: DataTypes.STRING(100), allowNull: false },

    // Only `global` is used today; the columns exist so per-train and per-class
    // overrides stay an additive change.
    scope: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: SETTING_SCOPES.GLOBAL,
    },
    scopeId: { type: DataTypes.INTEGER, allowNull: true },

    // JSON keeps the stored value the same type it was declared as, rather than
    // round-tripping everything through strings.
    value: { type: DataTypes.JSON, allowNull: false },

    updatedById: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    modelName: "Setting",
    tableName: "settings",
    indexes: [{ unique: true, fields: ["key", "scope", "scope_id"] }],
  }
);

Setting.associate = ({ User }) => {
  Setting.belongsTo(User, { foreignKey: "updatedById", as: "updatedBy" });
};

module.exports = Setting;
