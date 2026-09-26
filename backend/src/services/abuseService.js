const { Op } = require("sequelize");
const {
  sequelize, TicketReport, AccountHold, Ticket, Booking, Refund, TicketScan, User, Trip,
} = require("../models");
const { REPORT_KIND, REPORT_STATUS } = require("../models/TicketReport");
const { HOLD_REASON } = require("../models/AccountHold");
const { SCAN_VERDICT } = require("../models/TicketScan");
const { TICKET_STATUS, TICKET_KIND } = require("../models/Ticket");
const money = require("../utils/money");
const ApiError = require("../utils/ApiError");
const { reportReference, unique } = require("../utils/reference");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const audit = require("./auditService");
const settings = require("./settingService");
const notify = require("./notificationService");

/**
 * Noticing a pattern, and being careful about what follows (§14).
 *
 * ## The shape the spec asks for, and why
 *
 * > Scored signals → human review queue → automatic hold only at a high
 * > threshold. Always reversible by an admin. Every action audited.
 *
 * Three separate ideas, and the distance between them is the point. A signal
 * is an observation. A score is arithmetic over observations. A hold is a
 * punishment. Collapsing any two of those produces a system that locks people
 * out for being unusual, which is worse than one that occasionally misses
 * somebody reselling tickets.
 *
 * ## What counts, and what deliberately does not
 *
 * - **Upheld reports** count. Open ones do not: a checker can be mistaken, and
 *   an unreviewed accusation is not evidence of anything. Dismissed ones are
 *   withdrawn entirely rather than merely discounted.
 * - **Duplicate scans** count, weakly. A ticket presented twice is how a shared
 *   screenshot surfaces — but it is also what happens when a checker walks the
 *   train twice, so one is worth very little and several are worth noticing.
 * - **Buy-and-refund churn** counts only past a volume threshold, and only as a
 *   *ratio*. Returning tickets is a service the railway sells; somebody who
 *   buys forty and returns four is a good customer, and somebody who buys four
 *   and returns four may simply have had a bad month. The signal is buying in
 *   quantity and returning nearly all of it, repeatedly.
 * - **Being refused at a gate does not count at all.** A passenger whose ticket
 *   was refunded and who turns up anyway is confused, not fraudulent, and
 *   scoring confusion produces a system that punishes the least sophisticated
 *   passengers hardest.
 *
 * Every weight and threshold is a setting, because none of these numbers can be
 * right in the abstract — they have to be tuned against what an actual railway
 * sees, by someone watching the queue.
 */

/* ---------------- Reporting ---------------- */

/**
 * A checker says something is wrong.
 *
 * Deliberately easy to do and deliberately powerless on its own: it creates a
 * row and nothing else. The account is copied onto the report at this moment so
 * the signal stays attached to the buyer even if the ticket is transferred
 * afterwards.
 */
async function report({ ticketNumber, kind, detail, stationId, reportedById }) {
  const ticket = await Ticket.findOne({
    where: { ticketNumber: String(ticketNumber || "").toUpperCase() },
    include: [{ model: Booking, as: "booking" }],
  });
  if (!ticket) throw ApiError.notFound("No ticket with that number");

  if (!Object.values(REPORT_KIND).includes(kind)) {
    throw ApiError.badRequest("That is not a kind of report");
  }

  const words = String(detail || "").trim();
  if (words.length < 10) {
    throw ApiError.badRequest(
      "Say what happened, in a sentence. A report nobody can review is not a report."
    );
  }

  const reference = await unique(reportReference, async (candidate) =>
    Boolean(await TicketReport.findOne({ where: { reference: candidate } }))
  );

  const created = await TicketReport.create({
    reference,
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    tripId: ticket.booking?.tripId || null,
    reportedUserId: ticket.booking?.userId || null,
    reportedById,
    stationId: stationId || null,
    kind,
    detail: words,
  });

  await audit.record({
    action: AUDIT_ACTIONS.TICKET_REPORT,
    entity: { type: "ticket_report", id: created.id, label: reference },
    after: { ticket: ticket.ticketNumber, kind },
    message: `${ticket.ticketNumber} reported — ${kind.replace(/_/g, " ")}`,
  });

  return created.toPublicJSON();
}

