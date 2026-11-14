const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A version of one platform's app that one subscription turns away, whatever
 * its minimum says — a release with a fault in it, say, when the ones either
 * side of it are fine. It belongs to that subscription's rule for the platform
 * (SubscriptionVersionRule) and goes with it.
 *
 * `version` is stored as it was cleaned (utils/appVersion `cleanVersion`), and
 * compared by its numbers, so "1.4" here also blocks a caller sending "1.4.0".
 */
class SubscriptionVersionBlock extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      version: this.version,
      note: this.note,
      createdAt: this.createdAt,
      createdBy: this.createdBy ? { id: this.createdBy.id, fullName: this.createdBy.fullName } : null,
    };
  }
}

SubscriptionVersionBlock.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    ruleId: { type: DataTypes.INTEGER, allowNull: false },
    version: { type: DataTypes.STRING(40), allowNull: false },
    note: { type: DataTypes.STRING(200), allowNull: true },
    createdById: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    modelName: "SubscriptionVersionBlock",
    tableName: "subscription_version_blocks",
    indexes: [{ unique: true, fields: ["rule_id", "version"] }],
  }
);

SubscriptionVersionBlock.associate = ({ SubscriptionVersionRule, User }) => {
  SubscriptionVersionBlock.belongsTo(SubscriptionVersionRule, { foreignKey: "ruleId", as: "rule" });
  SubscriptionVersionBlock.belongsTo(User, { foreignKey: "createdById", as: "createdBy" });
};

module.exports = SubscriptionVersionBlock;
