const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * The catalogue of features a seat can carry.
 *
 * Window, charging port and fan were hardcoded fields on every seat. Moving
 * them into a table means adding "extra legroom" or "USB socket" later is a row
 * rather than a migration plus a form change — and because auto-select builds
 * its filters from this same catalogue, a new attribute becomes searchable the
 * moment it exists.
 */
const ATTRIBUTE_VALUE_TYPES = Object.freeze({ BOOLEAN: "boolean", ENUM: "enum" });

/**
 * "USB Socket!" -> "usb_socket". Trailing separators are stripped, so
 * punctuation at either end does not leak into the key.
 */
function slugifyKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

class SeatAttribute extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      key: this.key,
      label: this.label,
      description: this.description,
      valueType: this.valueType,
      options: this.options || [],
      icon: this.icon,
      isFilterable: this.isFilterable,
      isActive: this.isActive,
      sortOrder: this.sortOrder,
    };
  }
}

SeatAttribute.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    /** Stable machine key stored on each seat, e.g. "charging_port". */
    key: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      set(value) {
        this.setDataValue("key", slugifyKey(value));
      },
    },

    label: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.STRING(300), allowNull: true },

    valueType: {
      type: DataTypes.ENUM(...Object.values(ATTRIBUTE_VALUE_TYPES)),
      allowNull: false,
      defaultValue: ATTRIBUTE_VALUE_TYPES.BOOLEAN,
    },

    /** For `enum` attributes: [{ value, label }], e.g. full / half window. */
    options: { type: DataTypes.JSON, allowNull: true },

    /** PrimeReact icon class, so the seat grid can render it without a lookup table in code. */
    icon: { type: DataTypes.STRING(60), allowNull: true },

    /** Whether passengers may filter on it during auto-select. */
    isFilterable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
  },
  { sequelize, modelName: "SeatAttribute", tableName: "seat_attributes" }
);

module.exports = SeatAttribute;
module.exports.ATTRIBUTE_VALUE_TYPES = ATTRIBUTE_VALUE_TYPES;
module.exports.slugifyKey = slugifyKey;
