const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One request for the seat allocation — see the migrations
 * 20260202000000-public-visits and 20260203000000-allocation-requests for
 * what is kept and why.
 *
 * channel:  public (the /seat-allocation page) or app (a search inside the app)
 * kind:     status, meta, list, pass (the bot check)
 * outcome:  shown, sign_in (asked to sign in), rate_limited, bot_check,
 *           off (the page was switched off), refused (no edge header)
 */
const VISIT_CHANNELS = Object.freeze({ PUBLIC: "public", APP: "app" });

const VISIT_OUTCOMES = Object.freeze({
  SHOWN: "shown",
  SIGN_IN: "sign_in",
  RATE_LIMITED: "rate_limited",
  BOT_CHECK: "bot_check",
  OFF: "off",
  REFUSED: "refused",
});

class PublicVisit extends Model {}

PublicVisit.init(
  {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    kind: { type: DataTypes.STRING(20), allowNull: false },
    outcome: { type: DataTypes.STRING(20), allowNull: false },
    channel: { type: DataTypes.STRING(10), allowNull: false, defaultValue: VISIT_CHANNELS.PUBLIC },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    country: { type: DataTypes.STRING(8), allowNull: true },
    city: { type: DataTypes.STRING(80), allowNull: true },
    visitorId: { type: DataTypes.STRING(64), allowNull: true },
    userId: { type: DataTypes.INTEGER, allowNull: true },
    userAgent: { type: DataTypes.STRING(400), allowNull: true },
    browser: { type: DataTypes.STRING(40), allowNull: true },
    os: { type: DataTypes.STRING(40), allowNull: true },
    device: { type: DataTypes.STRING(20), allowNull: true },
    language: { type: DataTypes.STRING(60), allowNull: true },
    referrer: { type: DataTypes.STRING(300), allowNull: true },
    query: { type: DataTypes.JSON, allowNull: true },
    queryKey: { type: DataTypes.STRING(300), allowNull: true },
    results: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    modelName: "PublicVisit",
    tableName: "public_visits",
    indexes: [
      { fields: ["created_at"] },
      { fields: ["visitor_id", "created_at"] },
      { fields: ["ip", "created_at"] },
      { fields: ["channel", "created_at"] },
    ],
  }
);

PublicVisit.associate = ({ User }) => {
  PublicVisit.belongsTo(User, { foreignKey: "userId", as: "user" });
};

module.exports = PublicVisit;
module.exports.VISIT_OUTCOMES = VISIT_OUTCOMES;
module.exports.VISIT_CHANNELS = VISIT_CHANNELS;
