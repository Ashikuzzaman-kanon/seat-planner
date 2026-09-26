const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One seat, one passenger, one journey.
 *
 * Passenger identity lives here rather than on the booking, because a family
 * travels on one booking with different people in each seat — and because
 * transfers, reporting and abuse detection all act on a named individual, not
 * on whoever paid.
 */
/**
 * A seated ticket occupies a seat; a standing one occupies floor space.
 *
 * Both are tickets: same number, same signed QR, same page in the PDF, same
 * status lifecycle, checked on a train by the same person doing the same thing.
 * The difference is that one names a seat and the other names a coach.
 */
const TICKET_KIND = Object.freeze({
  SEATED: "seated",
  STANDING: "standing",
});

const TICKET_STATUS = Object.freeze({
  VALID: "valid",
  CANCELLED: "cancelled",
  USED: "used",
  /** Returned by the passenger — see the refund that caused it. */
  REFUNDED: "refunded",
  /** Reissued to a different National ID after approval (§13). */
  TRANSFERRED: "transferred",
});

class Ticket extends Model {
  toPublicJSON() {
    const { toMajor, format } = require("../utils/money");
    return {
      id: this.id,
      bookingId: this.bookingId,
      ticketNumber: this.ticketNumber,
      tripSeatId: this.tripSeatId,
      seatNumber: this.seatNumber,
      coachCode: this.coachCode,
      coachClassId: this.coachClassId,
      passengerName: this.passengerName,
      passengerNid: this.passengerNid,
      passengerDob: this.passengerDob,
      kind: this.kind,
      isStanding: this.kind === TICKET_KIND.STANDING,
      seatedTicketId: this.seatedTicketId,
      tripCoachId: this.tripCoachId,
      fromStationId: this.fromStationId,
      toStationId: this.toStationId,
      segments: this.segments || [],
      fareMinor: this.fareMinor,
      fare: toMajor(this.fareMinor),
      fareFormatted: format(this.fareMinor),
      status: this.status,
      createdAt: this.createdAt,
    };
  }
}

Ticket.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    bookingId: { type: DataTypes.INTEGER, allowNull: false },

    /** Printed on the ticket and quoted to a checker. */
    ticketNumber: { type: DataTypes.STRING(20), allowNull: false, unique: true },

    // Null on a standing ticket, which has no seat to point at.
    tripSeatId: { type: DataTypes.INTEGER, allowNull: true },

    /**
     * Copied from the seat at purchase. A seat plan can be rebuilt, but what
     * the passenger was sold must not change underneath them.
     */
    seatNumber: { type: DataTypes.STRING(10), allowNull: true },
    coachCode: { type: DataTypes.STRING(10), allowNull: false },
    coachClassId: { type: DataTypes.INTEGER, allowNull: false },

    passengerName: { type: DataTypes.STRING(120), allowNull: false },
    /** 10–17 digits, per the spec. Stored as given, validated on the way in. */
    passengerNid: { type: DataTypes.STRING(20), allowNull: false },
    passengerDob: { type: DataTypes.DATEONLY, allowNull: false },

    fareMinor: { type: DataTypes.BIGINT, allowNull: false },

    kind: {
      type: DataTypes.ENUM(...Object.values(TICKET_KIND)),
      allowNull: false,
      defaultValue: TICKET_KIND.SEATED,
    },

    /**
     * The seated ticket a standing leg accompanies (§10).
     *
     * Standing is never sold on its own — it exists to carry someone over the
     * part of a journey their seat does not cover. Refunding the seat takes its
     * standing legs with it, which the cascade on this column enforces even if
     * the service somehow forgot.
     */
    seatedTicketId: { type: DataTypes.INTEGER, allowNull: true },

    /** Which coach the passenger stands in. Capacity is counted per coach. */
    tripCoachId: { type: DataTypes.INTEGER, allowNull: true },

    /**
     * The stretch this ticket covers.
     *
     * A seated ticket's matches its booking's. A standing leg's does not — that
     * is the whole point of it — so each ticket carries its own.
     */
    fromStationId: { type: DataTypes.INTEGER, allowNull: true },
    toStationId: { type: DataTypes.INTEGER, allowNull: true },
    segments: { type: DataTypes.JSON, allowNull: true },

    status: {
      type: DataTypes.ENUM(...Object.values(TICKET_STATUS)),
      allowNull: false,
      defaultValue: TICKET_STATUS.VALID,
    },
  },
  {
    sequelize,
    modelName: "Ticket",
    tableName: "tickets",
    indexes: [
      { fields: ["booking_id"] },
      { fields: ["trip_seat_id"] },
      { fields: ["passenger_nid"] },
    ],
    hooks: {
      afterFind(result) {
        for (const row of [].concat(result || [])) {
          if (row && row.fareMinor != null) row.fareMinor = Number(row.fareMinor);
        }
      },
    },
  }
);

Ticket.associate = ({ Booking, TripSeat, CoachClass }) => {
  Ticket.belongsTo(Booking, { foreignKey: "bookingId", as: "booking" });
  Ticket.belongsTo(TripSeat, { foreignKey: "tripSeatId", as: "seat" });
  Ticket.belongsTo(CoachClass, { foreignKey: "coachClassId", as: "coachClass" });
};

module.exports = Ticket;
module.exports.TICKET_STATUS = TICKET_STATUS;
module.exports.TICKET_KIND = TICKET_KIND;