/**
 * A reviewer decides.
 *
 * Upholding is what turns an accusation into a signal. Dismissing withdraws it
 * completely — not "counts less", because a report a human has looked at and
 * rejected is not weak evidence, it is no evidence.
 *
 * Only after upholding does the score get recomputed, and only then can a hold
 * follow.
 */
async function review({ reference, uphold, note, reviewedById }) {
  const row = await TicketReport.findOne({ where: { reference } });
  if (!row) throw ApiError.notFound("No such report");
  if (!row.isOpen) {
    throw ApiError.conflict(`That report was already ${row.status}.`);
  }

  await row.update({
    status: uphold ? REPORT_STATUS.UPHELD : REPORT_STATUS.DISMISSED,
    reviewedById,
    reviewedAt: new Date(),
    reviewNote: note || null,
  });

  await audit.record({
    action: uphold ? AUDIT_ACTIONS.REPORT_UPHELD : AUDIT_ACTIONS.REPORT_DISMISSED,
    entity: { type: "ticket_report", id: row.id, label: row.reference },
    after: { status: row.status, note: note || null },
    message: `report ${row.reference} ${row.status}${note ? ` — ${note}` : ""}`,
  });

  let outcome = null;
  if (uphold && row.reportedUserId) {
    // Upholding is the only thing that can move a score, so it is the only
    // thing that reconsiders a hold.
    outcome = await reconsider(row.reportedUserId, { trigger: `report ${row.reference}` });
  }

  return { report: row.toPublicJSON(), account: outcome };
}

/** The queue of reports waiting on a person. */
async function queue({ status = REPORT_STATUS.OPEN, page = 1, limit = 25 } = {}) {
  const where = status === "all" ? {} : { status };

  const { rows, count } = await TicketReport.findAndCountAll({
    where,
    order: [["id", "ASC"]],
    limit,
    offset: (page - 1) * limit,
    include: [
      { model: User, as: "reportedUser", attributes: ["id", "fullName", "email"] },
      { model: User, as: "reportedBy", attributes: ["id", "fullName"] },
      { model: User, as: "reviewedBy", attributes: ["id", "fullName"] },
    ],
  });

  return {
    total: count,
    page,
    reports: rows.map((r) => ({
      ...r.toPublicJSON(),
      reportedUser: r.reportedUser
        ? { id: r.reportedUser.id, name: r.reportedUser.fullName, email: r.reportedUser.email }
        : null,
      reportedBy: r.reportedBy?.fullName || null,
      reviewedBy: r.reviewedBy?.fullName || null,
    })),
  };
}

/* ---------------- Scoring ---------------- */

/**
 * What the signals against one account add up to.
 *
 * Returns the parts as well as the total, always. A score presented as a bare
 * number is unarguable, and this one has to be argued with — by the reviewer
 * deciding, and by the passenger disputing. Showing the arithmetic is what
 * makes it answerable.
 */
