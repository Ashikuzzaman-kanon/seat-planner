const { Op } = require("sequelize");
const {
  sequelize, Ticket, Booking, Trip, TrainName, Station, TicketScan, User,
} = require("../models");
const { TICKET_STATUS } = require("../models/Ticket");
const { SCAN_VERDICT, REFUSALS } = require("../models/TicketScan");
const { TRIP_STATUS } = require("../models/Trip");
const ApiError = require("../utils/ApiError");
const ticketToken = require("../utils/ticketToken");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const audit = require("./auditService");

/**
 * Checking a ticket on a train (§14).
 *
 * ## What a verdict has to do
 *
 * Tell a person standing in a corridor, in seconds, whether to let someone
 * travel — and if not, why, in words they can say out loud to the passenger.
 * "Invalid" is useless: a passenger whose ticket was refunded, one holding a
 * screenshot of somebody else's, and one who boarded the wrong train all need
 * different sentences. So every refusal carries its own reason and its own
 * message, and the ones that can be explained by the ticket's own history
 * quote that history.
 *
 * ## Two verbs, deliberately
 *
 * `check` looks and changes nothing. `scan` looks and marks the ticket used.
 * They are separate because a checker often wants to look — a passenger asking
 * "am I on the right train" should not burn their ticket — and because marking
 * used is the irreversible half.
 *
 * ## Every attempt is written down
 *
 * Including the refusals, and including codes that name no ticket at all. A
 * ticket presented twice is how a shared screenshot surfaces; a bad signature
 * is somebody trying. Recording only the accepted scans would discard exactly
 * the evidence worth having, so the log is of attempts, not successes.
 *
 * ## Offline
 *
 * The signature alone proves the railway issued a ticket, with no database
 * (see `ticketToken`). What it cannot know is anything mutable — cancelled,
 * refunded, already scanned. So a checker out of signal gets a manifest for
 * their service before departure, judges against that, and syncs the scans
 * afterwards with the times they actually happened.
 */

const TICKET_INCLUDE = [
  {
    model: Booking,
    as: "booking",
    include: [
      { model: Trip, as: "trip", include: [{ model: TrainName, as: "train" }] },
      { model: Station, as: "fromStation" },
      { model: Station, as: "toStation" },
    ],
  },
];

/* ---------------- Reading the code ---------------- */

/**
 * Work out what was presented.
 *
 * A checker may scan a QR, or type a ticket number off a printed page when the
 * QR is too creased to read. Both arrive here; which one it was changes what
 * can be proven, not what is returned.
 */
function readPresented({ token, ticketNumber }) {
  if (token) {
    const url = String(token).trim();
    // The QR may encode a verification URL rather than the bare token.
    const fromUrl = /[?&]t=([^&]+)/.exec(url);
    const raw = fromUrl ? decodeURIComponent(fromUrl[1]) : url;

    const result = ticketToken.verify(raw);
    if (!result.valid) {
      return {
        source: "qr",
        signatureOk: false,
        reason: result.reason,
        message: result.message,
        // A forged signature is a different thing from an unreadable smudge,
        // and the log should not blur them.
        verdict:
          result.reason === "bad_signature" ? SCAN_VERDICT.FORGED : SCAN_VERDICT.UNREADABLE,
        claimedTicketNumber: null,
      };
    }
    return {
      source: "qr",
      signatureOk: true,
      claimed: result.ticket,
      claimedTicketNumber: result.ticket.ticketNumber,
    };
  }

  const typed = String(ticketNumber || "").trim().toUpperCase();
  if (!typed) {
    return {
      source: "typed",
      signatureOk: false,
      reason: "empty",
      message: "Scan a ticket or type its number.",
      verdict: SCAN_VERDICT.UNREADABLE,
      claimedTicketNumber: null,
    };
  }
  return {
    source: "typed",
    // A typed number proves nothing by itself — the database is the authority.
    signatureOk: false,
    typedOnly: true,
    claimedTicketNumber: typed,
  };
}

/* ---------------- Judging it ---------------- */

/**
 * Decide the verdict for a ticket that exists.
 *
 * Order matters: the most specific, most explainable refusal wins. Someone
 * holding a refunded ticket should be told it was refunded, not that it is on
 * the wrong train, even when both are true.
 */
