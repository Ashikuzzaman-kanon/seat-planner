const { literal, Op } = require("sequelize");
const { Subscription, SubscriptionPlatform, SubscriptionAppNotice, UserDevice, User } = require("../models");
const { NOTICE_KIND } = require("../models/SubscriptionAppNotice");
const { SUBSCRIPTION_STATUS: STATUS } = require("../models/UserSubscription");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { cleanVersion } = require("../utils/appVersion");
const audit = require("./auditService");
const notify = require("./notificationService");

const jobs = () => require("./jobService");

/**
 * Notices to a subscription's subscribers about its app: a new version is
 * out, or an old one is going away.
 *
 * Sent by hand from the Versions tab, for one subscription and one platform,
 * to the people it concerns: everyone currently subscribed who has a device
 * on that platform. Each gets an in-app notification at once; with `email`,
 * an email too, each through a queued job of its own so a long list neither
 * holds the request up nor loses a message to a mail server that is down.
 */

const MAX_MESSAGE = 1000;

/** The words a notice starts from, which the sender can change. */
function suggestedMessage(kind, { subscription, platform, version }) {
  return kind === NOTICE_KIND.RELEASED
    ? `Version ${version} of the ${subscription} app for ${platform} is out. Update to get the latest.`
    : `Version ${version} of the ${subscription} app for ${platform} is going away and will stop working. Please update to the latest version.`;
}

/** Everyone currently subscribed with a device on this platform, as SQL for an IN. */
const subscribersOf = (subscriptionId) =>
  literal(
    `(SELECT user_id FROM user_subscriptions WHERE subscription_id = ${Number(subscriptionId)} ` +
      `AND status = '${STATUS.ACTIVE}' AND expires_at > UTC_TIMESTAMP())`
  );

/** The accounts a notice for this subscription and platform goes to. */
async function recipientsOf(subscriptionId, platformId) {
  const rows = await UserDevice.findAll({
    where: { platformId, isBlocked: false, userId: { [Op.in]: subscribersOf(subscriptionId) } },
    attributes: ["userId"],
    group: ["userId"],
    raw: true,
  });
  return rows.map((r) => r.userId);
}

/** How many a notice would reach on each platform: `{ "<platformId>": n }`. */
async function reachOf(subscriptionId) {
  const rows = await UserDevice.findAll({
    where: { isBlocked: false, userId: { [Op.in]: subscribersOf(subscriptionId) } },
    attributes: ["platformId", "userId"],
    group: ["platformId", "userId"],
    raw: true,
  });
  return rows.reduce((reach, r) => ({ ...reach, [r.platformId]: (reach[r.platformId] || 0) + 1 }), {});
}

/** The notices sent for a subscription, newest first. */
async function history(subscriptionId, { limit = 50 } = {}) {
  const rows = await SubscriptionAppNotice.findAll({
    where: { subscriptionId },
    include: [{ model: User, as: "sentBy", attributes: ["id", "fullName"] }],
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    limit,
  });
  return rows.map((n) => n.toPublicJSON());
}

/**
 * Send a notice. `{ kind, version, message, email }`: `kind` is `released` or
 * `retiring`, `message` the words subscribers read, `email` whether they are
 * emailed as well as told in the app.
 */
async function send(subscriptionId, platformId, { kind, version, message, email = false }, actor) {
  const [subscription, platform] = await Promise.all([
    Subscription.findByPk(subscriptionId, { attributes: ["id", "code", "name", "appUrl"] }),
    SubscriptionPlatform.findByPk(platformId),
  ]);
  if (!subscription) throw ApiError.notFound("No such subscription");
  if (!platform) throw ApiError.notFound("No such platform");
  if (!Object.values(NOTICE_KIND).includes(kind)) throw ApiError.badRequest("kind is released or retiring");
  const clean = cleanVersion(version);
  if (!clean) throw ApiError.badRequest("The version is not valid. Write it as numbers and dots, such as 1.4.2");
  const words = typeof message === "string" ? message.trim() : "";
  if (!words) throw ApiError.badRequest("Write the message subscribers will read");
  if (words.length > MAX_MESSAGE) throw ApiError.badRequest(`The message is at most ${MAX_MESSAGE} characters`);

  const userIds = await recipientsOf(subscription.id, platform.id);
  if (!userIds.length) {
    throw ApiError.badRequest(`Nobody to tell: no current subscriber has a ${platform.name} device`);
  }

  const notice = await SubscriptionAppNotice.create({
    subscriptionId: subscription.id,
    platformId: platform.id,
    kind,
    version: clean,
    message: words,
    emailed: Boolean(email),
    recipients: userIds.length,
    sentById: actor?.id ?? null,
  });

  const details = {
    noticeId: notice.id,
    kind,
    version: clean,
    message: words,
    subscription: subscription.name,
    platform: platform.name,
    appUrl: subscription.appUrl,
  };
  for (const userId of userIds) {
    await notify.appNotice({ ...details, userId }, { inAppOnly: true });
    if (email) {
      await jobs().enqueue("notify.app_notice", { ...details, userId }, {
        dedupeKey: `app-notice:${notice.id}:${userId}`,
        label: `Email notice ${notice.id} about ${platform.name} ${clean}`,
      });
    }
  }

  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_APP_NOTICE,
    entity: { type: "subscription", id: subscription.id, label: subscription.name },
    after: { platform: platform.value, kind, version: clean, emailed: Boolean(email), recipients: userIds.length },
    message:
      `${subscription.name}, ${platform.name} app ${clean}: ${kind === NOTICE_KIND.RELEASED ? "release" : "retirement"} ` +
      `notice sent to ${userIds.length} subscriber(s)${email ? ", by email too" : ""}`,
  });

  const [saved] = await SubscriptionAppNotice.findAll({
    where: { id: notice.id },
    include: [{ model: User, as: "sentBy", attributes: ["id", "fullName"] }],
  });
  return saved.toPublicJSON();
}

module.exports = { NOTICE_KIND, MAX_MESSAGE, suggestedMessage, recipientsOf, reachOf, history, send };
