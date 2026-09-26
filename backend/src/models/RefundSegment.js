const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One returned segment, waiting to resell.
 *
 * This is what makes a demand-based return per-segment rather than
 * all-or-nothing. A passenger returns Dhaka→Tangail on a train continuing to
 * Rajshahi; someone buys only the Dhaka→Mymensingh part of it. That segment has
 * resold and refunds; the other has not and does not.
 *
 * "Resold" means that exact seat-segment sold again — the same `(tripSeatId,
 * segmentIndex)` pair the inventory is keyed on. Not "the train filled up":
 * the railway is only in a position to give the money back once it has been
 * paid for that specific space a second time. The waitlist (§12) is what makes
 * the specific seat likely to sell rather than merely possible.
 */

class RefundSegment extends Model {
  toPublicJSON() {
    const { format } = require("../utils/money");
    return {
      id: this.id,
      refundId: this.refundId,
      tripSeatId: this.tripSeatId,
      segmentIndex: this.segmentIndex,

      shareMinor: this.shareMinor,
      refundMinor: this.refundMinor,
      refundFormatted: format(this.refundMinor),

      isResold: Boolean(this.resoldAt),
      resoldAt: this.resoldAt,
      settledAt: this.settledAt,
      resoldTicketId: this.resoldTicketId,
    };
  }
}

RefundSegment.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    refundId: { type: DataTypes.INTEGER, allowNull: false },

    /** The exact space being watched — the same key the inventory is unique on. */
    tripSeatId: { type: DataTypes.INTEGER, allowNull: false },
    segmentIndex: { type: DataTypes.INTEGER, allowNull: false },

    /** This segment's share of the fare, and what it pays if it resells. */
    shareMinor: { type: DataTypes.BIGINT, allowNull: false },
    refundMinor: { type: DataTypes.BIGINT, allowNull: false },

    resoldAt: { type: DataTypes.DATE, allowNull: true },
    resoldTicketId: { type: DataTypes.INTEGER, allowNull: true },

    /**
     * When the money was credited. Separate from `resoldAt` so a resale that
     * is detected but whose payout fails can be retried without being mistaken
     * for one that never sold.
     */
    settledAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    modelName: "RefundSegment",
    tableName: "refund_segments",
    indexes: [
      { fields: ["refund_id"] },
      // The lookup every sale performs: "is anyone waiting on this space?".
      // Partial-index semantics are not available here, so the settle query
      // filters on settled_at being null.
      { fields: ["trip_seat_id", "segment_index", "settled_at"] },
    ],
    hooks: {
      afterFind(result) {
        for (const row of [].concat(result || [])) {
          if (!row) continue;
          for (const field of ["shareMinor", "refundMinor"]) {
            if (row[field] != null) row[field] = Number(row[field]);
          }
        }
      },
    },
  }
);

RefundSegment.associate = ({ Refund, TripSeat, Ticket }) => {
  RefundSegment.belongsTo(Refund, { foreignKey: "refundId", as: "refund" });
  RefundSegment.belongsTo(TripSeat, { foreignKey: "tripSeatId", as: "seat" });
  RefundSegment.belongsTo(Ticket, { foreignKey: "resoldTicketId", as: "resoldTicket" });
};

module.exports = RefundSegment;
