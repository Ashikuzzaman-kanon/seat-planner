const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One movement of money, written once and never changed.
 *
 * This is the source of truth for a wallet. Nothing here is ever updated or
 * deleted: a mistake is corrected by appending a compensating entry, so the
 * history of what happened survives the correction. `balanceAfterMinor` records
 * what the wallet held immediately after this entry, which makes a discrepancy
 * traceable to the exact row that introduced it.
 */
const DIRECTION = Object.freeze({ CREDIT: "credit", DEBIT: "debit" });

const REASON = Object.freeze({
  TOPUP: "topup",
  BOOKING: "booking",
  REFUND: "refund",
  WITHDRAWAL: "withdrawal",
  ADJUSTMENT: "adjustment",
});

class WalletTransaction extends Model {
  toPublicJSON() {
    const { toMajor, format } = require("../utils/money");
    return {
      id: this.id,
      walletId: this.walletId,
      direction: this.direction,
      amountMinor: this.amountMinor,
      amount: toMajor(this.amountMinor),
      amountFormatted: format(this.amountMinor),
      balanceAfterMinor: this.balanceAfterMinor,
      balanceAfterFormatted: format(this.balanceAfterMinor),
      reason: this.reason,
      referenceType: this.referenceType,
      referenceId: this.referenceId,
      description: this.description,
      createdAt: this.createdAt,
    };
  }
}

WalletTransaction.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    walletId: { type: DataTypes.INTEGER, allowNull: false },

    direction: {
      type: DataTypes.ENUM(...Object.values(DIRECTION)),
      allowNull: false,
    },

    /** Always positive; `direction` carries the sign. */
    amountMinor: { type: DataTypes.BIGINT, allowNull: false },
    balanceAfterMinor: { type: DataTypes.BIGINT, allowNull: false },

    reason: { type: DataTypes.ENUM(...Object.values(REASON)), allowNull: false },

    /** What caused it — a booking, a refund, an admin correction. */
    referenceType: { type: DataTypes.STRING(40), allowNull: true },
    referenceId: { type: DataTypes.STRING(60), allowNull: true },

    description: { type: DataTypes.STRING(300), allowNull: true },
  },
  {
    sequelize,
    modelName: "WalletTransaction",
    tableName: "wallet_transactions",
    // Append-only: no updatedAt, because nothing is ever updated.
    updatedAt: false,
    indexes: [
      { fields: ["wallet_id", "created_at"] },
      { fields: ["reference_type", "reference_id"] },
    ],
    hooks: {
      afterFind(result) {
        for (const row of [].concat(result || [])) {
          if (!row) continue;
          if (row.amountMinor != null) row.amountMinor = Number(row.amountMinor);
          if (row.balanceAfterMinor != null) row.balanceAfterMinor = Number(row.balanceAfterMinor);
        }
      },
    },
  }
);

WalletTransaction.associate = ({ Wallet }) => {
  WalletTransaction.belongsTo(Wallet, { foreignKey: "walletId", as: "wallet" });
};

module.exports = WalletTransaction;
module.exports.DIRECTION = DIRECTION;
module.exports.REASON = REASON;
