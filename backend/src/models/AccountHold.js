const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * An account stopped from buying, and the record of why (§14).
 *
 * ## Why a table rather than a flag on the user
 *
 * The spec's requirement is that a hold is **always reversible by an admin**.
 * A boolean satisfies that and destroys the thing that makes it safe to use: a
 * hold placed, lifted, and placed again leaves no trace, so nobody can answer
 * "how often has this happened, and who decided" — which is the first question
 * asked when a hold turns out to be wrong.
 *
 * So holds are rows. Placing one inserts; lifting one sets `released_at` and
 * says who and why. An account is held when it has a row with no release.
 *
 * ## Why a hold is almost never automatic
 *
 * Only at a high threshold, and only from signals a human has already upheld.
 * The score is arithmetic over reports and refund churn; arithmetic does not
 * know that a family shares a surname, or that a checker was wrong. So the
 * ordinary path is a review queue and a person, and the automatic path is
 * reserved for a score so far out that waiting would be worse. `automatic`
 * records which one placed it, because the two deserve different scrutiny.
 */
const HOLD_REASON = Object.freeze({
  /** Enough upheld reports and churn to cross the configured threshold. */
  ABUSE_SCORE: "abuse_score",
  /** A reviewer decided, on a specific case. */
  REVIEW_DECISION: "review_decision",
  /** An administrator, for something outside this system. */
  MANUAL: "manual",
});

class AccountHold extends Model {
  get isActive() {
    return !this.releasedAt;
  }

  toPublicJSON() {
    return {
      id: this.id,
      userId: this.userId,
      reason: this.reason,
      detail: this.detail,
      automatic: this.automatic,
      scoreAtHold: this.scoreAtHold,
      placedById: this.placedById,
      placedAt: this.createdAt,
      releasedById: this.releasedById,
      releasedAt: this.releasedAt,
      releaseNote: this.releaseNote,
      active: this.isActive,
    };
  }
}

AccountHold.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    userId: { type: DataTypes.INTEGER, allowNull: false },

    reason: {
      type: DataTypes.ENUM(...Object.values(HOLD_REASON)),
      allowNull: false,
    },

    /** Said to the person, so it has to be a sentence and not a code. */
    detail: { type: DataTypes.STRING(500), allowNull: false },

    /** Placed by the scorer rather than a person. Deserves more scrutiny, not less. */
    automatic: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

    /** What the score was when this was placed — so a later dispute can see it. */
    scoreAtHold: { type: DataTypes.INTEGER, allowNull: true },

    /** Null when the scorer placed it; nobody should be credited for arithmetic. */
    placedById: { type: DataTypes.INTEGER, allowNull: true },

    releasedById: { type: DataTypes.INTEGER, allowNull: true },
    releasedAt: { type: DataTypes.DATE, allowNull: true },
    releaseNote: { type: DataTypes.STRING(500), allowNull: true },
  },
  {
    sequelize,
    modelName: "AccountHold",
    tableName: "account_holds",
    indexes: [
      // "Is this account held" — asked whenever somebody tries to buy.
      { fields: ["user_id", "released_at"] },
      { fields: ["released_at"] },
    ],
  }
);

AccountHold.associate = ({ User }) => {
  AccountHold.belongsTo(User, { foreignKey: "userId", as: "user" });
  AccountHold.belongsTo(User, { foreignKey: "placedById", as: "placedBy" });
  AccountHold.belongsTo(User, { foreignKey: "releasedById", as: "releasedBy" });
};

module.exports = AccountHold;
module.exports.HOLD_REASON = HOLD_REASON;
