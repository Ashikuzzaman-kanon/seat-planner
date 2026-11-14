const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A notice sent to a subscription's subscribers about a version of one
 * platform's app (services/appNoticeService): a new version is out
 * (`released`), or an old one is going away (`retiring`). Kept so staff can
 * see what was said, to whom, and how.
 */
const NOTICE_KIND = Object.freeze({ RELEASED: "released", RETIRING: "retiring" });

class SubscriptionAppNotice extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      subscriptionId: this.subscriptionId,
      platformId: this.platformId,
      kind: this.kind,
      version: this.version,
      message: this.message,
      emailed: this.emailed,
      recipients: this.recipients,
      sentAt: this.createdAt,
      sentBy: this.sentBy ? { id: this.sentBy.id, fullName: this.sentBy.fullName } : null,
    };
  }
}

SubscriptionAppNotice.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    subscriptionId: { type: DataTypes.INTEGER, allowNull: false },
    platformId: { type: DataTypes.INTEGER, allowNull: false },
    kind: { type: DataTypes.STRING(20), allowNull: false },
    version: { type: DataTypes.STRING(40), allowNull: false },
    message: { type: DataTypes.STRING(1000), allowNull: false },
    emailed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    recipients: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    sentById: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    modelName: "SubscriptionAppNotice",
    tableName: "subscription_app_notices",
    indexes: [{ fields: ["subscription_id", "created_at"] }],
  }
);

SubscriptionAppNotice.associate = ({ Subscription, SubscriptionPlatform, User }) => {
  SubscriptionAppNotice.belongsTo(Subscription, { foreignKey: "subscriptionId", as: "subscription" });
  SubscriptionAppNotice.belongsTo(SubscriptionPlatform, { foreignKey: "platformId", as: "platform" });
  SubscriptionAppNotice.belongsTo(User, { foreignKey: "sentById", as: "sentBy" });
};

module.exports = SubscriptionAppNotice;
module.exports.NOTICE_KIND = NOTICE_KIND;
