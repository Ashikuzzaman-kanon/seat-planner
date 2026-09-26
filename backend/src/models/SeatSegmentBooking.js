const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One seat, occupied over one segment of one departure.
 *
 * This table *is* the inventory. A seat sold from B to C writes one row per
 * segment it crosses, which is what leaves A→B and C→D still sellable on the
 * same seat.
 *
 * The unique constraint on (seat, segment) is not bookkeeping — it is the
 * concurrency control. Two simultaneous purchases of the same seat-segment
 * cannot both commit; the loser's transaction fails on the constraint and rolls
 * back. No application-level locking, no read-then-write race.
 */
const SEGMENT_SOURCE = Object.freeze({
  TICKET: "ticket",
  HOLD: "hold",
  BLOCK: "block",
});

class SeatSegmentBooking extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      tripId: this.tripId,
      tripSeatId: this.tripSeatId,
      segmentIndex: this.segmentIndex,
      source: this.source,
      ticketId: this.ticketId,
      holdId: this.holdId,
      reason: this.reason,
      createdAt: this.createdAt,
    };
  }
}

SeatSegmentBooking.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tripId: { type: DataTypes.INTEGER, allowNull: false },
    tripSeatId: { type: DataTypes.INTEGER, allowNull: false },

    /** Zero-based: segment i spans route stop i to stop i+1. */
    segmentIndex: { type: DataTypes.INTEGER, allowNull: false },

    source: {
      type: DataTypes.ENUM(...Object.values(SEGMENT_SOURCE)),
      allowNull: false,
      defaultValue: SEGMENT_SOURCE.TICKET,
    },

    /** Filled in by Phase 5; nothing issues tickets yet. */
    ticketId: { type: DataTypes.INTEGER, allowNull: true },
    holdId: { type: DataTypes.INTEGER, allowNull: true },

    /** Why a seat was taken out of sale, for `block` rows. */
    reason: { type: DataTypes.STRING(300), allowNull: true },
  },
  {
    sequelize,
    modelName: "SeatSegmentBooking",
    tableName: "seat_segment_bookings",
    indexes: [
      { unique: true, fields: ["trip_seat_id", "segment_index"] },
      { fields: ["trip_id", "segment_index"] },
    ],
  }
);

SeatSegmentBooking.associate = ({ Trip, TripSeat }) => {
  SeatSegmentBooking.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  SeatSegmentBooking.belongsTo(TripSeat, { foreignKey: "tripSeatId", as: "seat" });
};

module.exports = SeatSegmentBooking;
module.exports.SEGMENT_SOURCE = SEGMENT_SOURCE;
