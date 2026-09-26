const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const walletService = require("../services/walletService");
const holdService = require("../services/holdService");
const bookingService = require("../services/bookingService");
const selectionService = require("../services/selectionService");
const money = require("../utils/money");
const { PERMISSIONS } = require("../constants/permissions");
const { DIRECTION } = require("../models/WalletTransaction");

/* ---------------- Wallet ---------------- */

const myWallet = asyncHandler(async (req, res) => {
  res.json({ wallet: await walletService.summary(req.user.id) });
});

const myTransactions = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "25", 10), 1), 100);
  res.json(await walletService.history(req.user.id, { page, limit }));
});

const topUp = asyncHandler(async (req, res) => {
  const amountMinor = money.toMinor(req.body.amount);
  const result = await walletService.topUp({
    userId: req.user.id,
    amountMinor,
    reference: req.body.reference,
    actorLabel: req.user.email,
  });
  res.json({
    message: `Added ${money.format(amountMinor)} — balance is now ${money.format(result.balanceMinor)}`,
    wallet: result.wallet.toPublicJSON(),
    transaction: result.entry.toPublicJSON(),
  });
});

/** Re-sums the ledger and proves the cached balance matches it. */
const verifyWallet = asyncHandler(async (req, res) => {
  res.json(await walletService.verify(req.user.id));
});

const userWallet = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  res.json(await walletService.history(req.params.userId, { page }));
});

const adjustWallet = asyncHandler(async (req, res) => {
  const direction = req.body.direction === DIRECTION.DEBIT ? DIRECTION.DEBIT : DIRECTION.CREDIT;
  const amountMinor = money.toMinor(req.body.amount);

  const result = await walletService.adjust({
    userId: req.params.userId,
    amountMinor,
    direction,
    description: req.body.description,
    actingUser: req.user,
  });

  res.json({
    message: `Wallet ${direction}ed ${money.format(amountMinor)} — balance is now ${money.format(result.balanceMinor)}`,
    wallet: result.wallet.toPublicJSON(),
    transaction: result.entry.toPublicJSON(),
  });
});

/* ---------------- Holds ---------------- */

const createHold = asyncHandler(async (req, res) => {
  const hold = await holdService.create({
    tripId: req.body.tripId,
    userId: req.user.id,
    seatIds: req.body.seatIds,
    fromStationId: req.body.fromStationId,
    toStationId: req.body.toStationId,
  });
  res.status(201).json({
    message: `${hold.seatIds.length} seat(s) held — complete payment within the next few minutes`,
    hold: hold.toPublicJSON(),
  });
});

const getHold = asyncHandler(async (req, res) => {
  res.json({ hold: await holdService.get(req.params.reference, { userId: req.user.id }) });
});

const releaseHold = asyncHandler(async (req, res) => {
  const result = await holdService.release(req.params.reference, { userId: req.user.id });
  res.json({ message: "Seats released", ...result });
});

const myHolds = asyncHandler(async (req, res) => {
  res.json({ holds: await holdService.activeFor(req.user.id) });
});

/* ---------------- Bookings ---------------- */

const quote = asyncHandler(async (req, res) => {
  res.json(
    await bookingService.quote({ holdReference: req.body.holdReference, userId: req.user.id })
  );
});

const createBooking = asyncHandler(async (req, res) => {
  const booking = await bookingService.create({
    userId: req.user.id,
    holdReference: req.body.holdReference,
    passengers: req.body.passengers,
    method: req.body.method,
    gatewayToken: req.body.gatewayToken,
  });
  res.status(201).json({
    message: `Booking ${booking.reference} confirmed — ${booking.ticketCount} ticket(s)`,
    booking,
  });
});

const listBookings = asyncHandler(async (req, res) => {
  const canViewAll = req.permissions.has(PERMISSIONS.BOOKING_VIEW_ALL);
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);

  // Staff may ask for everyone's; a passenger only ever sees their own.
  const all = canViewAll && (req.query.all === "1" || req.query.all === "true");

  res.json(
    await bookingService.list({
      userId: all ? null : req.user.id,
      canViewAll,
      page,
    })
  );
});

const getBooking = asyncHandler(async (req, res) => {
  res.json({
    booking: await bookingService.get(req.params.id, {
      userId: req.user.id,
      canViewAll: req.permissions.has(PERMISSIONS.BOOKING_VIEW_ALL),
    }),
  });
});

/**
 * The tickets as a PDF.
 *
 * Regenerated per request rather than stored: it is derivable from the booking,
 * so keeping a file would only be something to sync, back up and clean up.
 * Sent inline so a phone opens it rather than dropping it in Downloads.
 */
const bookingPdf = asyncHandler(async (req, res) => {
  const { booking, pdf } = await bookingService.pdfFor(req.params.id, {
    userId: req.user.id,
    canViewAll: req.permissions.has(PERMISSIONS.BOOKING_VIEW_ALL),
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="ticket-${booking.reference}.pdf"`);
  res.setHeader("Content-Length", pdf.length);
  res.send(pdf);
});

/** One ticket's QR as a data URI, for showing on screen without a download. */
const ticketQr = asyncHandler(async (req, res) => {
  const { ticket, dataUrl } = await bookingService.ticketQr(
    req.params.id,
    req.params.ticketNumber,
    { userId: req.user.id, canViewAll: req.permissions.has(PERMISSIONS.BOOKING_VIEW_ALL) }
  );

  res.json({ ticketNumber: ticket.ticketNumber, seatNumber: ticket.seatNumber, dataUrl });
});

/* ---------------- Auto-select ---------------- */

/** Parsed leniently: a checkbox sends "true", a JSON client sends true. */
const flag = (value) => value === true || value === "true" || value === 1 || value === "1";

const selectionInput = (req) => ({
  tripId: req.params.id ?? req.body.tripId,
  fromStationId: req.body.fromStationId,
  toStationId: req.body.toStationId,
  count: req.body.count,
  coachClassId: req.body.coachClassId,
  criteria: req.body.criteria || null,
  together: flag(req.body.together),
  strict: flag(req.body.strict),
});

/** What would I get? Reserves nothing. */
const proposeSeats = asyncHandler(async (req, res) => {
  res.json(await selectionService.propose(selectionInput(req)));
});

/** Choose and hold in one step, retrying if a seat goes in between. */
const autoHold = asyncHandler(async (req, res) => {
  const result = await selectionService.selectAndHold({
    ...selectionInput(req),
    userId: req.user.id,
  });

  res.status(201).json({
    message: result.message,
    ...result,
  });
});

const getByReference = asyncHandler(async (req, res) => {
  res.json({
    booking: await bookingService.byReference(req.params.reference, {
      userId: req.user.id,
      canViewAll: req.permissions.has(PERMISSIONS.BOOKING_VIEW_ALL),
    }),
  });
});

module.exports = {
  myWallet,
  myTransactions,
  topUp,
  verifyWallet,
  userWallet,
  adjustWallet,
  createHold,
  getHold,
  releaseHold,
  myHolds,
  quote,
  createBooking,
  listBookings,
  getBooking,
  getByReference,
  bookingPdf,
  ticketQr,
  proposeSeats,
  autoHold,
};
