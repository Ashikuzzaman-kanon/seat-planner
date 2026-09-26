const { Op } = require("sequelize");
const { Trip, TrainName, RouteStop, Station, CoachClass } = require("../models");
const { TRIP_STATUS } = require("../models/Trip");
const ApiError = require("../utils/ApiError");
const money = require("../utils/money");
const { todayInDhaka, instantAt, addDays } = require("../utils/dhakaTime");
const availabilityService = require("./availabilityService");
const fareService = require("./fareService");

/**
 * What a passenger sees before they have bought anything.
 *
 * Kept apart from the departure board on purpose. An operations screen wants
 * every trip including cancelled and empty ones, generation status and rebuild
 * history; a passenger wants the handful of trains that will actually carry
 * them from A to B on a given day, with a price and a number of free seats.
 * Those are different questions, and answering the second through the first
 * would mean handing every passenger `trip:view`.
 *
 * So this needs only the permission to buy, and returns only what is useful to
 * someone deciding which train to take.
 */

/**
 * How many nights the longest route in the timetable spends on the move.
 *
 * Bounds how far back to look for trains that are still running on the day
 * being searched. Read from the timetable rather than assumed, so a route that
 * grows an extra night does not quietly become unfindable.
 */
async function maximumDayOffset() {
  const furthest = await RouteStop.max("dayOffset");
  return Number.isFinite(Number(furthest)) ? Math.max(0, Number(furthest)) : 0;
}

/** The stations a passenger can pick between — active ones, name order. */
async function stations() {
  const rows = await Station.findAll({
    where: { isActive: true },
    order: [["name", "ASC"]],
  });
  return rows.map((s) => ({ id: s.id, code: s.code, name: s.name, district: s.district }));
}

/**
 * Trains running on `date` that serve `from` → `to` in that order.
 *
 * Route membership is decided in memory from one query rather than per trip:
 * a handful of trains with a few dozen stops each is far cheaper to filter here
 * than to ask the database about repeatedly.
 */
