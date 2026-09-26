const express = require("express");
const { body, param } = require("express-validator");
const c = require("../controllers/waitlistController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { PERMISSIONS } = require("../constants/permissions");

/**
 * Queueing for a stretch that is sold out (§12).
 *
 * `waitlist:join` is baseline, like buying: a passenger who can be told "sold
 * out" can ask to be told when it isn't. It grants nothing over anyone else's
 * place — the queue is served in join order by the sweep, and no endpoint here
 * can reorder it. Watching the queue is a separate permission, and read-only
 * for the same reason.
 */
const canQueue = requirePermission(PERMISSIONS.WAITLIST_JOIN);
const canWatch = requirePermission(PERMISSIONS.WAITLIST_VIEW_ALL);

const router = express.Router();
router.use(authenticate);

router.get("/", canQueue, c.myQueue);

router.post(
  "/",
  canQueue,
  [
    body("tripId").isInt().withMessage("Which departure?"),
    body("fromStationId").isInt().withMessage("Where from?"),
    body("toStationId").isInt().withMessage("Where to?"),
    body("count").optional().isInt({ min: 1, max: 10 }).withMessage("How many seats?"),
    body("coachClassId").optional({ nullable: true }).isInt(),
    // Asked for here rather than at confirmation, which is what lets an offer
    // be answered with one click. See the note in waitlistService.
    body("passengers").isArray({ min: 1 }).withMessage("Say who is travelling"),
    body("passengers.*.name").isString().trim().isLength({ min: 2, max: 120 }),
    body("passengers.*.nid").matches(/^\d{10,17}$/).withMessage("NID must be 10 to 17 digits"),
    body("passengers.*.dob").matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage("Date of birth must be YYYY-MM-DD"),
  ],
  validate,
  c.joinQueue
);

// Before /:reference, or "trip" would be read as a reference.
router.get("/trip/:tripId", canWatch, [param("tripId").isInt()], validate, c.tripQueue);

const reference = [param("reference").isString().isLength({ min: 4, max: 40 })];

router.get("/:reference", canQueue, reference, validate, c.getEntry);
router.delete("/:reference", canQueue, reference, validate, c.leaveQueue);

/*
 * Answering an offer.
 *
 * `quote` is a GET because it only prices what is already held; confirming and
 * declining both write. Confirmation takes no body at all — that is the point.
 */
router.get("/:reference/offer/quote", canQueue, reference, validate, c.quoteOffer);
router.post("/:reference/offer/confirm", canQueue, reference, validate, c.confirmOffer);
router.post("/:reference/offer/decline", canQueue, reference, validate, c.declineOffer);

module.exports = router;
