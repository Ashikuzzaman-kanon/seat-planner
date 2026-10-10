const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Something a person can ask to be subscribed to.
 *
 * Only a name and a description: what a subscription gives is decided by
 * whoever checks for it (see POST /subscriptions/check), not here.
 *
 * `code` is how those callers name it. It is set once, when the subscription
 * is created, and never changes — renaming "Premium" to "Premium Plus" must
 * not break a client that asks for `premium`.
 *
 * Closed (`isOpen` false) means no new requests. Subscriptions already
 * running are not touched by closing; they end when they expire or are
 * cancelled.
 */
class Subscription extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      description: this.description,
      isOpen: this.isOpen,
      createdAt: this.createdAt,
    };
  }
}

Subscription.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.STRING(40), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    description: { type: DataTypes.STRING(500), allowNull: true },
    isOpen: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdById: { type: DataTypes.INTEGER, allowNull: true },
  },
  { sequelize, modelName: "Subscription", tableName: "subscriptions" }
);

Subscription.associate = ({ User, UserSubscription }) => {
  Subscription.belongsTo(User, { foreignKey: "createdById", as: "createdBy" });
  Subscription.hasMany(UserSubscription, { foreignKey: "subscriptionId", as: "members" });
};

module.exports = Subscription;
