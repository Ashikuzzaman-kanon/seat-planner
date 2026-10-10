const { Op } = require("sequelize");
const { sequelize, Subscription, UserSubscription, User } = require("../models");
const { SUBSCRIPTION_STATUS: STATUS, LIVE_STATUSES } = require("../models/UserSubscription");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { PERMISSIONS } = require("../constants/permissions");
const { resolvePeriod, lastDayOf, expiryOf } = require("../utils/subscriptionPeriod");
const { todayInDhaka, addDays } = require("../utils/dhakaTime");
const settings = require("./settingService");
const audit = require("./auditService");
const inbox = require("./inboxService");
const notify = require("./notificationService");

/**
 * Subscriptions: what can be subscribed to, and each person's subscription.
 *
 * Someone holding `subscription:manage` creates a subscription. Anyone signed
 * in can ask for it; someone holding `subscription:approve` approves the
 * request for a period they choose, or declines it. It then runs until that
 * period is over, or until the subscriber or a reviewer cancels it.
 *
 * Three things hold throughout:
 *
 *   - **Whether a subscription is valid is asked of the clock**, not only of
 *     its status (UserSubscription#isValid). The hourly sweep that marks rows
 *     expired is for tidy lists and telling people; nothing waits on it.
 *   - **A person has one live subscription to a thing at most** — pending or
 *     active — which the unique `live_key` enforces, so two requests arriving
 *     together cannot both be taken.
 *   - **A decision happens once.** Approving, declining, cancelling and
 *     extending all lock the row first, so two reviewers acting at the same
 *     moment cannot both act on it.
 */

const PAGE = "/dashboard/subscriptions";
const LINK = Object.freeze({ mine: PAGE, requests: `${PAGE}?tab=requests` });

const PERSON = ["id", "fullName", "email"];
const WITH_EVERYONE = [
  { model: Subscription, as: "subscription", attributes: ["id", "code", "name", "isOpen"] },
  { model: User, as: "user", attributes: PERSON },
  { model: User, as: "decidedBy", attributes: ["id", "fullName"] },
  { model: User, as: "endedBy", attributes: ["id", "fullName"] },
];

const liveKey = (userId, subscriptionId) => `${userId}:${subscriptionId}`;
const clean = (text) => (typeof text === "string" && text.trim() ? text.trim() : null);

/** "9 Nov 2026" from a YYYY-MM-DD calendar day. */
const longDate = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const entityOf = (subscription) => ({ type: "subscription", id: subscription.id, label: subscription.name });
const memberEntity = (row, subscription, user) => ({
  type: "user_subscription",
  id: row.id,
  label: `${user?.email || `user ${row.userId}`} — ${subscription?.name || `subscription ${row.subscriptionId}`}`,
});

/** A person's subscription as the pages show it, with whoever is attached. */
function present(row, now = new Date()) {
  return {
    ...row.toPublicJSON(now),
    subscription: row.subscription
      ? { id: row.subscription.id, code: row.subscription.code, name: row.subscription.name }
      : undefined,
    user: row.user ? { id: row.user.id, fullName: row.user.fullName, email: row.user.email } : undefined,
    decidedBy: row.decidedBy?.fullName || null,
    endedBy: row.endedBy?.fullName || null,
  };
}

/* ------------------------------------------------------------------ *
 * What can be subscribed to
 * ------------------------------------------------------------------ */

/** "Premium Plus!" -> "premium-plus"; a name with no Latin letters gets a plain fallback. */
function slug(name) {
  const base = String(name)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/, "");
  return base || "subscription";
}

async function freeCode(name) {
  const base = slug(name);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await Subscription.findOne({ where: { code: candidate }, attributes: ["id"] }))) return candidate;
  }
}

async function findOr404(id, options) {
  const subscription = await Subscription.findByPk(id, options);
  if (!subscription) throw ApiError.notFound("No such subscription");
  return subscription;
}

async function nameTaken(name, exceptId) {
  const where = { name };
  if (exceptId) where.id = { [Op.ne]: exceptId };
  return Boolean(await Subscription.findOne({ where, attributes: ["id"] }));
}

