const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");
const { lastDayOf } = require("../utils/subscriptionPeriod");

/**
 * One person's subscription, from asking for it to its end.
 *
 *   pending ──approve──▶ active ──▶ expired     (the period ran out)
 *      │                    └─────▶ cancelled   (the person or a reviewer ended it)
 *      ├──decline──▶ declined
 *      └──withdraw─▶ cancelled
 *
 * A row is never reused: asking again after any ending is a new row, so who
 * decided what, and when, stays on record.
 *
 * ## What "valid" means
 *
 * `status` says where the row is in that life, and the hourly sweep is what
 * moves an active row to expired — so status alone can be up to an hour
 * behind. Validity is therefore always asked of the clock as well: active,
 * and `expiresAt` still ahead. See `isValid`.
 */
const SUBSCRIPTION_STATUS = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DECLINED: "declined",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
});

/** Pending or active: the states a person can hold only one of per subscription. */
const LIVE_STATUSES = Object.freeze([SUBSCRIPTION_STATUS.PENDING, SUBSCRIPTION_STATUS.ACTIVE]);

class UserSubscription extends Model {
  /** Active and not yet run out, at `now`. */
  isValid(now = new Date()) {
    return this.status === SUBSCRIPTION_STATUS.ACTIVE && Boolean(this.expiresAt) && this.expiresAt > now;
  }

  toPublicJSON(now = new Date()) {
    // An active row whose time is up reads as expired before the sweep says so.
    const lapsed = this.status === SUBSCRIPTION_STATUS.ACTIVE && !this.isValid(now);
    return {
      id: this.id,
      subscriptionId: this.subscriptionId,
      userId: this.userId,
      status: lapsed ? SUBSCRIPTION_STATUS.EXPIRED : this.status,
      valid: this.isValid(now),
      requestedAt: this.createdAt,
      decidedAt: this.decidedAt,
      decisionNote: this.decisionNote,
      startsAt: this.startsAt,
      expiresAt: this.expiresAt,
      // The last calendar day it is valid, in Dhaka — what a person is told.
      lastDay: this.expiresAt ? lastDayOf(this.expiresAt) : null,
      endedAt: this.endedAt,
      endReason: this.endReason,
    };
  }
}

UserSubscription.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    subscriptionId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },

    status: {
      type: DataTypes.ENUM(...Object.values(SUBSCRIPTION_STATUS)),
      allowNull: false,
      defaultValue: SUBSCRIPTION_STATUS.PENDING,
    },

    /** "<user>:<subscription>" while pending or active, null after — unique, so one live row each. */
    liveKey: { type: DataTypes.STRING(40), allowNull: true, unique: true },

    decidedById: { type: DataTypes.INTEGER, allowNull: true },
    decidedAt: { type: DataTypes.DATE, allowNull: true },
    decisionNote: { type: DataTypes.STRING(500), allowNull: true },

    startsAt: { type: DataTypes.DATE, allowNull: true },
    /** The first instant it is no longer valid. */
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    /** When the "ends soon" notification went out, so it goes out once. */
    remindedAt: { type: DataTypes.DATE, allowNull: true },

    /** Who cancelled it; null when it simply expired or was declined. */
    endedById: { type: DataTypes.INTEGER, allowNull: true },
    endedAt: { type: DataTypes.DATE, allowNull: true },
    endReason: { type: DataTypes.STRING(500), allowNull: true },
  },
  {
    sequelize,
    modelName: "UserSubscription",
    tableName: "user_subscriptions",
    indexes: [
      { fields: ["user_id", "status"] },
      { fields: ["subscription_id", "status"] },
      { fields: ["status", "expires_at"] },
    ],
  }
);

UserSubscription.associate = ({ User, Subscription }) => {
  UserSubscription.belongsTo(Subscription, { foreignKey: "subscriptionId", as: "subscription" });
  UserSubscription.belongsTo(User, { foreignKey: "userId", as: "user" });
  UserSubscription.belongsTo(User, { foreignKey: "decidedById", as: "decidedBy" });
  UserSubscription.belongsTo(User, { foreignKey: "endedById", as: "endedBy" });
};

module.exports = UserSubscription;
module.exports.SUBSCRIPTION_STATUS = SUBSCRIPTION_STATUS;
module.exports.LIVE_STATUSES = LIVE_STATUSES;
