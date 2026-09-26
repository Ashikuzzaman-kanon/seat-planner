const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A standing instruction to hold back seats for a particular station pair.
 *
 * Defined per train with an effective date range and materialised onto each
 * departure, because nobody is going to configure seat distribution by hand
 * every day. Rules apply in `priority` order, each taking its quantity from the
 * seats no earlier rule has claimed.
 */
class TrainQuotaRule extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      trainId: this.trainId,
      train: this.train ? { id: this.train.id, name: this.train.name } : undefined,
      coachClassId: this.coachClassId,
      coachClass: this.coachClass ? { id: this.coachClass.id, name: this.coachClass.name } : undefined,
      fromStationId: this.fromStationId,
      toStationId: this.toStationId,
      fromStation: this.fromStation ? this.fromStation.toPublicJSON() : undefined,
      toStation: this.toStation ? this.toStation.toPublicJSON() : undefined,
      quantity: this.quantity,
      releaseHoursBefore: this.releaseHoursBefore,
      priority: this.priority,
      effectiveFrom: this.effectiveFrom,
      effectiveTo: this.effectiveTo,
      isActive: this.isActive,
    };
  }

  coversDate(date) {
    if (!this.isActive) return false;
    if (this.effectiveFrom && date < this.effectiveFrom) return false;
    if (this.effectiveTo && date > this.effectiveTo) return false;
    return true;
  }
}

TrainQuotaRule.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    trainId: { type: DataTypes.INTEGER, allowNull: false },
    coachClassId: { type: DataTypes.INTEGER, allowNull: false },

    fromStationId: { type: DataTypes.INTEGER, allowNull: false },
    toStationId: { type: DataTypes.INTEGER, allowNull: false },

    /** How many seats of this class to hold for the pair. */
    quantity: { type: DataTypes.INTEGER, allowNull: false },

    /**
     * Unsold reserved seats return to open sale this many hours before
     * departure. Exact-pair matching would strand inventory without it, so the
     * release is not optional — the two rules only make sense together.
     */
    releaseHoursBefore: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 24 },

    /** Lower runs first, claiming seats before later rules see them. */
    priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },

    effectiveFrom: { type: DataTypes.DATEONLY, allowNull: true },
    effectiveTo: { type: DataTypes.DATEONLY, allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    sequelize,
    modelName: "TrainQuotaRule",
    tableName: "train_quota_rules",
    indexes: [{ fields: ["train_id", "priority"] }],
  }
);

TrainQuotaRule.associate = ({ TrainName, CoachClass, Station }) => {
  TrainQuotaRule.belongsTo(TrainName, { foreignKey: "trainId", as: "train" });
  TrainQuotaRule.belongsTo(CoachClass, { foreignKey: "coachClassId", as: "coachClass" });
  TrainQuotaRule.belongsTo(Station, { foreignKey: "fromStationId", as: "fromStation" });
  TrainQuotaRule.belongsTo(Station, { foreignKey: "toStationId", as: "toStation" });
};

module.exports = TrainQuotaRule;
