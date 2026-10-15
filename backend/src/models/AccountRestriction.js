const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * An account stopped from signing in, and the record of why.
 *
 * Unlike an account hold (AccountHold), which stops an account buying and
 * nothing else, a restriction stops it using the system at all: no sign-in,
 * no session, no subscription check. It lasts until someone lifts it.
 *
 * Rows rather than a flag, for the same reason holds are rows: restricting,
 * lifting and restricting again must leave a trail that says who decided what,
 * and when. The account carries `restricted_at` as well — that flag is what
 * every request reads; these rows are the history behind it. A row with no
 * `liftedAt` is the restriction in force.
 */
class AccountRestriction extends Model {
  toPublicJSON() {
    const person = (u) => (u ? { id: u.id, fullName: u.fullName } : null);
    return {
      id: this.id,
      userId: this.userId,
      reason: this.reason,
      restrictedAt: this.restrictedAt,
      restrictedBy: person(this.restrictedBy),
      liftedAt: this.liftedAt,
      liftedBy: person(this.liftedBy),
      liftNote: this.liftNote,
      inForce: !this.liftedAt,
    };
  }
}

AccountRestriction.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    reason: { type: DataTypes.STRING(500), allowNull: false },
    restrictedById: { type: DataTypes.INTEGER, allowNull: true },
    restrictedAt: { type: DataTypes.DATE, allowNull: false },
    liftedAt: { type: DataTypes.DATE, allowNull: true },
    liftedById: { type: DataTypes.INTEGER, allowNull: true },
    liftNote: { type: DataTypes.STRING(500), allowNull: true },
  },
  {
    sequelize,
    modelName: "AccountRestriction",
    tableName: "account_restrictions",
    indexes: [{ fields: ["user_id", "restricted_at"] }],
  }
);

AccountRestriction.associate = ({ User }) => {
  AccountRestriction.belongsTo(User, { foreignKey: "userId", as: "user" });
  AccountRestriction.belongsTo(User, { foreignKey: "restrictedById", as: "restrictedBy" });
  AccountRestriction.belongsTo(User, { foreignKey: "liftedById", as: "liftedBy" });
};

module.exports = AccountRestriction;
