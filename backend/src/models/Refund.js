const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A returned ticket.
 *
 * One row per ticket returned, whichever policy was used. A convenient return
 * settles the moment it is created; a demand-based one stays open, paying out
 * segment by segment as the seat resells, and is only finished when the train
 * departs.
 *
 * The amounts are recorded as they were decided, not recomputed later: the slab
 * that applied depended on when the passenger asked, and a settings change next
 * month must not retroactively alter what they were owed.
 */

const REFUND_STATUS = Object.freeze({
  /** Paid in full, nothing outstanding. */
  SETTLED: "settled",
  /** Demand-based: the seat is back on sale, waiting for buyers. */
  AWAITING_RESALE: "awaiting_resale",
  /** Demand-based: some segments resold, the rest did not. */
  PARTIALLY_SETTLED: "partially_settled",
  /** The train left with segments unsold, so nothing more will be paid. */
  CLOSED: "closed",
});

class Refund extends Model {
  get isOpen() {
    return (
      this.status === REFUND_STATUS.AWAITING_RESALE ||
      this.status === REFUND_STATUS.PARTIALLY_SETTLED
    );
  }

  toPublicJSON() {
    const { toMajor, format } = require("../utils/money");
    return {
      id: this.id,
      reference: this.reference,
      ticketId: this.ticketId,
      bookingId: this.bookingId,
      userId: this.userId,
      type: this.type,
      status: this.status,
      isOpen: this.isOpen,

      fareMinor: this.fareMinor,
      deductionPercent: this.deductionPercent,

      // What has actually been credited so far. For a convenient return this
      // equals the whole refund; for a demand one it grows as segments sell.
      refundedMinor: this.refundedMinor,
      refunded: toMajor(this.refundedMinor),
      refundedFormatted: format(this.refundedMinor),

      // The most this refund could ever pay, decided when it was created.
      maximumMinor: this.maximumMinor,
      maximumFormatted: format(this.maximumMinor),

      segments: this.segments?.map((s) => s.toPublicJSON()),
      ticket: this.ticket ? this.ticket.toPublicJSON() : undefined,

      requestedAt: this.createdAt,
      closedAt: this.closedAt,
      note: this.note,
    };
  }
}

Refund.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    reference: { type: DataTypes.STRING(20), allowNull: false, unique: true },

    ticketId: { type: DataTypes.INTEGER, allowNull: false },
    bookingId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },

    type: { type: DataTypes.STRING(20), allowNull: false },

    status: {
      type: DataTypes.ENUM(...Object.values(REFUND_STATUS)),
      allowNull: false,
      defaultValue: REFUND_STATUS.SETTLED,
    },

    /** The fare that was paid, copied so a later fare change cannot rewrite it. */
    fareMinor: { type: DataTypes.BIGINT, allowNull: false },
    deductionPercent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

    refundedMinor: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    maximumMinor: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },

    closedAt: { type: DataTypes.DATE, allowNull: true },
    note: { type: DataTypes.STRING(500), allowNull: true },
  },
  {
    sequelize,
    modelName: "Refund",
    tableName: "refunds",
    indexes: [
      { fields: ["user_id", "created_at"] },
      { fields: ["booking_id"] },
      { unique: true, fields: ["ticket_id"] },
      // The job that closes out refunds at departure scans by status.
      { fields: ["status"] },
    ],
    hooks: {
      afterFind(result) {
        for (const row of [].concat(result || [])) {
          if (!row) continue;
          for (const field of ["fareMinor", "refundedMinor", "maximumMinor"]) {
            if (row[field] != null) row[field] = Number(row[field]);
          }
        }
      },
    },
  }
);

Refund.associate = ({ Ticket, Booking, User, RefundSegment }) => {
  Refund.belongsTo(Ticket, { foreignKey: "ticketId", as: "ticket" });
  Refund.belongsTo(Booking, { foreignKey: "bookingId", as: "booking" });
  Refund.belongsTo(User, { foreignKey: "userId", as: "user" });
  Refund.hasMany(RefundSegment, { foreignKey: "refundId", as: "segments" });
};

module.exports = Refund;
module.exports.REFUND_STATUS = REFUND_STATUS;