async function scoreFor(userId) {
  const windowDays = settings.get("abuse.window_days");
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const [upheldReports, duplicateScans, bookings, refunds] = await Promise.all([
    TicketReport.findAll({
      where: {
        reportedUserId: userId,
        status: REPORT_STATUS.UPHELD,
        createdAt: { [Op.gte]: since },
      },
      attributes: ["kind"],
      raw: true,
    }),
    // Tickets bought by this account that were presented after being used.
    TicketScan.count({
      where: { verdict: SCAN_VERDICT.ALREADY_USED, scannedAt: { [Op.gte]: since } },
      include: [
        {
          model: Ticket,
          as: "ticket",
          required: true,
          include: [
            { model: Booking, as: "booking", where: { userId }, required: true },
          ],
        },
      ],
    }),
    Ticket.count({
      include: [
        {
          model: Booking,
          as: "booking",
          where: { userId, createdAt: { [Op.gte]: since } },
          required: true,
        },
      ],
    }),
    Refund.count({ where: { userId, createdAt: { [Op.gte]: since } } }),
  ]);

  const weights = {
    report: settings.get("abuse.weight_upheld_report"),
    forgery: settings.get("abuse.weight_upheld_forgery"),
    duplicate: settings.get("abuse.weight_duplicate_scan"),
    churn: settings.get("abuse.weight_churn"),
  };

  // A forged ticket is a different act from a name that did not match, and the
  // score should not pretend otherwise.
  const forgeries = upheldReports.filter((r) => r.kind === REPORT_KIND.FORGERY).length;
  const others = upheldReports.length - forgeries;

  const reportPoints = others * weights.report + forgeries * weights.forgery;
  const duplicatePoints = duplicateScans * weights.duplicate;

  /*
   * Churn: buying in quantity and returning nearly all of it.
   *
   * Only past a volume floor, because four of four proves nothing, and only as
   * a ratio, because returning tickets is a service the railway sells. Somebody
   * who buys forty and returns four is a good customer.
   */
  const floor = settings.get("abuse.churn_minimum_tickets");
  const ratioTrigger = settings.get("abuse.churn_ratio_percent") / 100;
  const ratio = bookings > 0 ? refunds / bookings : 0;
  const churning = bookings >= floor && ratio >= ratioTrigger;
  const churnPoints = churning ? Math.round(weights.churn * ratio) : 0;

  const total = reportPoints + duplicatePoints + churnPoints;

  return {
    userId: Number(userId),
    windowDays,
    total,
    threshold: settings.get("abuse.hold_threshold"),
    // The arithmetic, laid out, so it can be argued with.
    parts: [
      {
        signal: "Upheld reports",
        count: others,
        weight: weights.report,
        points: others * weights.report,
        note: "Only reports a reviewer agreed with. An open report counts nothing.",
      },
      {
        signal: "Upheld forgery reports",
        count: forgeries,
        weight: weights.forgery,
        points: forgeries * weights.forgery,
        note: "Presenting a code the railway did not issue is a different act.",
      },
      {
        signal: "Tickets presented after use",
        count: duplicateScans,
        weight: weights.duplicate,
        points: duplicatePoints,
        note: "Weak on its own — a checker walking the train twice looks the same.",
      },
      {
        signal: "Buy-and-return churn",
        count: `${refunds} of ${bookings}`,
        weight: weights.churn,
        points: churnPoints,
        note: churning
          ? `${Math.round(ratio * 100)}% returned, over the ${floor}-ticket floor.`
          : `Not counted: ${bookings} ticket(s) is under the ${floor}-ticket floor, or the ratio is normal.`,
      },
    ],
  };
}

/* ---------------- Holds ---------------- */

/** The open hold on an account, if there is one. */
async function activeHold(userId) {
  return AccountHold.findOne({
    where: { userId: Number(userId), releasedAt: null },
    order: [["id", "DESC"]],
  });
}

/** Whether this account may buy. Used where money is about to move. */
async function isHeld(userId) {
  return Boolean(await activeHold(userId));
}

/**
 * Put a hold on an account.
 *
 * `automatic` is recorded rather than inferred, because the two paths deserve
 * different scrutiny: a person decided, or a number crossed a line.
 */
async function hold({ userId, reason, detail, placedById = null, automatic = false, score = null }) {
  const existing = await activeHold(userId);
  if (existing) return { hold: existing.toPublicJSON(), alreadyHeld: true };

  const created = await AccountHold.create({
    userId: Number(userId),
    reason,
    detail,
    automatic,
    scoreAtHold: score,
    placedById,
  });

  await audit.record({
    action: AUDIT_ACTIONS.ACCOUNT_HOLD,
    entity: { type: "user", id: userId },
    after: { reason, automatic, score },
    message: `account held${automatic ? " automatically" : ""} — ${detail}`,
  });

  notify.accountHeld({ userId, detail, automatic }).catch(() => {});

  return { hold: created.toPublicJSON(), alreadyHeld: false };
}

