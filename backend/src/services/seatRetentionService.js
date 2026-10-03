const { Op, QueryTypes } = require("sequelize");
const { sequelize, Trip, TrainName } = require("../models");
const { todayInDhaka, addDays } = require("../utils/dhakaTime");
const settings = require("./settingService");
const audit = require("./auditService");
const { AUDIT_ACTIONS } = require("../constants/auditActions");

/**
 * Clearing the unsold seats of trains that left long ago.
 *
 * Every seat of every departure is a row, built when the departure is
 * generated so that selling it is a lookup. Once the train has left, the seats
 * nobody bought answer no question anyone will ask again — and on a small
 * database they are most of what it holds.
 *
 * ## What goes
 *
 * On a departure more than `trip.keep_unsold_seats_days` in the past: every
 * seat no ticket and no return points at, and with them the seat-level holds
 * and quota on those seats (their foreign keys cascade).
 *
 * ## What never goes
 *
 * A seat a ticket points at — sold, returned or cancelled, the ticket is a
 * record of money and of a journey. A seat a return points at — deleting it
 * would take the return's segment history with it. Bookings, tickets,
 * payments, refunds, wallets, the departure and its coaches, each of which
 * keeps its seat count, so what ran is still on record.
 *
 * ## How
 *
 * One departure per transaction, a batch at a time, oldest first, within a
 * time budget — a backlog on a free-tier database is worked off over a few
 * runs rather than in one long lock. Each departure is marked when cleared, so
 * a second pass skips it.
 */

const BATCH = 25;
const TIME_BUDGET_MS = 60_000;

/** The departure date before which unsold seats go. */
const cutoffDate = (today = todayInDhaka()) => addDays(today, -settings.get("trip.keep_unsold_seats_days"));

async function clearTrip(trip) {
  return sequelize.transaction(async (transaction) => {
    // Re-read under lock: a departure cleared by an overlapping run is skipped.
    const fresh = await Trip.findByPk(trip.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!fresh || fresh.seatsClearedAt) return 0;

    const [, meta] = await sequelize.query(
      `DELETE ts FROM trip_seats ts
        WHERE ts.trip_id = :tripId
          AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.trip_seat_id = ts.id)
          AND NOT EXISTS (SELECT 1 FROM refund_segments r WHERE r.trip_seat_id = ts.id)`,
      { replacements: { tripId: trip.id }, type: QueryTypes.RAW, transaction }
    );
    const removed = meta?.affectedRows ?? 0;

    await fresh.update({ seatsClearedAt: new Date(), seatsCleared: removed }, { transaction });
    return removed;
  });
}

/**
 * One sweep. Returns what it cleared, and whether departures are still waiting
 * (the time budget ran out first); the next run carries on.
 */
async function clearDeparted({ today, budgetMs = TIME_BUDGET_MS } = {}) {
  const cutoff = cutoffDate(today);
  const started = Date.now();
  const report = { cutoff, departures: 0, seats: 0, more: false };

  for (;;) {
    const trips = await Trip.findAll({
      where: { departureDate: { [Op.lt]: cutoff }, seatsClearedAt: null },
      include: [{ model: TrainName, as: "train", attributes: ["name"] }],
      order: [["departureDate", "ASC"], ["id", "ASC"]],
      limit: BATCH,
    });
    if (!trips.length) break;

    for (const trip of trips) {
      report.seats += await clearTrip(trip);
      report.departures += 1;
      if (Date.now() - started > budgetMs) {
        report.more = true;
        break;
      }
    }
    if (report.more || trips.length < BATCH) break;
  }

  if (report.departures) {
    await audit.record({
      action: AUDIT_ACTIONS.SEATS_CLEARED,
      entity: { type: "horizon", id: report.cutoff, label: `departures before ${report.cutoff}` },
      after: report,
      message:
        `unsold seats of ${report.departures} departure(s) before ${report.cutoff} cleared — ` +
        `${report.seats} seat row(s); tickets, bookings and refunds untouched`,
    });
  }
  return report;
}

module.exports = { clearDeparted, cutoffDate };
