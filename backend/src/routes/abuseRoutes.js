const express = require("express");
const { body, param, query } = require("express-validator");
const c = require("../controllers/abuseController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { PERMISSIONS } = require("../constants/permissions");
const { REPORT_KIND } = require("../models/TicketReport");
const { HOLD_REASON } = require("../models/AccountHold");

/**
 * Reporting a ticket, and what may follow (§14).
 *
 * Three permissions, deliberately far apart:
 *
 * - `ticket:report` raises a signal and can do nothing else.
 * - `abuse:review` decides whether a signal counts, and sees what the signals
 *   against an account add up to.
 * - `account:hold` is the only one that can stop somebody buying.
 *
 * A checker on a train holds the first. They should not hold the third — the
 * distance between observing something and punishing somebody for it is the
 * whole design, and collapsing it into one permission would quietly undo the
 * review queue the spec asks for.
 */
const canReport = requirePermission(PERMISSIONS.TICKET_REPORT);
const canReview = requirePermission(PERMISSIONS.ABUSE_REVIEW);
const canHold = requirePermission(PERMISSIONS.ACCOUNT_HOLD);

const router = express.Router();
router.use(authenticate);

/* ---------------- Reports ---------------- */

router.post(
  "/reports",
  canReport,
  [
    body("ticketNumber").isString().trim().isLength({ min: 4, max: 32 }),
    body("kind").isIn(Object.values(REPORT_KIND)).withMessage("Which kind of problem?"),
    // Long enough to be reviewable. A report nobody can review is noise in a
    // score, and the score is what decides whether somebody gets locked out.
    body("detail").isString().trim().isLength({ min: 10, max: 1000 })
      .withMessage("Say what happened, in a sentence"),
    body("stationId").optional({ nullable: true }).isInt(),
  ],
  validate,
  c.reportTicket
);

router.get(
  "/reports",
  canReview,
  [
    query("status").optional().isIn(["open", "upheld", "dismissed", "all"]),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1 }),
  ],
  validate,
  c.listReports
);

router.post(
  "/reports/:reference/review",
  canReview,
  [
    param("reference").isString().trim().isLength({ min: 4, max: 40 }),
    body("decision").isIn(["uphold", "dismiss"]).withMessage("Uphold or dismiss?"),
    body("note").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  validate,
  c.reviewReport
);

/* ---------------- Accounts ---------------- */

/**
 * What the signals against one account add up to.
 *
 * Under `abuse:review` rather than `account:hold`, because a reviewer has to be
 * able to see the arithmetic in order to decide — and seeing it is not the same
 * as being able to act on it.
 */
router.get(
  "/accounts/:userId/standing",
  canReview,
  [param("userId").isInt()],
  validate,
  c.accountStanding
);

router.get(
  "/accounts/held",
  canReview,
  [query("page").optional().isInt({ min: 1 })],
  validate,
  c.heldAccounts
);

router.post(
  "/accounts/:userId/hold",
  canHold,
  [
    param("userId").isInt(),
    body("reason").optional().isIn(Object.values(HOLD_REASON)),
    // Said to the person whose account it is, so it has to be a sentence.
    body("detail").isString().trim().isLength({ min: 10, max: 500 })
      .withMessage("Say why, in words the account holder will read"),
  ],
  validate,
  c.holdAccount
);

/**
 * Lifting is always available to whoever may hold.
 *
 * That symmetry is what makes a hold safe to place: the spec's "always
 * reversible by an admin" is not a nicety, it is the reason the feature can
 * exist at all. A note is required for the same reason one is required to place
 * it — an unexplained release is as unaccountable as an unexplained hold.
 */
router.post(
  "/accounts/:userId/release",
  canHold,
  [
    param("userId").isInt(),
    body("note").isString().trim().isLength({ min: 5, max: 500 })
      .withMessage("Say why the hold is being lifted"),
  ],
  validate,
  c.releaseAccount
);

module.exports = router;