/**
 * Lift it.
 *
 * Always available to an administrator, which is the property that makes a hold
 * safe to place at all — and a note is required, because a release with no
 * reason is as unaccountable as a hold with none.
 */
async function release({ userId, releasedById, note }) {
  const open = await activeHold(userId);
  if (!open) throw ApiError.badRequest("That account is not on hold");

  const words = String(note || "").trim();
  if (words.length < 5) {
    throw ApiError.badRequest("Say why the hold is being lifted");
  }

  await open.update({
    releasedById,
    releasedAt: new Date(),
    releaseNote: words,
  });

  await audit.record({
    action: AUDIT_ACTIONS.ACCOUNT_RELEASE,
    entity: { type: "user", id: userId },
    after: { note: words },
    message: `account hold lifted — ${words}`,
  });

  notify.accountReleased({ userId, note: words }).catch(() => {});

  return open.toPublicJSON();
}

/**
 * Look again at an account whose score may have moved.
 *
 * The only place a hold is ever placed automatically, and it is narrow on
 * purpose: past the threshold, not already held, and the feature switched on.
 * Everything else goes to a person.
 */
async function reconsider(userId, { trigger } = {}) {
  const score = await scoreFor(userId);

  if (!settings.get("abuse.auto_hold_enabled")) {
    return { score, held: false, why: "automatic holds are switched off" };
  }
  if (score.total < score.threshold) {
    return { score, held: false, why: "below the threshold" };
  }
  if (await isHeld(userId)) {
    return { score, held: false, why: "already held" };
  }

  const placed = await hold({
    userId,
    reason: HOLD_REASON.ABUSE_SCORE,
    detail:
      `Automatic hold: signals against this account reached ${score.total}, ` +
      `over the threshold of ${score.threshold}. An administrator can lift this.`,
    automatic: true,
    score: score.total,
  });

  await audit.record({
    action: AUDIT_ACTIONS.ACCOUNT_HOLD,
    entity: { type: "user", id: userId },
    after: { score: score.total, threshold: score.threshold, trigger: trigger || null },
    message: `score ${score.total} crossed ${score.threshold}${trigger ? ` after ${trigger}` : ""}`,
  });

  return { score, held: true, hold: placed.hold };
}

/**
 * What this account has actually done — bought, travelled, returned.
 *
 * ## Why this sits next to the score without being part of it
 *
 * A reviewer looking at two upheld reports needs to know whether they belong to
 * somebody who has taken four journeys or four hundred. Two reports against a
 * daily commuter of three years is noise; two against an account that has
 * bought six tickets and returned five is a different picture entirely. The
 * score cannot express that, and should not try — weighting misconduct by
 * loyalty is how you end up policing infrequent travellers hardest.
 *
 * So this is context, shown beside the arithmetic and deliberately not folded
 * into it.
 *
 * ## On "never scanned"
 *
 * Counted only for departures that have already gone. A valid ticket on
 * tomorrow's train is not a no-show, and calling it one would make every
 * account holding a future booking look like it was wasting seats.
 */