async function judge(ticket, { expectTripId, now = new Date() }) {
  const booking = ticket.booking;
  const trip = booking?.trip;

  if (ticket.status === TICKET_STATUS.USED) {
    const last = await TicketScan.findOne({
      where: { ticketId: ticket.id, verdict: SCAN_VERDICT.ACCEPTED },
      order: [["scannedAt", "DESC"]],
      include: [
        { model: User, as: "checkedBy", attributes: ["id", "fullName"] },
        { model: Station, as: "station", attributes: ["id", "name"] },
      ],
    });

    const where = last?.station?.name ? ` at ${last.station.name}` : "";
    const when = last?.scannedAt ? new Date(last.scannedAt).toISOString().replace("T", " ").slice(0, 16) : null;

    return {
      verdict: SCAN_VERDICT.ALREADY_USED,
      message: when
        ? `This ticket was already scanned${where} on ${when}. A ticket admits one passenger once.`
        : "This ticket has already been scanned. A ticket admits one passenger once.",
      firstScan: last
        ? {
            scannedAt: last.scannedAt,
            station: last.station?.name || null,
            checkedBy: last.checkedBy?.fullName || null,
          }
        : null,
    };
  }

  if (ticket.status === TICKET_STATUS.REFUNDED) {
    return {
      verdict: SCAN_VERDICT.NOT_VALID,
      message: "This ticket was returned and refunded. It is no longer valid for travel.",
    };
  }
  if (ticket.status === TICKET_STATUS.CANCELLED) {
    return {
      verdict: SCAN_VERDICT.NOT_VALID,
      message: "This ticket was cancelled.",
    };
  }
  if (ticket.status === TICKET_STATUS.TRANSFERRED) {
    return {
      verdict: SCAN_VERDICT.NOT_VALID,
      message:
        "This ticket was transferred to another passenger. The replacement ticket is the valid one.",
    };
  }

  if (trip?.status === TRIP_STATUS.CANCELLED) {
    return {
      verdict: SCAN_VERDICT.NOT_VALID,
      message: "This service was cancelled. The fare has been refunded in full.",
    };
  }

  // Right ticket, wrong train. Worth its own verdict because the passenger is
  // usually honest and in the wrong place, and telling them which service they
  // are holding is more use than refusing them flatly.
  if (expectTripId && trip && Number(expectTripId) !== trip.id) {
    return {
      verdict: SCAN_VERDICT.WRONG_SERVICE,
      message:
        `This ticket is for ${trip.train?.name || "another service"}` +
        `${booking?.boardingDate ? ` on ${booking.boardingDate}` : ""}, not this one.`,
    };
  }

  return { verdict: SCAN_VERDICT.ACCEPTED, message: "Valid. Let them travel." };
}

/** Everything the checker should see about a ticket they just read. */
function describe(ticket) {
  const booking = ticket.booking;
  return {
    ticketNumber: ticket.ticketNumber,
    bookingReference: booking?.reference || null,
    status: ticket.status,
    kind: ticket.kind,
    passengerName: ticket.passengerName,
    // Last four only. A checker matches this against the card in a hand; the
    // full number on a checker's screen is a number that can be photographed.
    nidLastFour: String(ticket.passengerNid || "").slice(-4),
    coachCode: ticket.coachCode,
    seatNumber: ticket.seatNumber,
    train: booking?.trip?.train?.name || null,
    tripId: booking?.tripId || null,
    from: booking?.fromStation?.name || null,
    to: booking?.toStation?.name || null,
    travellingOn: booking?.boardingDate || booking?.trip?.departureDate || null,
  };
}

/* ---------------- The two verbs ---------------- */

/**
 * Look at a ticket without changing anything.
 *
 * Every call is still recorded — a checker looking is itself a fact worth
 * having when reconciling a service — but with the `checked` verdict when the
 * ticket is fine, so that "looked at" and "admitted" never get confused.
 */
async function check(input, context) {
  return resolve(input, { ...context, mark: false });
}

/** Look at a ticket and, if it is good, mark it used. */
async function scan(input, context) {
  return resolve(input, { ...context, mark: true });
}

