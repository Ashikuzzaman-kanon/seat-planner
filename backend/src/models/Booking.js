const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One purchase: up to four tickets bought together for one journey.
 *
 * The booking is what a passenger recognises — a reference they quote, one
 * payment, one confirmation email. The tickets under it are what the railway
 * recognises: each has its own seat, its own passenger and its own fare, and
 * can be refunded or transferred on its own.
 */
const BOOKING_STATUS = Object.freeze({
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
});

class Booking extends Model {
  toPublicJSON() {
    const { toMajor, format } = require("../utils/money");
    return {
      id: this.id,
      reference: this.reference,
      userId: this.userId,
      tripId: this.tripId,
      trip: this.trip
        ? {
            id: this.trip.id,
            departureDate: this.trip.departureDate,
            status: this.trip.status,
            train: this.trip.train ? { id: this.trip.train.id, name: this.trip.train.name } : undefined,
          }
        : undefined,
      fromStationId: this.fromStationId,
      toStationId: this.toStationId,

      /*
       * The day this passenger travels, which is not always the day the train
       * left its origin. Someone joining an overnight service at 00:08 boards
       * the day after it set off, and a ticket showing the departure date would
       * send them to the station a night early.
       *
       * Falls back for rows written before the column existed and somehow
       * missed the backfill — a slightly wrong date beats no date at all on
       * something a passenger is holding at a gate.
       */
      boardingDate: this.boardingDate || this.trip?.departureDate || null,
      arrivalDate: this.arrivalDate || null,
      /** Nights on the train, so a card can print "+1". */
      nightsOnBoard:
        this.boardingDate && this.arrivalDate
          ? Math.round(
              (new Date(`${this.arrivalDate}T00:00:00Z`) - new Date(`${this.boardingDate}T00:00:00Z`)) /
                86400000
            )
          : 0,
      fromStation: this.fromStation ? this.fromStation.toPublicJSON() : undefined,
      toStation: this.toStation ? this.toStation.toPublicJSON() : undefined,
      status: this.status,
      totalMinor: this.totalMinor,
      total: toMajor(this.totalMinor),
      totalFormatted: format(this.totalMinor),
      ticketCount: this.ticketCount,
      tickets: this.tickets?.map((t) => t.toPublicJSON()),
      payments: this.payments?.map((p) => p.toPublicJSON()),
      createdAt: this.createdAt,
    };
  }
}

Booking.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    /** The PNR a passenger quotes. Short, unambiguous, unique. */
    reference: { type: DataTypes.STRING(12), allowNull: false, unique: true },

    userId: { type: DataTypes.INTEGER, allowNull: false },
    tripId: { type: DataTypes.INTEGER, allowNull: false },

    fromStationId: { type: DataTypes.INTEGER, allowNull: false },
    toStationId: { type: DataTypes.INTEGER, allowNull: false },

    status: {
      type: DataTypes.ENUM(...Object.values(BOOKING_STATUS)),
      allowNull: false,
      defaultValue: BOOKING_STATUS.CONFIRMED,
    },

    totalMinor: { type: DataTypes.BIGINT, allowNull: false },
    ticketCount: { type: DataTypes.INTEGER, allowNull: false },

    /**
     * When this passenger boards and alights, in calendar days.
     *
     * Copied at purchase rather than derived on read, for the same reason the
     * seat number and coach code are: what was sold must not change because
     * somebody edited the timetable afterwards.
     */
    boardingDate: { type: DataTypes.DATEONLY, allowNull: true },
    arrivalDate: { type: DataTypes.DATEONLY, allowNull: true },
  },
  {
    sequelize,
    modelName: "Booking",
    tableName: "bookings",
    indexes: [
      { fields: ["user_id", "created_at"] },
      { fields: ["trip_id"] },
    ],
    hooks: {
      afterFind(result) {
        for (const row of [].concat(result || [])) {
          if (row && row.totalMinor != null) row.totalMinor = Number(row.totalMinor);
        }
      },
    },
  }
);

Booking.associate = ({ User, Trip, Station, Ticket, Payment }) => {
  Booking.belongsTo(User, { foreignKey: "userId", as: "user" });
  Booking.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  Booking.belongsTo(Station, { foreignKey: "fromStationId", as: "fromStation" });
  Booking.belongsTo(Station, { foreignKey: "toStationId", as: "toStation" });
  Booking.hasMany(Ticket, { foreignKey: "bookingId", as: "tickets" });
  Booking.hasMany(Payment, { foreignKey: "bookingId", as: "payments" });
};

module.exports = Booking;
module.exports.BOOKING_STATUS = BOOKING_STATUS;
