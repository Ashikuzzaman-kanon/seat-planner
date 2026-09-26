const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Seats held while someone pays.
 *
 * Without this, two people can each see a seat as free, both start paying, and
 * one of them loses after their money has moved. A hold occupies the segments
 * immediately — through the same `seat_segment_bookings` path everything else
 * uses — so the seat leaves availability the moment checkout begins.
 *
 * Holds expire. An abandoned checkout must not take a seat out of sale
 * indefinitely, so a background job releases them and the seat returns.
 */
const HOLD_STATUS = Object.freeze({
  ACTIVE: "active",
  CONVERTED: "converted",
  EXPIRED: "expired",
  RELEASED: "released",
});

class SeatHold extends Model {
  get isLive() {
    return this.status === HOLD_STATUS.ACTIVE && this.expiresAt > new Date();
  }

  get secondsRemaining() {
    if (!this.isLive) return 0;
    return Math.max(0, Math.round((this.expiresAt - new Date()) / 1000));
  }

  toPublicJSON() {
    return {
      id: this.id,
      reference: this.reference,
      tripId: this.tripId,
      userId: this.userId,
      fromStationId: this.fromStationId,
      toStationId: this.toStationId,
      seatIds: this.seatIds || [],
      status: this.status,
      expiresAt: this.expiresAt,
      secondsRemaining: this.secondsRemaining,
      isLive: this.isLive,
      createdAt: this.createdAt,
    };
  }
}

SeatHold.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    /** Opaque handle the client carries through checkout. */
    reference: { type: DataTypes.STRING(40), allowNull: false, unique: true },

    tripId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },

    fromStationId: { type: DataTypes.INTEGER, allowNull: false },
    toStationId: { type: DataTypes.INTEGER, allowNull: false },

    /** The seats this hold covers, so it can be released without a join. */
    seatIds: { type: DataTypes.JSON, allowNull: false },

    status: {
      type: DataTypes.ENUM(...Object.values(HOLD_STATUS)),
      allowNull: false,
      defaultValue: HOLD_STATUS.ACTIVE,
    },

    expiresAt: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: "SeatHold",
    tableName: "seat_holds",
    indexes: [
      // The expiry job scans on exactly this.
      { fields: ["status", "expires_at"] },
      { fields: ["user_id"] },
      { fields: ["trip_id"] },
    ],
  }
);

SeatHold.associate = ({ Trip, User }) => {
  SeatHold.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  SeatHold.belongsTo(User, { foreignKey: "userId", as: "user" });
};

module.exports = SeatHold;
module.exports.HOLD_STATUS = HOLD_STATUS;
