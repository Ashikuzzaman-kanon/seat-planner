const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One link in the fare rule chain.
 *
 * Rules are tried in `priority` order and the first that produces an amount
 * wins. That is what lets a station-pair table override a per-kilometre rate
 * without either knowing about the other — and what lets peak surcharges,
 * concessions and promotions be added later as new kinds rather than as edits
 * to a single pricing function.
 *
 * A null `trainId` makes the rule apply to every train.
 */
const FARE_RULE_KINDS = Object.freeze({ TABLE: "table", DISTANCE: "distance" });

class FareRule extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      priority: this.priority,
      trainId: this.trainId,
      train: this.train ? { id: this.train.id, name: this.train.name } : null,
      coachClassId: this.coachClassId,
      coachClass: this.coachClass ? { id: this.coachClass.id, name: this.coachClass.name } : null,
      ratePerKm: this.ratePerKm === null ? null : Number(this.ratePerKm),
      minFare: this.minFare === null ? null : Number(this.minFare),
      isActive: this.isActive,
      entryCount: this.entries?.length,
      entries: this.entries?.map((e) => e.toPublicJSON()),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

FareRule.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },

    kind: {
      type: DataTypes.ENUM(...Object.values(FARE_RULE_KINDS)),
      allowNull: false,
    },

    /** Lower runs first. */
    priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },

    /** Null = applies to every train. */
    trainId: { type: DataTypes.INTEGER, allowNull: true },
    coachClassId: { type: DataTypes.INTEGER, allowNull: false },

    /** Used by `distance` rules only. */
    ratePerKm: { type: DataTypes.DECIMAL(8, 4), allowNull: true },
    minFare: { type: DataTypes.DECIMAL(10, 2), allowNull: true },

    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  { sequelize, modelName: "FareRule", tableName: "fare_rules" }
);

FareRule.associate = ({ TrainName, CoachClass, FareTableEntry }) => {
  FareRule.belongsTo(TrainName, { foreignKey: "trainId", as: "train" });
  FareRule.belongsTo(CoachClass, { foreignKey: "coachClassId", as: "coachClass" });
  FareRule.hasMany(FareTableEntry, {
    foreignKey: "fareRuleId",
    as: "entries",
    onDelete: "CASCADE",
  });
};

module.exports = FareRule;
module.exports.FARE_RULE_KINDS = FARE_RULE_KINDS;
