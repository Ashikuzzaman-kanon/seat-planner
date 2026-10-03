const { Op, QueryTypes } = require("sequelize");
const { sequelize, Notification } = require("../models");
const { NOTIFICATION_TONES, NOTIFICATION_CATEGORIES } = require("../models/Notification");
const { RESERVED_ROLES } = require("../constants/roles");
const ApiError = require("../utils/ApiError");
const settings = require("./settingService");

/**
 * In-app notifications: each person's inbox.
 *
 * ## Writing never fails the caller
 *
 * A notification is about something that has already happened and been
 * committed — a refund paid, a train cancelled. Failing to note it must not
 * turn that success into an error, so the `try…` functions log and carry on.
 *
 * ## Writing twice is writing once
 *
 * A notification can carry a key, unique per person. A queued job retried
 * after its email failed writes the same key again and is quietly ignored, so
 * nobody finds the same news in their inbox three times.
 *
 * ## Reading is cheap
 *
 * The bell asks only for a count and the newest id, which an index answers;
 * the list is fetched when that id moves or the panel opens.
 */

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const CATEGORIES = new Set(Object.values(NOTIFICATION_CATEGORIES));

const clip = (text, max) => {
  if (text == null) return null;
  const s = String(text).replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** The fields as stored, checked and trimmed to fit. */
function shape(n) {
  if (!n?.type || !n?.title) throw new Error("A notification needs a type and a title");
  return {
    type: String(n.type).slice(0, 64),
    category: CATEGORIES.has(n.category) ? n.category : NOTIFICATION_CATEGORIES.SYSTEM,
    tone: NOTIFICATION_TONES.includes(n.tone) ? n.tone : "info",
    title: clip(n.title, 200),
    body: clip(n.body, 1000),
    // Only a path inside the app: a notification is not a way to send someone elsewhere.
    link: typeof n.link === "string" && /^\/(?!\/)/.test(n.link) ? n.link.slice(0, 300) : null,
    dedupeKey: n.key ? String(n.key).slice(0, 150) : null,
  };
}

/** Write one. Returns null when the same key was already delivered. */
async function add(userId, n, { transaction } = {}) {
  if (!userId) return null;
  try {
    return await Notification.create({ userId, ...shape(n) }, { transaction });
  } catch (err) {
    if (err.name === "SequelizeUniqueConstraintError") return null;
    throw err;
  }
}

/** Write one, and never throw. */
async function tryAdd(userId, n) {
  try {
    return await add(userId, n);
  } catch (err) {
    console.error(`[inbox] could not note "${n?.title}" for user ${userId}: ${err.message}`);
    return null;
  }
}

/** Accounts that hold a permission — directly through a role, or as a super admin. */
async function holdersOf(permission) {
  const rows = await sequelize.query(
    `SELECT DISTINCT ur.user_id AS id
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name = :superAdmin OR p.\`key\` = :permission`,
    { replacements: { superAdmin: RESERVED_ROLES.SUPER_ADMIN, permission }, type: QueryTypes.SELECT }
  );
  return rows.map((r) => r.id);
}

/**
 * Tell everyone who can act on something — except whoever caused it, who
 * already knows. Never throws; returns how many were told.
 */
async function toHolders(permission, n, { except = [] } = {}) {
  try {
    const skip = new Set(except.filter(Boolean).map(Number));
    const ids = (await holdersOf(permission)).filter((id) => !skip.has(id));
    for (const id of ids) await tryAdd(id, n);
    return ids.length;
  } catch (err) {
    console.error(`[inbox] could not reach holders of ${permission}: ${err.message}`);
    return 0;
  }
}

/* ------------------------------------------------------------------ *
 * Reading and tidying, always one person's own
 * ------------------------------------------------------------------ */

/** What the bell needs: how many are unread, and the newest id to spot arrivals. */
async function summary(userId) {
  const [unreadCount, latestId] = await Promise.all([
    Notification.count({ where: { userId, readAt: null } }),
    Notification.max("id", { where: { userId } }),
  ]);
  return { unreadCount, latestId: latestId || 0 };
}

/** Newest first, a page at a time; `before` is the last id of the previous page. */
async function list(userId, { unread = false, category, before, limit = PAGE_SIZE } = {}) {
  const size = Math.min(Math.max(Number(limit) || PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const where = { userId };
  if (unread) where.readAt = null;
  if (category && CATEGORIES.has(category)) where.category = category;
  if (before) where.id = { [Op.lt]: Number(before) };

  const rows = await Notification.findAll({ where, order: [["id", "DESC"]], limit: size + 1 });
  const page = rows.slice(0, size);
  return {
    notifications: page.map((n) => n.toPublicJSON()),
    nextCursor: rows.length > size ? page[page.length - 1].id : null,
    ...(await summary(userId)),
  };
}

async function markRead(userId, ids) {
  const where = { userId, readAt: null };
  if (ids !== "all") {
    const wanted = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
    if (!wanted.length) throw ApiError.badRequest("Say which notifications, or all of them");
    where.id = wanted;
  }
  await Notification.update({ readAt: new Date() }, { where });
  return summary(userId);
}

async function markUnread(userId, id) {
  const [changed] = await Notification.update({ readAt: null }, { where: { userId, id: Number(id) } });
  if (!changed) throw ApiError.notFound("No such notification");
  return summary(userId);
}

async function remove(userId, id) {
  const removed = await Notification.destroy({ where: { userId, id: Number(id) } });
  if (!removed) throw ApiError.notFound("No such notification");
  return summary(userId);
}

/** Delete what is older than the configured number of days. A recurring sweep. */
async function prune() {
  const days = settings.get("notifications.keep_days");
  const removed = await Notification.destroy({
    where: { createdAt: { [Op.lt]: new Date(Date.now() - days * 86_400_000) } },
  });
  return { removed, olderThanDays: days };
}

module.exports = {
  CATEGORY: NOTIFICATION_CATEGORIES,
  add,
  tryAdd,
  holdersOf,
  toHolders,
  summary,
  list,
  markRead,
  markUnread,
  remove,
  prune,
};