async function departures({ fromStationId, toStationId, date, coachClassId }) {
  const from = Number(fromStationId);
  const to = Number(toStationId);

  if (!from || !to) throw ApiError.badRequest("Choose where you are travelling from and to");
  if (from === to) throw ApiError.badRequest("The origin and destination are the same station");

  const day = date || todayInDhaka();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw ApiError.badRequest("The date should look like YYYY-MM-DD");
  }
  if (day < todayInDhaka()) {
    throw ApiError.badRequest("That date has passed");
  }

  /*
   * An overnight train leaves Dhaka at 22:00 and calls at Bangabandhu Setu at
   * 00:08 — the next calendar day. Its `departureDate` is the day it left its
   * *origin*, which is not the day a passenger joining at Setu travels.
   *
   * Matching the requested date against `departureDate` therefore hides that
   * train from anyone boarding after midnight, and shows it to people
   * searching the day before under a boarding time that has not happened yet.
   *
   * So trips are gathered from a window ending on the requested day and then
   * filtered on the date the passenger actually boards: departureDate plus the
   * day offset of their own origin stop.
   */
  const longestJourney = await maximumDayOffset();
  const window = [];
  for (let back = 0; back <= longestJourney; back++) window.push(addDays(day, -back));

  const trips = await Trip.findAll({
    where: { departureDate: window, status: TRIP_STATUS.SCHEDULED },
    include: [{ model: TrainName, as: "train" }],
    order: [["trainId", "ASC"]],
  });
  if (!trips.length) return { date: day, fromStationId: from, toStationId: to, departures: [] };

  const trainIds = [...new Set(trips.map((t) => t.trainId))];
  const stops = await RouteStop.findAll({
    where: { trainId: trainIds },
    include: [{ model: Station, as: "station" }],
    order: [["sequence", "ASC"]],
  });

  const stopsByTrain = stops.reduce((acc, stop) => {
    (acc[stop.trainId] = acc[stop.trainId] || []).push(stop);
    return acc;
  }, {});

  const classes = await CoachClass.findAll();
  const classNames = new Map(classes.map((c) => [c.id, c.name]));

  const results = [];

  for (const trip of trips) {
    const route = stopsByTrain[trip.trainId] || [];
    const origin = route.find((s) => s.stationId === from);
    const destination = route.find((s) => s.stationId === to);

    // Both stations must be on the route, and in the direction of travel.
    if (!origin || !destination || destination.sequence <= origin.sequence) continue;

    // The day this passenger actually boards, which for a train that left its
    // origin the night before is not the day the trip is filed under.
    const boardingDate = addDays(trip.departureDate, origin.dayOffset || 0);
    if (boardingDate !== day) continue;

    let availability;
    try {
      availability = await availabilityService.forJourney({
        tripId: trip.id,
        fromStationId: from,
        toStationId: to,
        coachClassId,
      });
    } catch {
      // A departure whose seats are not built yet simply has nothing to sell.
      continue;
    }

    // One fare per class on offer, so the card can show "from ৳ x".
    const fares = [];
    for (const [id, count] of Object.entries(availability.availableByClass || {})) {
      try {
        const fare = await fareService.resolveFare({
          trainId: trip.trainId,
          coachClassId: Number(id),
          fromStationId: from,
          toStationId: to,
        });
        fares.push({
          coachClassId: Number(id),
          coachClass: classNames.get(Number(id)) || "Unknown",
          availableCount: count,
          fareMinor: money.toMinor(fare.amount),
          fareFormatted: money.format(money.toMinor(fare.amount)),
          basis: fare.basis,
        });
      } catch {
        // A class with no fare rule cannot be sold; leave it off the card
        // rather than showing a price of zero.
      }
    }

    fares.sort((a, b) => a.fareMinor - b.fareMinor);

    results.push({
      tripId: trip.id,
      trainId: trip.trainId,
      train: { id: trip.train.id, name: trip.train.name, code: trip.train.code },
      // When the train left its origin. For a passenger joining mid-route after
      // midnight this is the day before they travel — `from.date` is theirs.
      departureDate: trip.departureDate,
      boardingDate,

      from: {
        stationId: origin.stationId,
        name: origin.station?.name,
        code: origin.station?.code,
        time: origin.departureTime || origin.arrivalTime,
        // The calendar day this passenger boards — equal to the date searched
        // for, and not always the date the trip is filed under.
        date: boardingDate,
        sequence: origin.sequence,
      },
      to: {
        stationId: destination.stationId,
        name: destination.station?.name,
        code: destination.station?.code,
        time: destination.arrivalTime || destination.departureTime,
        date: addDays(trip.departureDate, destination.dayOffset || 0),
        // Nights spent on the train after boarding. Saying so is the difference
        // between a passenger catching it and missing it.
        dayOffset: (destination.dayOffset || 0) - (origin.dayOffset || 0),
        sequence: destination.sequence,
      },

      stopsBetween: destination.sequence - origin.sequence - 1,
      availableCount: availability.availableCount,
      totalSeats: availability.totalSeats,
      fares,
      cheapestMinor: fares.length ? fares[0].fareMinor : null,
      cheapestFormatted: fares.length ? fares[0].fareFormatted : null,
      departsAt: origin.departureTime
        ? instantAt(trip.departureDate, origin.departureTime, origin.dayOffset)
        : null,
    });
  }

  // Earliest first: the order a passenger reads a departure board in.
  results.sort((a, b) => String(a.from.time || "").localeCompare(String(b.from.time || "")));

  return { date: day, fromStationId: from, toStationId: to, departures: results };
}

/**
 * The stops of one departure, so a passenger can see where it calls.
 *
 * Only what is printed on a timetable — no generation metadata, no seat rows.
 */
async function route(tripId) {
  const trip = await Trip.findByPk(tripId, { include: [{ model: TrainName, as: "train" }] });
  if (!trip) throw ApiError.notFound("Departure not found");

  const stops = await RouteStop.findAll({
    where: { trainId: trip.trainId },
    include: [{ model: Station, as: "station" }],
    order: [["sequence", "ASC"]],
  });

  return {
    tripId: trip.id,
    departureDate: trip.departureDate,
    status: trip.status,
    train: { id: trip.train.id, name: trip.train.name, code: trip.train.code },
    stops: stops.map((s) => ({
      sequence: s.sequence,
      stationId: s.stationId,
      station: s.station ? { id: s.station.id, code: s.station.code, name: s.station.name } : null,
      arrivalTime: s.arrivalTime,
      departureTime: s.departureTime,
      dayOffset: s.dayOffset,
      distanceKm: s.distanceKm,
    })),
  };
}

/** The next few dates worth offering in a date picker. */
function upcomingDates(days = 14) {
  const { horizonDates } = require("../utils/dhakaTime");
  return horizonDates(days);
}

module.exports = { stations, departures, route, upcomingDates };