async function resolve(
  { token, ticketNumber, tripId: expectTripId, stationId, clientReference, scannedAt, offline = false, note },
  { checkedById, mark, now = new Date() }
) {
  const presented = readPresented({ token, ticketNumber });
  const when = scannedAt ? new Date(scannedAt) : now;

  /*
   * A scan synced from a device carries the device's own id. Seeing it twice
   * means the upload was retried, not that the ticket was presented twice —
   * returning the original row is the only answer that does not invent a second
   * scan out of a dropped connection.
   */
  if (clientReference) {
    const already = await TicketScan.findOne({ where: { clientReference } });
    if (already) {
      return {
        duplicateOfSync: true,
        verdict: already.verdict,
        refused: already.refused,
        message: "This scan had already been recorded.",
        scan: already.toPublicJSON(),
      };
    }
  }

  // Nothing readable, or a bad signature. There is no ticket to look up, and
  // the attempt is exactly the kind worth keeping.
  if (presented.verdict) {
    const row = await record({
      ticket: null,
      ticketNumber: presented.claimedTicketNumber,
      tripId: expectTripId || null,
      checkedById,
      stationId,
      verdict: presented.verdict,
      scannedAt: when,
      offline,
      clientReference,
      note,
    });
    return {
      verdict: presented.verdict,
      refused: true,
      message: presented.message,
      signatureOk: false,
      scan: row.toPublicJSON(),
    };
  }

  const ticket = await Ticket.findOne({
    where: { ticketNumber: presented.claimedTicketNumber },
    include: TICKET_INCLUDE,
  });

  if (!ticket) {
    const row = await record({
      ticket: null,
      ticketNumber: presented.claimedTicketNumber,
      tripId: expectTripId || null,
      checkedById,
      stationId,
      verdict: SCAN_VERDICT.UNKNOWN,
      scannedAt: when,
      offline,
      clientReference,
      note,
    });
    return {
      verdict: SCAN_VERDICT.UNKNOWN,
      refused: true,
      message: presented.typedOnly
        ? "No ticket with that number. Check the digits and try again."
        : "That code is signed but names no ticket we hold.",
      signatureOk: presented.signatureOk,
      scan: row.toPublicJSON(),
    };
  }

  const judged = await judge(ticket, { expectTripId, now });
  const accepted = judged.verdict === SCAN_VERDICT.ACCEPTED;

  /*
   * Marking used is the irreversible half, so it happens under a lock and
   * re-reads the status inside it. Two checkers scanning the same ticket at the
   * same moment must produce one admission and one "already scanned", never two
   * admissions.
   */
  let verdict = judged.verdict;
  let message = judged.message;
  let firstScan = judged.firstScan || null;

  if (accepted && mark) {
    const outcome = await sequelize.transaction(async (transaction) => {
      const live = await Ticket.findByPk(ticket.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (live.status === TICKET_STATUS.USED) return { raced: true };
      if (live.status !== TICKET_STATUS.VALID) return { changed: live.status };

      await live.update({ status: TICKET_STATUS.USED }, { transaction });
      return { marked: true };
    });

    if (outcome.raced) {
      verdict = SCAN_VERDICT.ALREADY_USED;
      message = "This ticket was scanned a moment ago by another checker.";
    } else if (outcome.changed) {
      verdict = SCAN_VERDICT.NOT_VALID;
      message = "This ticket stopped being valid while it was being scanned.";
    }
  } else if (accepted && !mark) {
    // Looked at, not admitted.
    verdict = SCAN_VERDICT.CHECKED;
  }

  const row = await record({
    ticket,
    ticketNumber: ticket.ticketNumber,
    tripId: ticket.booking?.tripId || null,
    checkedById,
    stationId,
    verdict,
    scannedAt: when,
    offline,
    clientReference,
    note,
  });

  if (verdict === SCAN_VERDICT.ACCEPTED) {
    await audit.record({
      action: AUDIT_ACTIONS.TICKET_SCAN,
      entity: { type: "ticket", id: ticket.id, label: ticket.ticketNumber },
      after: { verdict, stationId: stationId || null, offline },
      message: `${ticket.ticketNumber} admitted${offline ? " (synced from offline)" : ""}`,
    });
  }

  return {
    verdict,
    refused: REFUSALS.includes(verdict),
    message,
    signatureOk: presented.signatureOk,
    typedOnly: Boolean(presented.typedOnly),
    firstScan,
    ticket: describe(ticket),
    scan: row.toPublicJSON(),
  };
}

async function record(fields) {
  return TicketScan.create({
    ticketId: fields.ticket?.id || null,
    ticketNumber: fields.ticketNumber || null,
    tripId: fields.tripId || null,
    checkedById: fields.checkedById,
    stationId: fields.stationId || null,
    verdict: fields.verdict,
    scannedAt: fields.scannedAt,
    syncedAt: new Date(),
    offline: Boolean(fields.offline),
    clientReference: fields.clientReference || null,
    note: fields.note || null,
  });
}

/* ---------------- Offline ---------------- */

/**
 * Everything a checker needs to judge this service without a network.
 *
 * The signature already proves a ticket is genuine, so what this adds is the
 * mutable half the token cannot carry: which tickets have since been refunded,
 * cancelled or already scanned. Downloaded before departure, it turns an
 * offline scanner from "is this real" into "is this real *and* still good".
 *
 * NIDs are truncated here for the same reason they are truncated on the
 * checker's screen: a manifest is a file on a device that leaves the building.
 */
async function manifest(tripId) {
  const trip = await Trip.findByPk(tripId, {
    include: [{ model: TrainName, as: "train" }],
  });
  if (!trip) throw ApiError.notFound("Departure not found");

  const tickets = await Ticket.findAll({
    include: [
      {
        model: Booking,
        as: "booking",
        where: { tripId: Number(tripId) },
        required: true,
        include: [
          { model: Station, as: "fromStation", attributes: ["id", "name"] },
          { model: Station, as: "toStation", attributes: ["id", "name"] },
        ],
      },
    ],
    order: [["coachCode", "ASC"], ["seatNumber", "ASC"]],
  });

  const scanned = await TicketScan.findAll({
    where: { tripId: Number(tripId), verdict: SCAN_VERDICT.ACCEPTED },
    attributes: ["ticketId", "scannedAt"],
    raw: true,
  });
  const scannedAt = new Map(scanned.map((s) => [s.ticketId, s.scannedAt]));

  return {
    tripId: trip.id,
    train: trip.train?.name || null,
    departureDate: trip.departureDate,
    tripStatus: trip.status,
    generatedAt: new Date(),
    // Said plainly, because a checker holding a stale manifest is the failure
    // mode this whole mechanism has.
    advice:
      "Download again before departure. A ticket returned after this was generated will still " +
      "look valid to an offline scanner.",
    count: tickets.length,
    tickets: tickets.map((t) => ({
      ticketNumber: t.ticketNumber,
      status: t.status,
      kind: t.kind,
      passengerName: t.passengerName,
      nidLastFour: String(t.passengerNid || "").slice(-4),
      coachCode: t.coachCode,
      seatNumber: t.seatNumber,
      from: t.booking?.fromStation?.name || null,
      to: t.booking?.toStation?.name || null,
      travellingOn: t.booking?.boardingDate || trip.departureDate,
      alreadyScannedAt: scannedAt.get(t.id) || null,
    })),
  };
}

/**
 * Take a batch of scans a device recorded while it had no signal.
 *
 * Each is judged now, against current state — which is the honest thing to do.
 * A checker who admitted somebody offline on a ticket that had been refunded
 * two hours earlier made a reasonable decision with what they had; the record
 * should say what was true, so the discrepancy is visible rather than hidden.
 *
 * Idempotent through `clientReference`, so a sync retried after a dropped
 * connection changes nothing.
 */
async function sync(scans, { checkedById }) {
  const results = [];
  for (const one of scans) {
    try {
      const result = await resolve(
        {
          token: one.token,
          ticketNumber: one.ticketNumber,
          tripId: one.tripId,
          stationId: one.stationId,
          clientReference: one.clientReference,
          scannedAt: one.scannedAt,
          offline: true,
          note: one.note,
        },
        { checkedById, mark: one.mark !== false }
      );
      results.push({
        clientReference: one.clientReference || null,
        verdict: result.verdict,
        refused: result.refused,
        duplicateOfSync: Boolean(result.duplicateOfSync),
      });
    } catch (err) {
      // One bad row must not throw away the rest of a shift's work.
      results.push({
        clientReference: one.clientReference || null,
        error: err.message,
      });
    }
  }

  /*
   * A duplicate is not an admission.
   *
   * A scan already recorded comes back carrying its original verdict, so
   * counting verdicts alone reported a re-sent batch as a fresh set of
   * admissions — exactly the wrong answer for the case this idempotency exists
   * to handle. Duplicates are counted on their own and excluded from the rest.
   */
  const fresh = results.filter((r) => !r.duplicateOfSync);
  const accepted = fresh.filter((r) => r.verdict === SCAN_VERDICT.ACCEPTED).length;
  const refused = fresh.filter((r) => r.refused).length;
  const duplicates = results.length - fresh.length;

  await audit.record({
    action: AUDIT_ACTIONS.TICKET_SCAN_SYNC,
    entity: { type: "ticket_scan", id: String(results.length) },
    after: { received: results.length, accepted, refused, duplicates },
    message:
      `${results.length} offline scan(s) synced — ${accepted} admitted, ${refused} refused` +
      `${duplicates ? `, ${duplicates} already recorded` : ""}`,
  });

  return { received: results.length, accepted, refused, duplicates, results };
}

/* ---------------- Looking back ---------------- */

/** How a service went: who was admitted, who was refused, and what is unscanned. */
async function forTrip(tripId, { page = 1, limit = 100 } = {}) {
  const trip = await Trip.findByPk(tripId, { include: [{ model: TrainName, as: "train" }] });
  if (!trip) throw ApiError.notFound("Departure not found");

  const { rows, count } = await TicketScan.findAndCountAll({
    where: { tripId: Number(tripId) },
    order: [["scannedAt", "DESC"]],
    limit,
    offset: (page - 1) * limit,
    include: [
      { model: User, as: "checkedBy", attributes: ["id", "fullName"] },
      { model: Station, as: "station", attributes: ["id", "name"] },
    ],
  });

  const sold = await Ticket.count({
    where: { status: { [Op.in]: [TICKET_STATUS.VALID, TICKET_STATUS.USED] } },
    include: [{ model: Booking, as: "booking", where: { tripId: Number(tripId) }, required: true }],
  });
  const used = await Ticket.count({
    where: { status: TICKET_STATUS.USED },
    include: [{ model: Booking, as: "booking", where: { tripId: Number(tripId) }, required: true }],
  });

  return {
    tripId: trip.id,
    train: trip.train?.name || null,
    departureDate: trip.departureDate,
    sold,
    admitted: used,
    // Not "no-shows" until the train has gone; saying so early would be wrong.
    unscanned: sold - used,
    total: count,
    page,
    scans: rows.map((r) => ({
      ...r.toPublicJSON(),
      checkedBy: r.checkedBy?.fullName || null,
      station: r.station?.name || null,
    })),
  };
}

/** One ticket's scan history, for answering a dispute. */
async function historyFor(ticketNumber) {
  const ticket = await Ticket.findOne({
    where: { ticketNumber: String(ticketNumber).toUpperCase() },
    include: TICKET_INCLUDE,
  });
  if (!ticket) throw ApiError.notFound("Ticket not found");

  const scans = await TicketScan.findAll({
    where: { ticketId: ticket.id },
    order: [["scannedAt", "ASC"]],
    include: [
      { model: User, as: "checkedBy", attributes: ["id", "fullName"] },
      { model: Station, as: "station", attributes: ["id", "name"] },
    ],
  });

  return {
    ticket: describe(ticket),
    scans: scans.map((r) => ({
      ...r.toPublicJSON(),
      checkedBy: r.checkedBy?.fullName || null,
      station: r.station?.name || null,
    })),
  };
}

module.exports = {
  check,
  scan,
  manifest,
  sync,
  forTrip,
  historyFor,
  SCAN_VERDICT,
};
