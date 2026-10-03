const { Op } = require("sequelize");
const {
  sequelize,
  Booking,
  Ticket,
  Payment,
  SeatHold,
  SeatSegmentBooking,
  TripSeat,
  TripCoach,
  Trip,
  TrainName,
  Station,
  RouteStop,
  User,
} = require("../models");
const { BOOKING_STATUS } = require("../models/Booking");
const { TICKET_STATUS } = require("../models/Ticket");
const { HOLD_STATUS } = require("../models/SeatHold");
const { SEGMENT_SOURCE } = require("../models/SeatSegmentBooking");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const money = require("../utils/money");
const { bookingReference, ticketNumber, unique } = require("../utils/reference");
const { addDays } = require("../utils/dhakaTime");
const fareService = require("./fareService");
const paymentService = require("./paymentService");
const settings = require("./settingService");
const email = require("./emailService");
const inbox = require("./inboxService");
const ticketDocuments = require("./ticketDocumentService");
const audit = require("./auditService");

/**
 * Turning a hold into tickets.
 *
 * This is the transactional centrepiece of the system: seats, tickets and money
 * all move together or none of them do. A failure anywhere — a declined card, a
 * seat taken a moment ago, an overdrawn wallet — rolls the whole thing back,
 * and the passenger is left exactly where they started rather than holding a
 * ticket nobody was paid for.
 */

const NID_PATTERN = /^\d{10,17}$/;

