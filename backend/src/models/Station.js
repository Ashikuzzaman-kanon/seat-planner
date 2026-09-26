const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/** A station on the network. Routes are built from these, in order. */
class Station extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      district: this.district,
      isActive: this.isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

Station.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    /** Short operating code, e.g. "DHK". Uppercased on write. */
    code: {
      type: DataTypes.STRING(10),
      allowNull: false,
      unique: true,
      set(value) {
        this.setDataValue("code", String(value || "").trim().toUpperCase());
      },
    },
    name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    district: { type: DataTypes.STRING(100), allowNull: true },

    /**
     * Retiring a station hides it from new routes without breaking the ones
     * that already reference it — deleting would orphan history.
     */
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  { sequelize, modelName: "Station", tableName: "stations" }
);

Station.associate = ({ RouteStop }) => {
  Station.hasMany(RouteStop, { foreignKey: "stationId", as: "stops" });
};

module.exports = Station;
