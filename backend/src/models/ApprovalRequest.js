const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One queue for every decision a human has to make.
 *
 * The spec names three (§16.1): transferring a ticket to a different National
 * ID, withdrawing wallet credit, and reviewing an account flagged for abuse.
 * They differ in what they are about and in who may decide them, and in
 * nothing else — each is "someone asked, someone with authority says yes or
 * no, and the reason is kept". Building three tables would have meant building
 * the same list screen, the same audit trail and the same race condition three
 * times.
 *
 * So the subject is stored as a type and an id rather than a foreign key. That
 * is the deliberate trade: the database cannot enforce that `subjectId` points
 * at a real ticket, and in exchange a fourth kind of approval costs a constant
 * and a handler. The service that creates each kind resolves and validates its
 * own subject, which is where that check belongs anyway.
 *
 * `payload` carries what the decision needs but the subject does not hold —
 * the National ID a ticket is being transferred to, the amount being withdrawn.
 * Kept as JSON because those shapes have nothing in common.
 */

const APPROVAL_TYPE = Object.freeze({
  TICKET_TRANSFER: "ticket_transfer",
  WALLET_WITHDRAWAL: "wallet_withdrawal",
  ABUSE_REVIEW: "abuse_review",
});

const APPROVAL_STATUS = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
});

class ApprovalRequest extends Model {
  get isOpen() {
    return this.status === APPROVAL_STATUS.PENDING;
  }

  toPublicJSON() {
    return {
      id: this.id,
      reference: this.reference,
      type: this.type,
      status: this.status,
      isOpen: this.isOpen,

      subjectType: this.subjectType,
      subjectId: this.subjectId,
      subjectLabel: this.subjectLabel,

      requestedById: this.requestedById,
      requestedBy: this.requestedBy
        ? { id: this.requestedBy.id, email: this.requestedBy.email, fullName: this.requestedBy.fullName }
        : undefined,
      reason: this.reason,
      payload: this.payload || {},

      decidedById: this.decidedById,
      decidedBy: this.decidedBy
        ? { id: this.decidedBy.id, email: this.decidedBy.email, fullName: this.decidedBy.fullName }
        : undefined,
      decidedAt: this.decidedAt,
      decisionNote: this.decisionNote,

      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

ApprovalRequest.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    /** Short handle a requester can quote when asking about their request. */
    reference: { type: DataTypes.STRING(20), allowNull: false, unique: true },

    type: { type: DataTypes.ENUM(...Object.values(APPROVAL_TYPE)), allowNull: false },

    status: {
      type: DataTypes.ENUM(...Object.values(APPROVAL_STATUS)),
      allowNull: false,
      defaultValue: APPROVAL_STATUS.PENDING,
    },

    /**
     * What the request is about. Not a foreign key on purpose — see the note
     * above. `subjectLabel` is denormalised so a decided request still reads
     * sensibly years later, even if the subject has since been deleted.
     */
    subjectType: { type: DataTypes.STRING(40), allowNull: false },
    subjectId: { type: DataTypes.STRING(64), allowNull: false },
    subjectLabel: { type: DataTypes.STRING(200), allowNull: true },

    requestedById: { type: DataTypes.INTEGER, allowNull: false },
    reason: { type: DataTypes.STRING(500), allowNull: true },

    /** Type-specific detail the decision needs. */
    payload: { type: DataTypes.JSON, allowNull: true },

    decidedById: { type: DataTypes.INTEGER, allowNull: true },
    decidedAt: { type: DataTypes.DATE, allowNull: true },
    decisionNote: { type: DataTypes.STRING(500), allowNull: true },
  },
  {
    sequelize,
    modelName: "ApprovalRequest",
    tableName: "approval_requests",
    indexes: [
      // The queue screen: open requests of one kind, oldest first.
      { fields: ["type", "status", "created_at"] },
      { fields: ["requested_by_id"] },
      { fields: ["subject_type", "subject_id"] },
    ],
  }
);

ApprovalRequest.associate = ({ User }) => {
  ApprovalRequest.belongsTo(User, { foreignKey: "requestedById", as: "requestedBy" });
  ApprovalRequest.belongsTo(User, { foreignKey: "decidedById", as: "decidedBy" });
};

module.exports = ApprovalRequest;
module.exports.APPROVAL_TYPE = APPROVAL_TYPE;
module.exports.APPROVAL_STATUS = APPROVAL_STATUS;