async function create({ name, description, code }, actor) {
  const title = clean(name);
  if (!title) throw ApiError.badRequest("A subscription needs a name");
  if (await nameTaken(title)) throw ApiError.conflict("There is already a subscription with that name");

  const given = clean(code);
  if (given && (await Subscription.findOne({ where: { code: given }, attributes: ["id"] }))) {
    throw ApiError.conflict("There is already a subscription with that code");
  }

  const subscription = await Subscription.create({
    name: title,
    description: clean(description),
    code: given || (await freeCode(title)),
    createdById: actor?.id ?? null,
  });

  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_CREATE,
    entity: entityOf(subscription),
    after: subscription.toPublicJSON(),
    message: `subscription "${subscription.name}" created (code ${subscription.code})`,
  });
  return subscription.toPublicJSON();
}

/**
 * Rename, re-describe, close or reopen. The code never changes.
 *
 * Closing declines whatever is still waiting — nobody is left wondering about
 * a request that can no longer be approved — and leaves running subscriptions
 * alone.
 */
async function update(id, { name, description, isOpen }, actor) {
  const declined = [];

  const { before, subscription } = await sequelize.transaction(async (transaction) => {
    const found = await findOr404(id, { transaction, lock: transaction.LOCK.UPDATE });
    const was = found.toPublicJSON();

    if (name !== undefined) {
      const title = clean(name);
      if (!title) throw ApiError.badRequest("A subscription needs a name");
      if (title !== found.name && (await nameTaken(title, found.id))) {
        throw ApiError.conflict("There is already a subscription with that name");
      }
      found.name = title;
    }
    if (description !== undefined) found.description = clean(description);
    if (isOpen !== undefined) found.isOpen = Boolean(isOpen);
    await found.save({ transaction });

    if (was.isOpen && !found.isOpen) {
      const waiting = await UserSubscription.findAll({
        where: { subscriptionId: found.id, status: STATUS.PENDING },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      for (const row of waiting) {
        await row.update(
          {
            status: STATUS.DECLINED,
            liveKey: null,
            decidedById: actor?.id ?? null,
            decidedAt: new Date(),
            decisionNote: "This subscription is no longer offered.",
          },
          { transaction }
        );
        declined.push(row);
      }
    }
    return { before: was, subscription: found };
  });

  for (const row of declined) {
    await inbox.tryAdd(row.userId, {
      type: "subscription.declined",
      category: inbox.CATEGORY.SUBSCRIPTION,
      tone: "warning",
      title: `${subscription.name} is no longer offered`,
      body: "Your request to subscribe was closed because the subscription was withdrawn.",
      link: LINK.mine,
      key: `subscription:${row.id}:decided`,
    });
  }

  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_UPDATE,
    entity: entityOf(subscription),
    before,
    after: { ...subscription.toPublicJSON(), requestsDeclined: declined.length || undefined },
    message:
      before.isOpen !== subscription.isOpen
        ? `subscription "${subscription.name}" ${subscription.isOpen ? "reopened" : "closed"}` +
          (declined.length ? ` — ${declined.length} waiting request(s) declined` : "")
        : `subscription "${subscription.name}" updated`,
  });
  return subscription.toPublicJSON();
}

/** Only one nobody has ever asked for can go; anything with history is closed instead. */
async function remove(id) {
  const subscription = await findOr404(id);
  if (await UserSubscription.count({ where: { subscriptionId: subscription.id } })) {
    throw ApiError.conflict(
      "People have asked for this subscription, so it cannot be deleted — close it to new requests instead"
    );
  }
  const before = subscription.toPublicJSON();
  await subscription.destroy();

  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_DELETE,
    entity: entityOf(subscription),
    before,
    message: `subscription "${subscription.name}" deleted`,
  });
  return { deleted: true };
}

/**
 * The subscriptions page: each subscription with the caller's own standing.
 *
 * `staff` (anyone who manages or approves) sees every subscription and how
 * many people are waiting or subscribed. Everyone else sees the open ones,
 * plus any closed one they have a history with.
 */