/** Per the spec: any 10–17 digit number is accepted for now. */
function validatePassengers(passengers, seatCount) {
  if (!Array.isArray(passengers) || passengers.length !== seatCount) {
    throw ApiError.badRequest(
      `Give details for exactly ${seatCount} passenger(s) — one per seat held`
    );
  }

  return passengers.map((p, i) => {
    const name = String(p?.name || "").trim();
    const nid = String(p?.nid || "").trim();
    const dob = String(p?.dob || "").trim();

    if (name.length < 2) throw ApiError.badRequest(`Passenger ${i + 1} needs a name`);
    if (!NID_PATTERN.test(nid)) {
      throw ApiError.badRequest(`Passenger ${i + 1}: NID must be 10 to 17 digits`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      throw ApiError.badRequest(`Passenger ${i + 1}: date of birth must look like YYYY-MM-DD`);
    }
    if (new Date(dob) > new Date()) {
      throw ApiError.badRequest(`Passenger ${i + 1} cannot be born in the future`);
    }

    return { name, nid, dob, tripSeatId: p.tripSeatId ? Number(p.tripSeatId) : null };
  });
}

/**
 * When this passenger actually boards and alights.
 *
 * A trip is filed under the day it left its origin. A passenger joining an
 * overnight service at 00:08 travels the day after that, and their ticket has
 * to say so — a date a night early is how someone misses a train they paid for.
 */
async function travelDatesFor(hold) {
  const trip = await Trip.findByPk(hold.tripId);
  if (!trip) return { boardingDate: null, arrivalDate: null };

  const stops = await RouteStop.findAll({
    where: { trainId: trip.trainId, stationId: [hold.fromStationId, hold.toStationId] },
  });

  const offsetOf = (stationId) =>
    stops.find((s) => s.stationId === Number(stationId))?.dayOffset ?? 0;

  return {
    boardingDate: addDays(trip.departureDate, offsetOf(hold.fromStationId)),
    arrivalDate: addDays(trip.departureDate, offsetOf(hold.toStationId)),
  };
}

/**
 * Price a hold before anyone commits to it.
 *
 * Every seat on one hold travels the same stretch, but fares differ by class,
 * so each is priced on its own and the total is an exact integer sum.
 */
async function quote({ holdReference: reference, userId }) {
  const hold = await SeatHold.findOne({ where: { reference } });
  if (!hold) throw ApiError.notFound("That checkout has expired or never existed");
  if (userId && hold.userId !== userId) throw ApiError.forbidden("That checkout belongs to someone else");
  if (!hold.isLive) throw ApiError.badRequest("That checkout has expired — please choose seats again");

  const trip = await Trip.findByPk(hold.tripId, { include: [{ model: TrainName, as: "train" }] });
  const seats = await TripSeat.findAll({
    where: { id: hold.seatIds || [] },
    include: [{ model: TripCoach, as: "coach", attributes: ["coachCode"] }],
  });

  const lines = [];
  for (const seat of seats) {
    const fare = await fareService.resolveFare({
      trainId: trip.trainId,
      coachClassId: seat.coachClassId,
      fromStationId: hold.fromStationId,
      toStationId: hold.toStationId,
    });

    lines.push({
      tripSeatId: seat.id,
      seatNumber: seat.seatNumber,
      coachCode: seat.coach?.coachCode,
      coachClassId: seat.coachClassId,
      fareMinor: money.toMinor(fare.amount),
      fareFormatted: money.format(money.toMinor(fare.amount)),
      basis: fare.basis,
      explanation: fare.explanation,
    });
  }

  const totalMinor = money.sum(lines.map((l) => l.fareMinor));

  return {
    holdReference: reference,
    tripId: hold.tripId,
    train: trip.train ? { id: trip.train.id, name: trip.train.name } : null,
    departureDate: trip.departureDate,
    ...(await travelDatesFor(hold)),
    fromStationId: hold.fromStationId,
    toStationId: hold.toStationId,
    secondsRemaining: hold.secondsRemaining,
    lines,
    totalMinor,
    totalFormatted: money.format(totalMinor),
    payment: await paymentService.methodsFor({ userId: hold.userId, totalMinor }),
  };
}

/**
 * Complete the purchase.
 *
 * The seats are already occupied by the hold, so this **converts** those rows
 * rather than inserting new ones — there is never an instant where the seat is
 * free for someone else to take between the hold ending and the ticket
 * existing.
 */
async function create({ userId, holdReference: reference, passengers, method = "wallet", gatewayToken }) {
  /*
   * The account holder's own details are required before their first purchase.
   *
   * Checked here rather than at sign-up because it is buying a ticket, not
   * having an account, that needs a verified identity behind it — and because
   * every account that existed before the profile did would otherwise be locked
   * out on sight. Asked once; after that the checkout pre-fills from it.
   */
  const buyer = await User.findByPk(userId);
  if (!buyer?.hasTravelProfile) {
    throw ApiError.badRequest(
      "Add your name, National ID and date of birth to your profile before your first booking. " +
        "They are needed once, and the checkout fills itself in from them afterwards."
    );
  }

  const priced = await quote({ holdReference: reference, userId });
  const hold = await SeatHold.findOne({ where: { reference } });

  const details = validatePassengers(passengers, priced.lines.length);

  // Let the caller pair a passenger to a specific seat; otherwise pair in order.
  const bySeat = new Map(priced.lines.map((l) => [l.tripSeatId, l]));
  const assignments = details.map((passenger, i) => {
    const line = passenger.tripSeatId ? bySeat.get(passenger.tripSeatId) : priced.lines[i];
    if (!line) {
      throw ApiError.badRequest(`Passenger ${i + 1} is assigned to a seat that is not on this hold`);
    }
    return { passenger, line };
  });

  const seen = new Set(assignments.map((a) => a.line.tripSeatId));
  if (seen.size !== assignments.length) {
    throw ApiError.badRequest("Two passengers are assigned to the same seat");
  }

  const reference6 = await unique(bookingReference, async (candidate) =>
    Boolean(await Booking.findOne({ where: { reference: candidate } }))
  );

  // Every seat-segment this sale takes, gathered as the tickets are written.
  const sold = [];

  // The calendar days this passenger boards and alights, which for an overnight
  // service joined after midnight are not the day the trip is filed under.
  const travel = await travelDatesFor(hold);

  // Whose demand-based returns this sale pays out, told after it commits.
  let settledResales = null;

  const booking = await sequelize.transaction(async (transaction) => {
    // Re-read the hold inside the transaction: it may have expired in the
    // seconds between pricing and paying.
    const live = await SeatHold.findByPk(hold.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (live.status !== HOLD_STATUS.ACTIVE || live.expiresAt <= new Date()) {
      throw ApiError.badRequest("That checkout expired while you were paying — the seats were released");
    }

    const created = await Booking.create(
      {
        reference: reference6,
        userId,
        tripId: live.tripId,
        fromStationId: live.fromStationId,
        toStationId: live.toStationId,
        boardingDate: travel.boardingDate,
        arrivalDate: travel.arrivalDate,
        status: BOOKING_STATUS.CONFIRMED,
        totalMinor: priced.totalMinor,
        ticketCount: assignments.length,
      },
      { transaction }
    );

    for (const { passenger, line } of assignments) {
      const number = await unique(ticketNumber, async (candidate) =>
        Boolean(await Ticket.findOne({ where: { ticketNumber: candidate }, transaction }))
      );

      const ticket = await Ticket.create(
        {
          bookingId: created.id,
          ticketNumber: number,
          tripSeatId: line.tripSeatId,
          seatNumber: line.seatNumber,
          coachCode: line.coachCode || "",
          coachClassId: line.coachClassId,
          passengerName: passenger.name,
          passengerNid: passenger.nid,
          passengerDob: passenger.dob,
          fareMinor: line.fareMinor,
          status: TICKET_STATUS.VALID,
        },
        { transaction }
      );

      // Hand the held segments to the ticket. Converting rather than
      // re-inserting is what removes the gap a competitor could slip into.
      const [converted] = await SeatSegmentBooking.update(
        { source: SEGMENT_SOURCE.TICKET, ticketId: ticket.id, holdId: null },
        {
          where: { holdId: live.id, tripSeatId: line.tripSeatId, source: SEGMENT_SOURCE.HOLD },
          transaction,
        }
      );

      if (!converted) {
        throw new Error(
          `Seat ${line.seatNumber} had no held segments to convert — the hold and the inventory disagree`
        );
      }

      // Note what this sale took. Someone may have returned this exact space
      // under a demand-based policy and be waiting on it to resell.
      const taken = await SeatSegmentBooking.findAll({
        where: { ticketId: ticket.id, source: SEGMENT_SOURCE.TICKET },
        attributes: ["tripSeatId", "segmentIndex"],
        transaction,
      });
      for (const row of taken) {
        sold.push({
          tripSeatId: row.tripSeatId,
          segmentIndex: row.segmentIndex,
          ticketId: ticket.id,
        });
      }
    }

    // Money last: by here the seats are certainly ours, so a decline rolls back
    // a purchase that would have worked rather than one that was doomed anyway.
    await paymentService.collect(
      {
        userId,
        bookingId: created.id,
        totalMinor: priced.totalMinor,
        method,
        context: { gatewayToken },
      },
      { transaction }
    );

    await live.update({ status: HOLD_STATUS.CONVERTED }, { transaction });

    // Close the loop on demand-based returns: a seat-segment someone gave back
    // has now been bought again, so their refund pays out. Inside this
    // transaction on purpose — the resale and the refund it triggers must
    // commit together, or a seat could be sold twice and refunded once.
    //
    // Required lazily to keep the cycle between this module and the refund
    // service from biting at load time: refunds need bookings to exist, and
    // bookings need refunds to settle.
    settledResales = await require("./refundService").settleResold(sold, { transaction });

    return created;
  });

  await audit.record({
    action: AUDIT_ACTIONS.BOOKING_CREATE,
    entity: { type: "booking", id: booking.id, label: booking.reference },
    after: {
      reference: booking.reference,
      tickets: assignments.length,
      total: money.format(priced.totalMinor),
      method,
    },
    message: `${assignments.length} ticket(s), ${money.format(priced.totalMinor)} by ${method}`,
  });

  /*
   * Now that the sale is committed, tell whoever it just paid.
   *
   * Their demand-based return has moved because *this* passenger bought the
   * seat back. It could not be announced inside the transaction above: a mail
   * describing money that then rolls back is worse than no mail at all.
   */
  if (settledResales?.payouts?.length) {
    require("./refundService")
      .announceSettlements(settledResales.payouts)
      .catch((err) => console.error(`[booking] could not announce settlements: ${err.message}`));
  }

  const full = await get(booking.id, { userId });
  // Not awaited: the sale is complete and the tickets are on screen already.
  // Rendering the PDF and handing it to a mail server is a courtesy, and the
  // passenger should not wait on it — `deliver` logs its own failures.
  deliver(full, userId);
  return full;
}

/**
 * Send the passenger their tickets.
 *
 * Deliberately after the transaction and deliberately non-throwing. The money
 * has moved and the seats are theirs; a mail server being down does not undo
 * any of that, and turning a successful purchase into an error because of it
 * would be the worse failure. The tickets are always re-downloadable from the
 * booking, so a lost email is a nuisance rather than a loss.
 */
/** When the train leaves the passenger's station and reaches theirs, as HH:MM — for the email. */
async function journeyTimes(booking) {
  const trip = await Trip.findByPk(booking.tripId, { attributes: ["trainId"] });
  if (!trip) return {};
  const stops = await RouteStop.findAll({
    where: { trainId: trip.trainId, stationId: [booking.fromStationId, booking.toStationId] },
  });
  const at = (stationId, prefer) => {
    const stop = stops.find((s) => s.stationId === stationId);
    const time = stop && (prefer === "departure" ? stop.departureTime || stop.arrivalTime : stop.arrivalTime || stop.departureTime);
    return time ? String(time).slice(0, 5) : null;
  };
  return { departs: at(booking.fromStationId, "departure"), arrives: at(booking.toStationId, "arrival") };
}

async function deliver(booking, userId) {
  const seats = booking.tickets?.length || 0;
  const place = (station) => station?.name?.replace(/_/g, " ");
  await inbox.tryAdd(userId, {
    type: "booking.confirmed",
    category: inbox.CATEGORY.BOOKING,
    tone: "success",
    title: `Booking confirmed — ${booking.reference}`,
    body: [
      booking.trip?.train?.name,
      [place(booking.fromStation), place(booking.toStation)].filter(Boolean).join(" → "),
      booking.boardingDate,
      `${seats} seat${seats === 1 ? "" : "s"}`,
    ]
      .filter(Boolean)
      .join(" · "),
    link: "/dashboard/bookings",
    key: `booking:${booking.id}:confirmed`,
  });

  try {
    const user = await User.findByPk(userId, { attributes: ["email"] });
    if (!user?.email) return;

    const [pdf, times] = await Promise.all([ticketDocuments.bookingPdf(booking), journeyTimes(booking)]);
    await email.sendBookingConfirmation({ to: user.email, booking, pdf, times });
  } catch (err) {
    console.error(`[booking] could not send tickets for ${booking.reference}: ${err.message}`);
  }
}

/** The booking's tickets as a PDF, regenerated on demand rather than stored. */
async function pdfFor(id, { userId, canViewAll = false } = {}) {
  const booking = await get(id, { userId, canViewAll });
  return { booking, pdf: await ticketDocuments.bookingPdf(booking) };
}

/** One ticket's QR as a data URI, for showing it on screen. */
async function ticketQr(bookingId, ticketNumber, { userId, canViewAll = false } = {}) {
  const booking = await get(bookingId, { userId, canViewAll });
  const ticket = (booking.tickets || []).find((t) => t.ticketNumber === ticketNumber);
  if (!ticket) throw ApiError.notFound("No such ticket on this booking");

  return { ticket, dataUrl: await ticketDocuments.ticketQrDataUrl(ticket, booking) };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const BOOKING_INCLUDE = [
  { model: Ticket, as: "tickets" },
  { model: Payment, as: "payments" },
  { model: Station, as: "fromStation" },
  { model: Station, as: "toStation" },
  { model: Trip, as: "trip", include: [{ model: TrainName, as: "train" }] },
];

async function get(id, { userId, canViewAll = false } = {}) {
  const booking = await Booking.findByPk(id, { include: BOOKING_INCLUDE });
  if (!booking) throw ApiError.notFound("Booking not found");

  if (!canViewAll && userId && booking.userId !== userId) {
    // Not "forbidden": whether a booking exists is itself information.
    throw ApiError.notFound("Booking not found");
  }

  return booking.toPublicJSON();
}

async function byReference(reference, { userId, canViewAll = false } = {}) {
  const booking = await Booking.findOne({
    where: { reference: String(reference).toUpperCase() },
    include: BOOKING_INCLUDE,
  });
  if (!booking) throw ApiError.notFound("Booking not found");
  if (!canViewAll && userId && booking.userId !== userId) {
    throw ApiError.notFound("Booking not found");
  }
  return booking.toPublicJSON();
}

async function list({ userId, canViewAll = false, page = 1, limit = 20 } = {}) {
  const where = canViewAll && !userId ? {} : { userId: Number(userId) };

  const { rows, count } = await Booking.findAndCountAll({
    where,
    include: BOOKING_INCLUDE,
    order: [["id", "DESC"]],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });

  return {
    bookings: rows.map((b) => b.toPublicJSON()),
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
  };
}

module.exports = { quote, create, get, byReference, list, validatePassengers, pdfFor, ticketQr };
