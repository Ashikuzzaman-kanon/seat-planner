const express = require("express");
const { body, param, query } = require("express-validator");
const c = require("../controllers/verificationController");
const authenticate = require("../middleware/auth");
const { requirePermission, requireAnyPermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { PERMISSIONS } = require("../constants/permissions");

/**
 * Checking tickets on a train (§14).
 *
 * `ticket:verify` reads; `ticket:scan` admits. Split because marking a ticket
 * used is the half that cannot be undone, and plenty of staff need to answer
 * "is this valid" without being able to burn somebody's ticket by pointing a
 * phone at it. Anyone who can scan can also check, which is why the read
 * endpoints accept either.
 */
const canCheck = requireAnyPermission(PERMISSIONS.TICKET_VERIFY, PERMISSIONS.TICKET_SCAN);
const canScan = requirePermission(PERMISSIONS.TICKET_SCAN);

const router = express.Router();
router.use(authenticate);

/*
 * A ticket arrives either as a scanned code or as a number typed off a printed
 * page when the QR is too creased to read. One of the two is required; which
 * one changes what can be proven, not what the endpoint accepts.
 */
const presented = [
  body("token").optional({ nullable: true }).isString().isLength({ max: 4096 }),
  body("ticketNumber").optional({ nullable: true }).isString().trim().isLength({ max: 32 }),
  body("tripId").optional({ nullable: true }).isInt(),
  body("stationId").optional({ nullable: true }).isInt(),
  body("note").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body().custom((value) => {
    if (!value.token && !value.ticketNumber) {
      throw new Error("Scan a ticket or give its number");
    }
    return true;
  }),
];

/** Look, and change nothing. */
router.post("/check", canCheck, presented, validate, c.checkTicket);

/** Look, and mark it used. */
router.post(
  "/scan",
  canScan,
  [
    ...presented,
    // The device's own id for this scan, so a retried upload records nothing
    // twice. Optional online, where there is nothing to retry.
    body("clientReference").optional({ nullable: true }).isString().trim().isLength({ max: 64 }),
  ],
  validate,
  c.scanTicket
);

/**
 * Scans a device recorded while it had no signal.
 *
 * Capped per request so one shift's backlog arrives in pages rather than as a
 * single enormous body — a scanner reconnecting on a platform has poor signal
 * by definition, and a request that must succeed whole is a request that fails.
 */
router.post(
  "/scans/sync",
  canScan,
  [
    body("scans").isArray({ min: 1, max: 500 }).withMessage("Send between 1 and 500 scans"),
    body("scans.*.scannedAt").isISO8601().withMessage("Each scan needs the time it happened"),
    body("scans.*.clientReference").isString().trim().isLength({ min: 1, max: 64 })
      .withMessage("Each scan needs the device's own reference, so retries cannot double-record"),
    body("scans.*.token").optional({ nullable: true }).isString().isLength({ max: 4096 }),
    body("scans.*.ticketNumber").optional({ nullable: true }).isString().trim().isLength({ max: 32 }),
    body("scans.*.tripId").optional({ nullable: true }).isInt(),
    body("scans.*.stationId").optional({ nullable: true }).isInt(),
    body("scans.*.mark").optional().isBoolean(),
    body("scans.*.note").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  ],
  validate,
  c.syncScans
);

/**
 * Everything needed to check this service with no network.
 *
 * Reading, so `ticket:verify` is enough — a checker who may only look still
 * needs the manifest to look at.
 */
router.get(
  "/trips/:tripId/manifest",
  canCheck,
  [param("tripId").isInt()],
  validate,
  c.tripManifest
);

/** How a service went: admitted, refused, and still unscanned. */
router.get(
  "/trips/:tripId/scans",
  canCheck,
  [param("tripId").isInt(), query("page").optional().isInt({ min: 1 }), query("limit").optional().isInt({ min: 1 })],
  validate,
  c.tripScans
);

/** One ticket's scan history, for settling a dispute. */
router.get(
  "/tickets/:ticketNumber/scans",
  canCheck,
  [param("ticketNumber").isString().trim().isLength({ min: 4, max: 32 })],
  validate,
  c.ticketHistory
);

module.exports = router;