async function list(userId, { staff = false } = {}) {
  const now = new Date();
  const [subscriptions, own] = await Promise.all([
    Subscription.findAll({ order: [["name", "ASC"]] }),
    UserSubscription.findAll({ where: { userId }, order: [["id", "DESC"]] }),
  ]);

  // The row that says where the caller stands: the live one, else the latest.
  const mine = new Map();
  for (const row of own) {
    const held = mine.get(row.subscriptionId);
    const live = LIVE_STATUSES.includes(row.status) && (row.status === STATUS.PENDING || row.isValid(now));
    if (!held || (live && !held.live)) mine.set(row.subscriptionId, { row, live });
  }

  let counts = new Map();
  if (staff) {
    const rows = await UserSubscription.findAll({
      attributes: ["subscriptionId", "status", [sequelize.fn("COUNT", sequelize.col("id")), "n"]],
      where: {
        [Op.or]: [{ status: STATUS.PENDING }, { status: STATUS.ACTIVE, expiresAt: { [Op.gt]: now } }],
      },
      group: ["subscriptionId", "status"],
      raw: true,
    });
    counts = rows.reduce((map, r) => {
      const entry = map.get(r.subscriptionId) || { pending: 0, active: 0 };
      entry[r.status] = Number(r.n);
      return map.set(r.subscriptionId, entry);
    }, new Map());
  }

  return {
    subscriptions: subscriptions
      .filter((s) => staff || s.isOpen || mine.has(s.id))
      .map((s) => ({
        ...s.toPublicJSON(),
        mine: mine.has(s.id) ? mine.get(s.id).row.toPublicJSON(now) : null,
        ...(staff ? { counts: counts.get(s.id) || { pending: 0, active: 0 } } : {}),
      })),
  };
}

/* ------------------------------------------------------------------ *
 * Asking, and deciding
 * ------------------------------------------------------------------ */

/**
 * Mark one subscription that has run out as expired, and tell its holder.
 * Guarded on status, so the sweep and a request arriving together do it once.
 */
async function expire(row, subscription) {
  const [changed] = await UserSubscription.update(
    { status: STATUS.EXPIRED, liveKey: null },
    { where: { id: row.id, status: STATUS.ACTIVE } }
  );
  if (!changed) return false;

  await inbox.tryAdd(row.userId, {
    type: "subscription.expired",
    category: inbox.CATEGORY.SUBSCRIPTION,
    tone: "neutral",
    title: `Your ${subscription.name} subscription has ended`,
    body: `It ran until ${longDate(lastDayOf(row.expiresAt))}. You can ask to subscribe again.`,
    link: LINK.mine,
    key: `subscription:${row.id}:expired`,
  });
  return true;
}

/** Ask to be subscribed. */
async function request(subscriptionId, user) {
  const subscription = await findOr404(subscriptionId);
  if (!subscription.isOpen) throw ApiError.conflict("This subscription is not taking new requests");

  // One that ran out since the last sweep must not block asking again.
  const held = await UserSubscription.findOne({ where: { liveKey: liveKey(user.id, subscription.id) } });
  if (held?.status === STATUS.ACTIVE && !held.isValid()) await expire(held, subscription);
  else if (held) {
    throw ApiError.conflict(
      held.status === STATUS.PENDING
        ? "You have already asked for this subscription — it is waiting to be reviewed"
        : "You are already subscribed to this"
    );
  }

  let row;
  try {
    row = await UserSubscription.create({
      subscriptionId: subscription.id,
      userId: user.id,
      status: STATUS.PENDING,
      liveKey: liveKey(user.id, subscription.id),
    });
  } catch (err) {
    // Two requests at once: the unique key let one through.
    if (err.name === "SequelizeUniqueConstraintError") {
      throw ApiError.conflict("You have already asked for this subscription");
    }
    throw err;
  }

  await inbox.toHolders(
    PERMISSIONS.SUBSCRIPTION_APPROVE,
    {
      type: "subscription.requested",
      category: inbox.CATEGORY.SUBSCRIPTION,
      tone: "info",
      title: `${user.fullName} asked to subscribe to ${subscription.name}`,
      body: `${user.email} · waiting for someone to approve or decline it`,
      link: LINK.requests,
      key: `subscription:${row.id}:requested`,
    },
    { except: [user.id] }
  );

  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_REQUEST,
    entity: memberEntity(row, subscription, user),
    after: { status: row.status },
    message: `asked to subscribe to "${subscription.name}"`,
  });
  return row.toPublicJSON();
}

