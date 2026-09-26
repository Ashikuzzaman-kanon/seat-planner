const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A place in the queue for a segment that is full.
 *
 * A waitlist only earns its keep if it converts returned inventory quickly, so
 * this is written for the moment a seat comes back rather than for the moment
 * someone joins. Everything needed to buy — the journey, how many seats, which
 * class, and who is travelling — is captured at join time. When a seat frees,
 * the queue can be served without asking anyone anything: the seat is held in
 * the passenger's name and they are told it is waiting.
 *
 * Holding passenger details here, rather than collecting them at confirmation,
 * is what makes "one click" true. Someone joining a queue already knows who is
 * travelling; asking again at the one moment that is time-critical would be the
 * worst possible time to ask.
 *
 * The queue is ordered by when people joined, and that is the only ordering.
 * Position is not stored: it is a function of the rows ahead, and storing it
 * would mean renumbering everyone each time one person leaves.
 */
const WAITLIST_STATUS = Object.freeze({
  /** In the queue, waiting for a seat. */
  WAITING: "waiting",
  /** A seat came free and is held in their name; the clock is running. */
  OFFERED: "offered",
  /** They took it. `bookingId` says what they got. */
  CONFIRMED: "confirmed",
  /** They said no. The seat went back to the queue immediately. */
  DECLINED: "declined",
  /** The offer ran out unanswered. */
  LAPSED: "lapsed",
  /** They left the queue. */
  WITHDRAWN: "withdrawn",
  /** The train went without them, or the departure was cancelled. */
  CLOSED: "closed",
});

/** The statuses that still want something from us. */
const OPEN_STATUSES = [WAITLIST_STATUS.WAITING, WAITLIST_STATUS.OFFERED];

class WaitlistEntry extends Model {
  get isOpen() {
    return OPEN_STATUSES.includes(this.status);
  }

  get offerSecondsRemaining() {
    if (this.status !== WAITLIST_STATUS.OFFERED || !this.offerExpiresAt) return 0;
    return Math.max(0, Math.round((this.offerExpiresAt - new Date()) / 1000));
  }

  toPublicJSON() {
    return {
      reference: this.reference,
      tripId: this.tripId,
      fromStationId: this.fromStationId,
      toStationId: this.toStationId,
      seatCount: this.seatCount,
      coachClassId: this.coachClassId,
      status: this.status,
      offerExpiresAt: this.offerExpiresAt,
      offerSecondsRemaining: this.offerSecondsRemaining,
      offersMade: this.offersMade,
      bookingId: this.bookingId,
      joinedAt: this.createdAt,
    };
  }
}

WaitlistEntry.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    /** What the passenger quotes, and what the confirm link carries. */
    reference: { type: DataTypes.STRING(40), allowNull: false, unique: true },

    tripId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },

    fromStationId: { type: DataTypes.INTEGER, allowNull: false },
    toStationId: { type: DataTypes.INTEGER, allowNull: false },

    seatCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },

    /**
     * Optional. A passenger who will take any class converts faster than one
     * holding out for a cabin, and both are legitimate — so this narrows the
     * match rather than being required.
     */
    coachClassId: { type: DataTypes.INTEGER, allowNull: true },

    /**
     * Who is travelling, one per seat, in the same shape the booking API takes.
     * Captured here so confirmation needs no input.
     */
    passengers: { type: DataTypes.JSON, allowNull: false },

    status: {
      type: DataTypes.ENUM(...Object.values(WAITLIST_STATUS)),
      allowNull: false,
      defaultValue: WAITLIST_STATUS.WAITING,
    },

    /** The hold standing in their name while an offer is open. */
    holdId: { type: DataTypes.INTEGER, allowNull: true },
    offerExpiresAt: { type: DataTypes.DATE, allowNull: true },

    /**
     * How many times this entry has been offered a seat and not taken it.
     * A passenger who lets offers lapse repeatedly is holding seats out of sale
     * each time, so there is a limit.
     */
    offersMade: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

    /** Set when they confirm. */
    bookingId: { type: DataTypes.INTEGER, allowNull: true },

    closedAt: { type: DataTypes.DATE, allowNull: true },
    note: { type: DataTypes.STRING(255), allowNull: true },
  },
  {
    sequelize,
    modelName: "WaitlistEntry",
    tableName: "waitlist_entries",
    indexes: [
      // Serving the queue for one departure, oldest first.
      { fields: ["trip_id", "status", "id"] },
      { fields: ["user_id", "status"] },
      // The job that closes lapsed offers scans on exactly this.
      { fields: ["status", "offer_expires_at"] },
    ],
  }
);

WaitlistEntry.associate = ({ Trip, User, Station, CoachClass, SeatHold, Booking }) => {
  WaitlistEntry.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  WaitlistEntry.belongsTo(User, { foreignKey: "userId", as: "user" });
  WaitlistEntry.belongsTo(Station, { foreignKey: "fromStationId", as: "fromStation" });
  WaitlistEntry.belongsTo(Station, { foreignKey: "toStationId", as: "toStation" });
  WaitlistEntry.belongsTo(CoachClass, { foreignKey: "coachClassId", as: "coachClass" });
  WaitlistEntry.belongsTo(SeatHold, { foreignKey: "holdId", as: "hold" });
  WaitlistEntry.belongsTo(Booking, { foreignKey: "bookingId", as: "booking" });
};

module.exports = WaitlistEntry;
module.exports.WAITLIST_STATUS = WAITLIST_STATUS;
module.exports.OPEN_STATUSES = OPEN_STATUSES;
