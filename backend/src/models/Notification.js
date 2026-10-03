const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Something that happened which a person should know about, kept in their
 * in-app inbox.
 *
 * The email about the same event may never arrive — no address, a mail server
 * down, a spam folder — so the inbox is the record a person can rely on. It
 * holds words, not live data: a title and a sentence written when the event
 * happened, and a link to the page where the current state lives.
 */
const NOTIFICATION_TONES = Object.freeze(["info", "success", "warning", "danger", "neutral"]);

/** What a notification is about, for the icon and the inbox filter. */
const NOTIFICATION_CATEGORIES = Object.freeze({
  BOOKING: "booking",
  REFUND: "refund",
  WAITLIST: "waitlist",
  ACCOUNT: "account",
  APPROVAL: "approval",
  PLAN: "plan",
  SYSTEM: "system",
});

class Notification extends Model {
  toPublicJSON() {
    return {
      id: this.id,
      type: this.type,
      category: this.category,
      tone: this.tone,
      title: this.title,
      body: this.body,
      link: this.link,
      read: Boolean(this.readAt),
      readAt: this.readAt,
      createdAt: this.createdAt,
    };
  }
}

Notification.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.STRING(64), allowNull: false },
    category: { type: DataTypes.STRING(32), allowNull: false },
    tone: { type: DataTypes.ENUM(...NOTIFICATION_TONES), allowNull: false, defaultValue: "info" },
    title: { type: DataTypes.STRING(200), allowNull: false },
    body: { type: DataTypes.STRING(1000), allowNull: true },
    /** A path in the app, never an outside address. */
    link: { type: DataTypes.STRING(300), allowNull: true },
    /** Unique per person; makes writing the same notification twice a no-op. */
    dedupeKey: { type: DataTypes.STRING(150), allowNull: true },
    readAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    modelName: "Notification",
    tableName: "notifications",
    indexes: [{ unique: true, fields: ["user_id", "dedupe_key"] }],
  }
);

Notification.associate = ({ User }) => {
  Notification.belongsTo(User, { foreignKey: "userId", as: "user", onDelete: "CASCADE" });
};

module.exports = Notification;
module.exports.NOTIFICATION_TONES = NOTIFICATION_TONES;
module.exports.NOTIFICATION_CATEGORIES = NOTIFICATION_CATEGORIES;