/**
 * Take one person's subscription, locked, check it is in a state the change
 * applies to, and apply it — all in one transaction.
 */
async function change(id, { from, apply }) {
  return sequelize.transaction(async (transaction) => {
    const row = await UserSubscription.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!row) throw ApiError.notFound("No such subscription request");

    const [subscription, user] = await Promise.all([
      Subscription.findByPk(row.subscriptionId, { transaction }),
      User.findByPk(row.userId, { attributes: PERSON, transaction }),
    ]);
    const before = row.toPublicJSON();
    from(row, { subscription, user });
    await apply(row, { transaction, subscription, user });
    return { row, before, subscription, user };
  });
}

const mustBePending = (row) => {
  if (row.status !== STATUS.PENDING) {
    throw ApiError.conflict(`This request has already been ${row.status === STATUS.ACTIVE ? "approved" : row.status}`);
  }
};

/** Approve a request for `days` from today, or through `lastDay`. */
async function approve(id, { days, lastDay, note }, actor) {
  const period = resolvePeriod({ days, lastDay });
  if (period.error) throw ApiError.badRequest(period.error);

  const { row, subscription, user } = await change(id, {
    from: mustBePending,
    apply: (found, { transaction }) =>
      found.update(
        {
          status: STATUS.ACTIVE,
          startsAt: new Date(),
          expiresAt: period.expiresAt,
          remindedAt: null,
          decidedById: actor.id,
          decidedAt: new Date(),
          decisionNote: clean(note),
        },
        { transaction }
      ),
  });

  await notify.subscriptionDecided({
    userId: row.userId,
    subscription,
    membershipId: row.id,
    approved: true,
    until: longDate(period.lastDay),
    note: row.decisionNote,
    decidedBy: actor.fullName,
  });
  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_APPROVE,
    entity: memberEntity(row, subscription, user),
    before: { status: STATUS.PENDING },
    after: { status: row.status, lastDay: period.lastDay, note: row.decisionNote },
    message: `subscription to "${subscription.name}" approved through ${period.lastDay}`,
  });
  return row.toPublicJSON();
}

async function decline(id, { note }, actor) {
  const { row, subscription, user } = await change(id, {
    from: mustBePending,
    apply: (found, { transaction }) =>
      found.update(
        {
          status: STATUS.DECLINED,
          liveKey: null,
          decidedById: actor.id,
          decidedAt: new Date(),
          decisionNote: clean(note),
        },
        { transaction }
      ),
  });

  await notify.subscriptionDecided({
    userId: row.userId,
    subscription,
    membershipId: row.id,
    approved: false,
    note: row.decisionNote,
    decidedBy: actor.fullName,
  });
  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_DECLINE,
    entity: memberEntity(row, subscription, user),
    before: { status: STATUS.PENDING },
    after: { status: row.status, note: row.decisionNote },
    message: `request to subscribe to "${subscription.name}" declined`,
  });
  return row.toPublicJSON();
}

/**
 * End a subscription now, or withdraw a request still waiting.
 *
 * The subscriber may always end their own. `staff` — someone holding
 * `subscription:approve` — may end anyone's; without it, somebody else's
 * subscription does not exist as far as the caller is told.
 */
