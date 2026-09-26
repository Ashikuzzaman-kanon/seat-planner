const { TripCoach } = require("../models");
const ApiError = require("../utils/ApiError");
const { autoSelect } = require("../utils/autoSelect");
const availabilityService = require("./availabilityService");
const holdService = require("./holdService");
const settings = require("./settingService");

/**
 * "Find me seats" rather than "give me this seat".
 *
 * Availability is deliberately read *without* the passenger's criteria applied,
 * so the chooser can tell the difference between "the train is full" and "the
 * train has room but nothing with a charging port". Those need different
 * answers, and a filtered query cannot tell them apart.
 *
 * Selecting and holding are one operation here. Between picking a seat and
 * taking it, someone else can buy it — so a conflict is not an error to report
 * but a race to re-run, with the seat that was lost now correctly absent from
 * availability.
 */

const MAX_ATTEMPTS = 3;

/** Coach codes, so a result can say "coach KA" rather than an internal id. */
async function coachCodes(tripId) {
  const coaches = await TripCoach.findAll({
    where: { tripId },
    attributes: ["id", "coachCode"],
    raw: true,
  });
  return new Map(coaches.map((c) => [c.id, c.coachCode]));
}

function withCoachCodes(seats, codes) {
  return seats.map((seat) => ({ ...seat, coachCode: codes.get(seat.tripCoachId) || null }));
}

/**
 * Turns a refusal into the HTTP answer.
 *
 * A full train, an unmeetable preference and an ungroupable party are all 409:
 * the request was well-formed, the inventory simply cannot satisfy it right
 * now. The diagnostics travel with it so the screen can offer the passenger the
 * specific way out — drop a preference, take fewer seats, pick another train.
 */
function refuse(result) {
  const error = ApiError.conflict(result.message);

  error.details = Object.fromEntries(
    Object.entries({
      reason: result.reason,
      requested: result.requested,
      availableCount: result.availableCount,
      matchingCount: result.matchingCount,
      breakdown: result.breakdown,
      unsatisfiable: result.unsatisfiable,
      best: result.best,
    }).filter(([, value]) => value !== undefined)
  );

  return error;
}

function capacityCheck(count) {
  const maximum = settings.get("booking.max_tickets_per_booking");
  const wanted = Math.floor(Number(count) || 0);

  if (wanted < 1) throw ApiError.badRequest("How many seats?");
  if (wanted > maximum) {
    throw ApiError.badRequest(`At most ${maximum} seats can be bought together`);
  }
  return wanted;
}

/**
 * Propose seats without taking them.
 *
 * Useful for "what would I get?" before committing — and for showing a
 * passenger why their preferences cannot be met while they can still change
 * them. Nothing is reserved, so the answer can be stale by the time they act
 * on it; `selectAndHold` is the one that commits.
 */
async function propose({ tripId, fromStationId, toStationId, count, criteria, together, strict, coachClassId }) {
  const wanted = capacityCheck(count);

  const availability = await availabilityService.forJourney({
    tripId,
    fromStationId,
    toStationId,
    coachClassId,
  });

  const result = autoSelect({
    available: availability.available,
    count: wanted,
    criteria,
    together,
    strict,
  });

  if (!result.ok) throw refuse(result);

  const codes = await coachCodes(tripId);

  return {
    tripId: Number(tripId),
    departureDate: availability.departureDate,
    fromStationId: Number(fromStationId),
    toStationId: Number(toStationId),
    seats: withCoachCodes(result.seats, codes),
    seatIds: result.seats.map((s) => s.id),
    togetherness: result.togetherness,
    togetherLabel: result.togetherLabel,
    relaxed: result.relaxed,
    message: result.message,
    freeForJourney: availability.availableCount,
  };
}

/**
 * Choose seats and hold them in one step.
 *
 * Retries on conflict rather than failing: losing a seat to another buyer
 * between choosing and holding is ordinary, and the right response is to choose
 * again from inventory that now reflects the sale.
 */
async function selectAndHold({
  tripId,
  userId,
  fromStationId,
  toStationId,
  count,
  criteria,
  together,
  strict,
  coachClassId,
  /** Overrides the checkout window — the waitlist holds an offer for longer. */
  holdMinutes,
}) {
  const wanted = capacityCheck(count);
  let lastConflict = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const proposal = await propose({
      tripId,
      fromStationId,
      toStationId,
      count: wanted,
      criteria,
      together,
      strict,
      coachClassId,
    });

    try {
      const hold = await holdService.create({
        tripId,
        userId,
        seatIds: proposal.seatIds,
        fromStationId,
        toStationId,
        minutes: holdMinutes,
      });

      return {
        hold: hold.toPublicJSON(),
        seats: proposal.seats,
        togetherness: proposal.togetherness,
        togetherLabel: proposal.togetherLabel,
        relaxed: proposal.relaxed,
        message: proposal.message,
        attempts: attempt,
      };
    } catch (err) {
      // 409 means a seat went in the meantime. Anything else is a real failure.
      if (err.statusCode !== 409) throw err;
      lastConflict = err;
    }
  }

  throw ApiError.conflict(
    "Seats are being taken faster than they can be held right now. Please try again in a moment." +
      (lastConflict ? ` (${lastConflict.message})` : "")
  );
}

module.exports = { propose, selectAndHold };
