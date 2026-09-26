const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A passenger's stored credit.
 *
 * `balanceMinor` is a **cache**, not the truth. The truth is the append-only
 * ledger in `wallet_transactions`; this column exists so a balance can be read
 * without summing a lifetime of rows. It is only ever written inside the same
 * transaction that appends a ledger row, under a row lock, so the two cannot
 * drift — and `walletService.verify()` re-sums the ledger to prove it.
 */
const WALLET_STATUS = Object.freeze({ ACTIVE: "active", FROZEN: "frozen" });

class Wallet extends Model {
  toPublicJSON() {
    const { toMajor, format } = require("../utils/money");
    return {
      id: this.id,
      userId: this.userId,
      balanceMinor: this.balanceMinor,
      balance: toMajor(this.balanceMinor),
      balanceFormatted: format(this.balanceMinor),
      currency: this.currency,
      status: this.status,
      updatedAt: this.updatedAt,
    };
  }
}

Wallet.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, unique: true },

    /** Poisha. Integers, because floating point loses fractions of a paisa. */
    balanceMinor: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },

    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "BDT" },

    /** A frozen wallet can still be read and refunded into, but not spent from. */
    status: {
      type: DataTypes.ENUM(...Object.values(WALLET_STATUS)),
      allowNull: false,
      defaultValue: WALLET_STATUS.ACTIVE,
    },
  },
  {
    sequelize,
    modelName: "Wallet",
    tableName: "wallets",
    // BIGINT comes back as a string from mysql2; the ledger only ever works in
    // integers, so it is coerced on the way out.
    hooks: {
      afterFind(result) {
        for (const row of [].concat(result || [])) {
          if (row && row.balanceMinor != null) row.balanceMinor = Number(row.balanceMinor);
        }
      },
    },
  }
);

Wallet.associate = ({ User, WalletTransaction }) => {
  Wallet.belongsTo(User, { foreignKey: "userId", as: "user" });
  Wallet.hasMany(WalletTransaction, { foreignKey: "walletId", as: "transactions" });
};

module.exports = Wallet;
module.exports.WALLET_STATUS = WALLET_STATUS;