async function cancel(id, { reason }, actor, { staff = false } = {}) {
  const { row, before, subscription, user } = await change(id, {
    from: (found) => {
      if (!staff && found.userId !== actor.id) throw ApiError.notFound("No such subscription request");
      if (found.status === STATUS.ACTIVE && !found.isValid()) {
        throw ApiError.conflict("This subscription has already expired");
      }
      if (!LIVE_STATUSES.includes(found.status)) {
        throw ApiError.conflict(`This subscription has already ${found.status === STATUS.DECLINED ? "been declined" : "ended"}`);
      }
    },
    apply: (found, { transaction }) =>
      found.update(
        {
          status: STATUS.CANCELLED,
          liveKey: null,
          endedById: actor.id,
          endedAt: new Date(),
          endReason: clean(reason),
        },
        { transaction }
      ),
  });

  const byOwner = row.userId === actor.id;
  if (!byOwner) {
    await inbox.tryAdd(row.userId, {
      type: "subscription.cancelled",
      category: inbox.CATEGORY.SUBSCRIPTION,
      tone: "warning",
      title:
        before.status === STATUS.PENDING
          ? `Your request for ${subscription.name} was closed`
          : `Your ${subscription.name} subscription was cancelled`,
      body: [row.endReason && `“${row.endReason}”`, `By ${actor.fullName}`].filter(Boolean).join(" · "),
      link: LINK.mine,
      key: `subscription:${row.id}:cancelled`,
    });
  }

  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_CANCEL,
    entity: memberEntity(row, subscription, user),
    before: { status: before.status, lastDay: before.lastDay },
    after: { status: row.status, reason: row.endReason, by: byOwner ? "subscriber" : "reviewer" },
    message:
      before.status === STATUS.PENDING
        ? `request to subscribe to "${subscription.name}" withdrawn`
        : `subscription to "${subscription.name}" cancelled by ${byOwner ? "the subscriber" : "a reviewer"}`,
  });
  return row.toPublicJSON();
}

/** Change when a running subscription ends — later, or sooner, but not in the past. */
async function extend(id, { days, lastDay }, actor) {
  const period = resolvePeriod({ days, lastDay });
  if (period.error) throw ApiError.badRequest(period.error);

  const { row, before, subscription, user } = await change(id, {
    from: (found) => {
      if (found.status !== STATUS.ACTIVE || !found.isValid()) {
        throw ApiError.conflict("Only a running subscription can have its end changed — an ended one is asked for again");
      }
      if (found.expiresAt.getTime() === period.expiresAt.getTime()) {
        throw ApiError.badRequest("That is already its last day");
      }
    },
    apply: (found, { transaction }) =>
      found.update({ expiresAt: period.expiresAt, remindedAt: null }, { transaction }),
  });

  await inbox.tryAdd(row.userId, {
    type: "subscription.extended",
    category: inbox.CATEGORY.SUBSCRIPTION,
    tone: "info",
    title: `Your ${subscription.name} subscription now runs until ${longDate(period.lastDay)}`,
    body: `It was until ${longDate(before.lastDay)}. Changed by ${actor.fullName}.`,
    link: LINK.mine,
    key: `subscription:${row.id}:until:${period.lastDay}`,
  });
  await audit.record({
    action: AUDIT_ACTIONS.SUBSCRIPTION_EXTEND,
    entity: memberEntity(row, subscription, user),
    before: { lastDay: before.lastDay },
    after: { lastDay: period.lastDay },
    message: `subscription to "${subscription.name}" now ends ${period.lastDay} (was ${before.lastDay})`,
  });
  return row.toPublicJSON();
}

/* ------------------------------------------------------------------ *
 * Looking
 * ------------------------------------------------------------------ */

/**
 * Requests and subscriptions across everyone, for reviewers.
 *
 * `status` filters by what a row *is* now: "active" means running, and
 * "expired" includes one whose time is up that the sweep has not yet marked.
 */
async function members({ status, subscriptionId, search, page = 1, limit = 25 } = {}) {
  const now = new Date();
  const where = {};
  if (subscriptionId) where.subscriptionId = Number(subscriptionId);

  if (status === STATUS.ACTIVE) Object.assign(where, { status, expiresAt: { [Op.gt]: now } });
  else if (status === STATUS.EXPIRED) {
    where[Op.or] = [{ status }, { status: STATUS.ACTIVE, expiresAt: { [Op.lte]: now } }];
  } else if (status) where.status = status;

  const include = WITH_EVERYONE.map((entry) => ({ ...entry }));
  const term = clean(search);
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    include[1] = {
      ...include[1],
      required: true,
      where: { [Op.or]: [{ email: { [Op.like]: like } }, { fullName: { [Op.like]: like } }] },
    };
  }

  const { rows, count } = await UserSubscription.findAndCountAll({
    where,
    include,
    // A queue is worked oldest first; everything else reads newest first.
    order: [["id", status === STATUS.PENDING ? "ASC" : "DESC"]],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });

  return {
    members: rows.map((row) => present(row, now)),
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
  };
}

