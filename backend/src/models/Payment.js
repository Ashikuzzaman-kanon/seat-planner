const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One movement of money into a booking.
 *
 * A booking can have several: paying ৳300 from a wallet and ৳200 by card is two
 * rows, not one payment that knows about both. Keeping them separate is what
 * lets a new provider be added without touching the ones already there — and
 * what lets a refund find exactly where the money came from.
 */
const PROVIDER = Object.freeze({ WALLET: "wallet", GATEWAY: "gateway" });

const PAYMENT_STATUS = Object.freeze({
  CAPTURED: "captured",
  FAILED: "failed",
  REFUNDED: "refunded",
});

class Payment extends Model {
  toPublicJSON() {
    const { toMajor, format } = require("../utils/money");
    return {
      id: this.id,
      bookingId: this.bookingId,
      provider: this.provider,
      amountMinor: this.amountMinor,
      amount: toMajor(this.amountMinor),
      amountFormatted: format(this.amountMinor),
      status: this.status,
      reference: this.reference,
      createdAt: this.createdAt,
    };
  }
}

Payment.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    bookingId: { type: DataTypes.INTEGER, allowNull: false },

    provider: { type: DataTypes.ENUM(...Object.values(PROVIDER)), allowNull: false },

    amountMinor: { type: DataTypes.BIGINT, allowNull: false },

    status: {
      type: DataTypes.ENUM(...Object.values(PAYMENT_STATUS)),
      allowNull: false,
      defaultValue: PAYMENT_STATUS.CAPTURED,
    },

    /** The provider's own identifier, for reconciliation. */
    reference: { type: DataTypes.STRING(80), allowNull: true },
  },
  {
    sequelize,
    modelName: "Payment",
    tableName: "payments",
    indexes: [{ fields: ["booking_id"] }],
    hooks: {
      afterFind(result) {
        for (const row of [].concat(result || [])) {
          if (row && row.amountMinor != null) row.amountMinor = Number(row.amountMinor);
        }
      },
    },
  }
);

Payment.associate = ({ Booking }) => {
  Payment.belongsTo(Booking, { foreignKey: "bookingId", as: "booking" });
};

module.exports = Payment;
module.exports.PROVIDER = PROVIDER;
module.exports.PAYMENT_STATUS = PAYMENT_STATUS;