async function travelFor(userId, { windowDays } = {}) {
  const days = windowDays || settings.get("abuse.window_days");
  const since = new Date(Date.now() - days * 86_400_000);
  const today = new Date().toISOString().slice(0, 10);

  const tickets = await Ticket.findAll({
    include: [
      {
        model: Booking,
        as: "booking",
        where: { userId: Number(userId), createdAt: { [Op.gte]: since } },
        required: true,
        include: [{ model: Trip, as: "trip", attributes: ["id", "departureDate", "status"] }],
      },
    ],
    attributes: ["id", "status", "kind", "fareMinor"],
  });

  const spentMinor = tickets.reduce((sum, t) => sum + Number(t.fareMinor || 0), 0);

  const counted = {
    bought: tickets.length,
    travelled: 0,
    returned: 0,
    unscanned: 0,
    upcoming: 0,
    standing: 0,
  };

  for (const ticket of tickets) {
    if (ticket.kind === TICKET_KIND.STANDING) counted.standing += 1;

    if (ticket.status === TICKET_STATUS.USED) {
      counted.travelled += 1;
      continue;
    }
    if (ticket.status === TICKET_STATUS.REFUNDED) {
      counted.returned += 1;
      continue;
    }
    if (ticket.status !== TICKET_STATUS.VALID) continue;

    const departureDate = ticket.booking?.trip?.departureDate;
    // A valid ticket on a train that has not left is a booking, not a no-show.
    if (departureDate && departureDate < today) counted.unscanned += 1;
    else counted.upcoming += 1;
  }

  const refunded = await Refund.findAll({
    where: { userId: Number(userId), createdAt: { [Op.gte]: since } },
    attributes: ["refundedMinor"],
    raw: true,
  });
  const refundedMinor = refunded.reduce((sum, r) => sum + Number(r.refundedMinor || 0), 0);

  return {
    windowDays: days,
    ...counted,
    returnRate: counted.bought > 0 ? Math.round((counted.returned / counted.bought) * 100) : 0,
    spentMinor,
    spentFormatted: money.format(spentMinor),
    refundedMinor,
    refundedFormatted: money.format(refundedMinor),
    netMinor: spentMinor - refundedMinor,
    netFormatted: money.format(spentMinor - refundedMinor),
  };
}

/** Everything known about one account's standing, for a reviewer. */
async function standingFor(userId) {
  const [score, travel, open, history] = await Promise.all([
    scoreFor(userId),
    travelFor(userId),
    activeHold(userId),
    AccountHold.findAll({
      where: { userId: Number(userId) },
      order: [["id", "DESC"]],
      limit: 20,
      include: [
        { model: User, as: "placedBy", attributes: ["id", "fullName"] },
        { model: User, as: "releasedBy", attributes: ["id", "fullName"] },
      ],
    }),
  ]);

  const reports = await TicketReport.findAll({
    where: { reportedUserId: Number(userId) },
    order: [["id", "DESC"]],
    limit: 25,
  });

  return {
    score,
    // Context beside the arithmetic, never folded into it — see travelFor.
    travel,
    held: Boolean(open),
    hold: open ? open.toPublicJSON() : null,
    holds: history.map((h) => ({
      ...h.toPublicJSON(),
      placedBy: h.placedBy?.fullName || (h.automatic ? "the system" : null),
      releasedBy: h.releasedBy?.fullName || null,
    })),
    reports: reports.map((r) => r.toPublicJSON()),
  };
}

/** Every account currently held, for someone working through them. */
async function heldAccounts({ page = 1, limit = 25 } = {}) {
  const { rows, count } = await AccountHold.findAndCountAll({
    where: { releasedAt: null },
    order: [["id", "DESC"]],
    limit,
    offset: (page - 1) * limit,
    include: [
      { model: User, as: "user", attributes: ["id", "fullName", "email"] },
      { model: User, as: "placedBy", attributes: ["id", "fullName"] },
    ],
  });

  return {
    total: count,
    page,
    holds: rows.map((h) => ({
      ...h.toPublicJSON(),
      user: h.user ? { id: h.user.id, name: h.user.fullName, email: h.user.email } : null,
      placedBy: h.placedBy?.fullName || (h.automatic ? "the system" : null),
    })),
  };
}

module.exports = {
  report,
  travelFor,
  review,
  queue,
  scoreFor,
  standingFor,
  isHeld,
  activeHold,
  hold,
  release,
  reconsider,
  heldAccounts,
  REPORT_KIND,
  REPORT_STATUS,
  HOLD_REASON,
};