/** Everything the caller has asked for, newest first. */
async function mine(userId) {
  const now = new Date();
  const rows = await UserSubscription.findAll({
    where: { userId },
    include: [WITH_EVERYONE[0], WITH_EVERYONE[2], WITH_EVERYONE[3]],
    order: [["id", "DESC"]],
    limit: 200,
  });
  return { subscriptions: rows.map((row) => present(row, now)) };
}

async function pendingCount() {
  return { pending: await UserSubscription.count({ where: { status: STATUS.PENDING } }) };
}

/**
 * For POST /subscriptions/check: every subscription there is, and whether this
 * person's is valid right now. No dates — the caller is told yes or no.
 */
async function validityFor(userId, now = new Date()) {
  const [subscriptions, held] = await Promise.all([
    Subscription.findAll({ attributes: ["id", "code"], order: [["code", "ASC"]] }),
    UserSubscription.findAll({
      where: { userId, status: STATUS.ACTIVE, expiresAt: { [Op.gt]: now } },
      attributes: ["subscriptionId"],
    }),
  ]);
  const valid = new Set(held.map((row) => row.subscriptionId));
  return subscriptions.map((s) => ({ code: s.code, valid: valid.has(s.id) }));
}

/* ------------------------------------------------------------------ *
 * The hourly sweep
 * ------------------------------------------------------------------ */

const SWEEP_BATCH = 500;

/**
 * Mark what has run out as expired, and warn whoever's is about to.
 *
 * Nothing depends on this having run — validity is read from the clock — so a
 * missed hour only delays a notification.
 */
async function sweep({ now = new Date() } = {}) {
  const lapsed = await UserSubscription.findAll({
    where: { status: STATUS.ACTIVE, expiresAt: { [Op.lte]: now } },
    include: [WITH_EVERYONE[0]],
    order: [["expiresAt", "ASC"]],
    limit: SWEEP_BATCH,
  });
  let expired = 0;
  for (const row of lapsed) if (await expire(row, row.subscription)) expired++;

  let reminded = 0;
  const days = settings.get("subscription.reminder_days");
  if (days > 0) {
    const soon = await UserSubscription.findAll({
      where: {
        status: STATUS.ACTIVE,
        remindedAt: null,
        expiresAt: { [Op.gt]: now, [Op.lte]: expiryOf(addDays(todayInDhaka(now), days)) },
      },
      include: [WITH_EVERYONE[0]],
      limit: SWEEP_BATCH,
    });
    for (const row of soon) {
      await row.update({ remindedAt: now });
      // One approved for less than the reminder window was never going to be a surprise.
      if (row.expiresAt - row.startsAt <= (days + 1) * 86_400_000) continue;

      const lastDay = lastDayOf(row.expiresAt);
      await inbox.tryAdd(row.userId, {
        type: "subscription.ending",
        category: inbox.CATEGORY.SUBSCRIPTION,
        tone: "warning",
        title: `Your ${row.subscription.name} subscription ends on ${longDate(lastDay)}`,
        body: "It stops then unless someone extends it. Afterwards you can ask to subscribe again.",
        link: LINK.mine,
        key: `subscription:${row.id}:ending:${lastDay}`,
      });
      reminded++;
    }
  }

  if (expired) {
    await audit.record({
      action: AUDIT_ACTIONS.SUBSCRIPTION_EXPIRE,
      actor: { email: "scheduled job" },
      entity: { type: "user_subscription", id: null, label: `${expired} subscription(s)` },
      after: { expired },
      message: `${expired} subscription(s) reached the end of their period`,
    });
  }
  return { expired, reminded };
}

module.exports = {
  create,
  update,
  remove,
  list,
  request,
  approve,
  decline,
  cancel,
  extend,
  members,
  mine,
  pendingCount,
  validityFor,
  sweep,
};
