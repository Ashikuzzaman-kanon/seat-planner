const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A service class — Shovan, Snigdha, AC Chair, and so on.
 *
 * Defined on its own rather than through the shared reference factory, because
 * it now carries more than a name: how many passengers may stand in a coach of
 * this class. Coach types and train names are still plain lookups and still use
 * the factory.
 */
class CoachClass extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      name: this.name,
      standingCapacity: this.standingCapacity,
      /** Whether a connecting standing ticket can be sold in this class at all. */
      sellsStanding: this.standingCapacity > 0,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

CoachClass.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false, unique: true },

    /**
     * How many people may stand in one coach of this class, at once, over any
     * given segment (§10).
     *
     * Zero means the class does not sell standing — which is the default, and
     * right for a cabin or a berth. An administrator opts a class in rather
     * than having to opt every sleeper out.
     */
    standingCapacity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  { sequelize, modelName: "CoachClass", tableName: "coach_classes" }
);

module.exports = CoachClass;
