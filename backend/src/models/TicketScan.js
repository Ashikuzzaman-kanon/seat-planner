const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Every time somebody points a scanner at a ticket.
 *
 * ## Why refusals are recorded, not just successes
 *
 * The obvious design records a scan when a ticket is accepted. That throws away
 * the half of the data worth having. A ticket presented twice is the signal
 * that a screenshot is circulating; a ticket presented on the wrong train is
 * either a confused passenger or a probe; a forged signature is somebody
 * trying. None of that exists if only the accepted scans are written down.
 *
 * So this is an append-only log of *attempts*, each with the verdict the
 * checker was shown. `ticket_id` is nullable because a forged or malformed code
 * does not correspond to any ticket, and those attempts are exactly the ones
 * worth keeping.
 *
 * ## Why the ticket still carries its own `used` status
 *
 * Deriving "has this been used" from this table would mean a query per scan on
 * a table that only grows. The ticket's status is the fast answer; this is the
 * evidence behind it.
 *
 * ## Offline
 *
 * A checker on a moving train has no network (§14). Their device verifies the
 * signature on its own, records the scan locally, and syncs later — so
 * `scanned_at` is when the scan *happened*, which may be hours before the row
 * was written, and `synced_at` is when it arrived. `client_reference` is the
 * device's own id for the scan, unique so that a sync retried after a dropped
 * connection cannot record the same scan twice.
 */
const SCAN_VERDICT = Object.freeze({
  /** Genuine, valid, for this service, and now marked used. */
  ACCEPTED: "accepted",
  /** Genuine and valid, but the checker only looked — nothing was marked. */
  CHECKED: "checked",
  /** Already scanned. The refusal names when and where. */
  ALREADY_USED: "already_used",
  /** Cancelled, refunded, or transferred away. */
  NOT_VALID: "not_valid",
  /** Real ticket, wrong train or wrong day. */
  WRONG_SERVICE: "wrong_service",
  /** The signature did not verify. Somebody made this up. */
  FORGED: "forged",
  /** Not a ticket code at all. */
  UNREADABLE: "unreadable",
  /** Signature verified but no such ticket exists here. */
  UNKNOWN: "unknown",
});

/** The verdicts that mean "do not let this person travel on this". */
const REFUSALS = [
  SCAN_VERDICT.ALREADY_USED,
  SCAN_VERDICT.NOT_VALID,
  SCAN_VERDICT.WRONG_SERVICE,
  SCAN_VERDICT.FORGED,
  SCAN_VERDICT.UNREADABLE,
  SCAN_VERDICT.UNKNOWN,
];

class TicketScan extends Model {
  get refused() {
    return REFUSALS.includes(this.verdict);
  }

  toPublicJSON() {
    return {
      id: this.id,
      ticketNumber: this.ticketNumber,
      verdict: this.verdict,
      refused: this.refused,
      scannedAt: this.scannedAt,
      syncedAt: this.syncedAt,
      offline: this.offline,
      stationId: this.stationId,
      tripId: this.tripId,
      checkedById: this.checkedById,
      note: this.note,
    };
  }
}

TicketScan.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    /** Null when the code was forged, unreadable, or names no ticket we hold. */
    ticketId: { type: DataTypes.INTEGER, allowNull: true },

    /**
     * Kept as text as well as by id, because a forged code still claims a
     * ticket number and that claim is worth keeping.
     */
    ticketNumber: { type: DataTypes.STRING(20), allowNull: true },

    tripId: { type: DataTypes.INTEGER, allowNull: true },

    checkedById: { type: DataTypes.INTEGER, allowNull: false },
    stationId: { type: DataTypes.INTEGER, allowNull: true },

    verdict: {
      type: DataTypes.ENUM(...Object.values(SCAN_VERDICT)),
      allowNull: false,
    },

    /** When the scan happened — not when the row was written. See above. */
    scannedAt: { type: DataTypes.DATE, allowNull: false },
    /** When it reached the server. Equal to `scannedAt` for an online scan. */
    syncedAt: { type: DataTypes.DATE, allowNull: true },
    offline: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

    /**
     * The scanning device's own id for this scan. Unique, so a sync retried
     * after a dropped connection records nothing twice.
     */
    clientReference: { type: DataTypes.STRING(64), allowNull: true, unique: true },

    note: { type: DataTypes.STRING(255), allowNull: true },
  },
  {
    sequelize,
    modelName: "TicketScan",
    tableName: "ticket_scans",
    indexes: [
      // "Has this ticket been scanned, and when" — the refusal message needs it.
      { fields: ["ticket_id", "scanned_at"] },
      // A trip's scan history, for reconciling a service after it has run.
      { fields: ["trip_id", "scanned_at"] },
      // What one checker did on a shift.
      { fields: ["checked_by_id", "scanned_at"] },
      // Counting refusals against an account feeds the abuse score.
      { fields: ["verdict", "scanned_at"] },
    ],
  }
);

TicketScan.associate = ({ Ticket, Trip, User, Station }) => {
  TicketScan.belongsTo(Ticket, { foreignKey: "ticketId", as: "ticket" });
  TicketScan.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  TicketScan.belongsTo(User, { foreignKey: "checkedById", as: "checkedBy" });
  TicketScan.belongsTo(Station, { foreignKey: "stationId", as: "station" });
};

module.exports = TicketScan;
module.exports.SCAN_VERDICT = SCAN_VERDICT;
module.exports.REFUSALS = REFUSALS;
