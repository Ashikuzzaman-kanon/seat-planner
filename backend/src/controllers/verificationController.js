const asyncHandler = require("../utils/asyncHandler");
const verificationService = require("../services/verificationService");

/**
 * The checker's end of the system (§14).
 *
 * Thin, like the rest. One thing worth noting here rather than in the service:
 * a refused ticket is **not** an HTTP error. "This ticket was already scanned"
 * is a successful answer to a question the checker asked — the request worked,
 * the reader worked, and the answer is no. Returning 4xx would make a scanner
 * app treat a refusal like a network failure, which is exactly the moment it
 * must not.
 */

const checkTicket = asyncHandler(async (req, res) => {
  const result = await verificationService.check(
    {
      token: req.body.token,
      ticketNumber: req.body.ticketNumber,
      tripId: req.body.tripId,
      stationId: req.body.stationId,
      note: req.body.note,
    },
    { checkedById: req.user.id }
  );
  res.json(result);
});

const scanTicket = asyncHandler(async (req, res) => {
  const result = await verificationService.scan(
    {
      token: req.body.token,
      ticketNumber: req.body.ticketNumber,
      tripId: req.body.tripId,
      stationId: req.body.stationId,
      clientReference: req.body.clientReference,
      note: req.body.note,
    },
    { checkedById: req.user.id }
  );
  res.json(result);
});

const syncScans = asyncHandler(async (req, res) => {
  const result = await verificationService.sync(req.body.scans || [], {
    checkedById: req.user.id,
  });
  res.json(result);
});

const tripManifest = asyncHandler(async (req, res) => {
  res.json(await verificationService.manifest(req.params.tripId));
});

const tripScans = asyncHandler(async (req, res) => {
  res.json(
    await verificationService.forTrip(req.params.tripId, {
      page: Number(req.query.page) || 1,
      limit: Math.min(Number(req.query.limit) || 100, 500),
    })
  );
});

const ticketHistory = asyncHandler(async (req, res) => {
  res.json(await verificationService.historyFor(req.params.ticketNumber));
});

module.exports = {
  checkTicket,
  scanTicket,
  syncScans,
  tripManifest,
  tripScans,
  ticketHistory,
};
