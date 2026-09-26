const asyncHandler = require("../utils/asyncHandler");
const waitlistService = require("../services/waitlistService");
const { PERMISSIONS } = require("../constants/permissions");

/**
 * The queue for a full stretch (§12).
 *
 * Thin, like the rest: every rule about who may queue, what converts and in
 * what order lives in the service, because the queue is served by a background
 * sweep as often as by a request and both must obey the same rules.
 */

const joinQueue = asyncHandler(async (req, res) => {
  const entry = await waitlistService.join({
    userId: req.user.id,
    tripId: req.body.tripId,
    fromStationId: req.body.fromStationId,
    toStationId: req.body.toStationId,
    count: req.body.count,
    coachClassId: req.body.coachClassId,
    passengers: req.body.passengers,
  });
  res.status(201).json({ message: "You are in the queue", entry });
});

const myQueue = asyncHandler(async (req, res) => {
  res.json({ entries: await waitlistService.mine(req.user.id) });
});

const getEntry = asyncHandler(async (req, res) => {
  res.json({
    entry: await waitlistService.get(req.params.reference, {
      userId: req.user.id,
      canViewAll: req.user.permissions?.includes(PERMISSIONS.WAITLIST_VIEW_ALL),
    }),
  });
});

const leaveQueue = asyncHandler(async (req, res) => {
  const result = await waitlistService.withdraw(req.params.reference, { userId: req.user.id });
  res.json({ message: "You have left the queue", ...result });
});

/* ---------------- Answering an offer ---------------- */

const quoteOffer = asyncHandler(async (req, res) => {
  res.json(await waitlistService.quote(req.params.reference, { userId: req.user.id }));
});

const confirmOffer = asyncHandler(async (req, res) => {
  const result = await waitlistService.confirm(req.params.reference, { userId: req.user.id });
  res.status(201).json({ message: "The seat is yours", ...result });
});

const declineOffer = asyncHandler(async (req, res) => {
  const result = await waitlistService.decline(req.params.reference, { userId: req.user.id });
  res.json({ message: "Offer declined and passed on", ...result });
});

/* ---------------- Watching ---------------- */

const tripQueue = asyncHandler(async (req, res) => {
  res.json(await waitlistService.forTrip(req.params.tripId));
});

module.exports = {
  joinQueue,
  myQueue,
  getEntry,
  leaveQueue,
  quoteOffer,
  confirmOffer,
  declineOffer,
  tripQueue,
};
