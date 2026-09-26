const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A checker saying something is wrong with a ticket (§14).
 *
 * ## Why this is not just a scan verdict
 *
 * A scan answers a machine's question — is this code genuine, is this ticket
 * still good. A report answers a human's: the code verified, the ticket is
 * valid, and the person holding it is not the person on it. No signature check
 * catches that, and no automatic verdict can. It takes a checker looking at a
 * face and a card and deciding, which is why reporting sits behind a higher
 * permission than scanning does.
 *
 * ## Why the account is recorded, not only the ticket
 *
 * A report against one ticket is an incident. Several against tickets bought by
 * the same account is a pattern, and the pattern is the thing worth acting on.
 * Storing `reported_user_id` at the time of the report means the signal
 * survives the ticket being transferred, refunded or deleted afterwards.
 *
 * ## What a report is not
 *
 * It is not a penalty. Nothing here suspends anybody. A report is a signal that
 * feeds a score (§14, `abuseService`), and only a human working a review queue
 * decides what follows — because a checker can be mistaken, and a passenger
 * with a genuine ticket and an unusual name should not be locked out by an
 * arithmetic.
 */
const REPORT_KIND = Object.freeze({
  /** The person travelling is not the person on the ticket. */
  IDENTITY_MISMATCH: "identity_mismatch",
  /** The same ticket is circulating — a screenshot, a photocopy. */
  DUPLICATE_IN_USE: "duplicate_in_use",
  /** The code did not verify but was presented as genuine. */
  FORGERY: "forgery",
  /** Travelling beyond the stretch paid for. */
  BEYOND_JOURNEY: "beyond_journey",
  /** Anything else, with the checker's words. */
  OTHER: "other",
});

const REPORT_STATUS = Object.freeze({
  /** Waiting on a human. */
  OPEN: "open",
  /** A reviewer agreed. The signal counts. */
  UPHELD: "upheld",
  /** A reviewer disagreed. The signal is withdrawn. */
  DISMISSED: "dismissed",
});

class TicketReport extends Model {
  get isOpen() {
    return this.status === REPORT_STATUS.OPEN;
  }

  toPublicJSON() {
    return {
      reference: this.reference,
      ticketId: this.ticketId,
      ticketNumber: this.ticketNumber,
      tripId: this.tripId,
      kind: this.kind,
      status: this.status,
      detail: this.detail,
      reportedUserId: this.reportedUserId,
      reportedById: this.reportedById,
      stationId: this.stationId,
      reviewedById: this.reviewedById,
      reviewedAt: this.reviewedAt,
      reviewNote: this.reviewNote,
      reportedAt: this.createdAt,
    };
  }
}

TicketReport.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    reference: { type: DataTypes.STRING(40), allowNull: false, unique: true },

    ticketId: { type: DataTypes.INTEGER, allowNull: true },
    /** Kept as text too, so the report survives the ticket row going away. */
    ticketNumber: { type: DataTypes.STRING(20), allowNull: true },
    tripId: { type: DataTypes.INTEGER, allowNull: true },

    /**
     * Whose account the ticket belonged to when this was raised. Copied rather
     * than joined, because the point of a report is the pattern it belongs to
     * and a transfer must not move the history with the ticket.
     */
    reportedUserId: { type: DataTypes.INTEGER, allowNull: true },

    reportedById: { type: DataTypes.INTEGER, allowNull: false },
    stationId: { type: DataTypes.INTEGER, allowNull: true },

    kind: {
      type: DataTypes.ENUM(...Object.values(REPORT_KIND)),
      allowNull: false,
    },

    /** The checker's own words. Required: a report with no account of what
     *  happened is not reviewable, and an unreviewable report is noise. */
    detail: { type: DataTypes.STRING(1000), allowNull: false },

    status: {
      type: DataTypes.ENUM(...Object.values(REPORT_STATUS)),
      allowNull: false,
      defaultValue: REPORT_STATUS.OPEN,
    },

    reviewedById: { type: DataTypes.INTEGER, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    reviewNote: { type: DataTypes.STRING(500), allowNull: true },
  },
  {
    sequelize,
    modelName: "TicketReport",
    tableName: "ticket_reports",
    indexes: [
      // Scoring an account: every upheld report against them.
      { fields: ["reported_user_id", "status"] },
      // The review queue, oldest first.
      { fields: ["status", "id"] },
      { fields: ["ticket_id"] },
      { fields: ["trip_id"] },
    ],
  }
);

TicketReport.associate = ({ Ticket, Trip, User, Station }) => {
  TicketReport.belongsTo(Ticket, { foreignKey: "ticketId", as: "ticket" });
  TicketReport.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  TicketReport.belongsTo(User, { foreignKey: "reportedUserId", as: "reportedUser" });
  TicketReport.belongsTo(User, { foreignKey: "reportedById", as: "reportedBy" });
  TicketReport.belongsTo(User, { foreignKey: "reviewedById", as: "reviewedBy" });
  TicketReport.belongsTo(Station, { foreignKey: "stationId", as: "station" });
};

module.exports = TicketReport;
module.exports.REPORT_KIND = REPORT_KIND;
module.exports.REPORT_STATUS = REPORT_STATUS;
