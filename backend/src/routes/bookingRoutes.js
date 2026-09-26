const express = require("express");
const { body, param, query } = require("express-validator");
const c = require("../controllers/bookingController");
const postSale = require("../controllers/postSaleController");
const authenticate = require("../middleware/auth");
const { requirePermission, requireAnyPermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { PERMISSIONS } = require("../constants/permissions");

const canBuy = requirePermission(PERMISSIONS.BOOKING_CREATE);

// Reading a booking is not buying one: a ticket checker or support agent holds
// BOOKING_VIEW_ALL without ever holding BOOKING_CREATE, and must still get in.
const canSee = requireAnyPermission(PERMISSIONS.BOOKING_CREATE, PERMISSIONS.BOOKING_VIEW_ALL);

/* ---------------- Wallet ---------------- */
const wallet = express.Router();
wallet.use(authenticate);

// A passenger's own wallet needs no permission — it is theirs by identity.
wallet.get("/", c.myWallet);
wallet.get("/transactions", c.myTransactions);
wallet.get("/verify", c.verifyWallet);

wallet.post(
  "/topup",
  [body("amount").isFloat({ gt: 0 }).withMessage("Enter an amount to add")],
  validate,
  c.topUp
);

/*
 * Withdrawal is the only way money leaves the system, so it is a request rather
 * than an action: it raises an approval and pays out nothing until a person
 * with WALLET_WITHDRAWAL authority agrees. See postSaleService.
 */
wallet.post(
  "/withdraw",
  [
    body("amount").isFloat({ gt: 0 }).withMessage("Enter an amount to withdraw"),
    body("destination").isString().trim().isLength({ min: 4, max: 120 })
      .withMessage("Say where the money should go"),
    body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  validate,
  postSale.requestWithdrawal
);

wallet.get(
  "/user/:userId",
  requirePermission(PERMISSIONS.WALLET_VIEW_ALL),
  [param("userId").isInt()],
  validate,
  c.userWallet
);

wallet.post(
  "/user/:userId/adjust",
  requirePermission(PERMISSIONS.WALLET_ADJUST),
  [
    param("userId").isInt(),
    body("amount").isFloat({ gt: 0 }).withMessage("Enter an amount"),
    body("direction").isIn(["credit", "debit"]),
    body("description").isString().trim().isLength({ min: 3, max: 300 })
      .withMessage("Say why — an adjustment without a reason is unauditable"),
  ],
  validate,
  c.adjustWallet
);

/* ---------------- Holds ---------------- */
const holds = express.Router();
holds.use(authenticate);

// Shared by the two selection endpoints below: the same question, asked once
// without commitment and once with.
const selectionRules = [
  body("tripId").isInt().withMessage("Which departure?"),
  body("fromStationId").isInt().withMessage("Where from?"),
  body("toStationId").isInt().withMessage("Where to?"),
  body("count").isInt({ min: 1, max: 10 }).withMessage("How many seats?"),
  body("coachClassId").optional({ nullable: true }).isInt(),
  body("criteria").optional({ nullable: true }).isObject()
    .withMessage("Preferences must be an object of seat attributes"),
  body("together").optional().isBoolean(),
  body("strict").optional().isBoolean(),
];

holds.get("/", canBuy, c.myHolds);

/*
 * Two ways to let the system choose.
 *
 * `preview` answers "which seats would I get, and if none, why not" without
 * reserving anything, so a passenger can see that nothing has a charging port
 * while they can still change their mind. `auto` commits: it chooses and holds
 * in one step, re-choosing internally if a seat goes in between.
 *
 * POST rather than GET on both because the criteria are a document, and because
 * `auto` writes.
 */
holds.post("/preview", canBuy, selectionRules, validate, c.proposeSeats);
holds.post("/auto", canBuy, selectionRules, validate, c.autoHold);

holds.post(
  "/",
  canBuy,
  [
    body("tripId").isInt().withMessage("Which departure?"),
    body("seatIds").isArray({ min: 1 }).withMessage("Choose at least one seat"),
    body("seatIds.*").isInt(),
    body("fromStationId").isInt().withMessage("Where from?"),
    body("toStationId").isInt().withMessage("Where to?"),
  ],
  validate,
  c.createHold
);

holds.get("/:reference", canBuy, [param("reference").isString()], validate, c.getHold);
holds.delete("/:reference", canBuy, [param("reference").isString()], validate, c.releaseHold);

/* ---------------- Bookings ---------------- */
const bookings = express.Router();
bookings.use(authenticate);

bookings.get("/", canSee, [query("page").optional().isInt({ min: 1 })], validate, c.listBookings);

// Before /:id, or "reference" would be read as an id.
bookings.get(
  "/reference/:reference",
  canSee,
  [param("reference").isString().isLength({ min: 4, max: 12 })],
  validate,
  c.getByReference
);

bookings.post(
  "/quote",
  canBuy,
  [body("holdReference").isString().withMessage("Which checkout?")],
  validate,
  c.quote
);

bookings.post(
  "/",
  canBuy,
  [
    body("holdReference").isString().withMessage("Which checkout?"),
    body("passengers").isArray({ min: 1 }).withMessage("Passenger details are required"),
    body("passengers.*.name").isString().trim().isLength({ min: 2, max: 120 }),
    body("passengers.*.nid").matches(/^\d{10,17}$/).withMessage("NID must be 10 to 17 digits"),
    body("passengers.*.dob").matches(/^\d{4}-\d{2}-\d{2}$/).withMessage("Date of birth must be YYYY-MM-DD"),
    body("method").optional().isIn(["wallet", "gateway", "split"]),
  ],
  validate,
  c.createBooking
);

bookings.get("/:id", canSee, [param("id").isInt()], validate, c.getBooking);

// The tickets themselves. Regenerated per request, never stored.
bookings.get("/:id/pdf", canSee, [param("id").isInt()], validate, c.bookingPdf);

bookings.get(
  "/:id/tickets/:ticketNumber/qr",
  canSee,
  [param("id").isInt(), param("ticketNumber").isString().isLength({ min: 4, max: 32 })],
  validate,
  c.ticketQr
);

module.exports = { wallet, holds, bookings };
