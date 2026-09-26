/**
 * Route validation, as pure functions.
 *
 * These are deliberately free of the database and of Express: a route is just
 * an ordered list of stops, and whether it is coherent is arithmetic. That
 * makes every rule below directly unit-testable, which matters because a route
 * that validates wrongly silently corrupts every trip generated from it.
 */

/** "23:30" or "23:30:00" -> minutes since midnight. */
function toMinutes(time) {
  if (!time) return null;
  const [h, m] = String(time).split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  return h * 60 + m;
}

/**
 * Absolute minutes from the origin's departure day, which is the only way to
 * compare times on an overnight train: 06:00 on day 1 is after 23:30 on day 0.
 */
function absoluteMinutes(time, dayOffset) {
  const minutes = toMinutes(time);
  return minutes === null ? null : dayOffset * 1440 + minutes;
}

/**
 * Validate a full route. Returns an array of human-readable problems; empty
 * means the route is coherent.
 *
 * `stops` are expected in the order they will be saved, each carrying
 * { stationId, arrivalTime, departureTime, dayOffset, distanceKm }.
 */
function validateRoute(stops) {
  const errors = [];

  if (!Array.isArray(stops) || stops.length < 2) {
    return ["A route needs at least two stops"];
  }

  const seen = new Map();
  stops.forEach((stop, i) => {
    const position = i + 1;

    if (!stop.stationId) {
      errors.push(`Stop ${position} has no station`);
      return;
    }
    if (seen.has(stop.stationId)) {
      errors.push(`Stop ${position} repeats the station used at stop ${seen.get(stop.stationId)}`);
    }
    seen.set(stop.stationId, position);

    if (!Number.isInteger(stop.dayOffset) || stop.dayOffset < 0) {
      errors.push(`Stop ${position} has an invalid day offset`);
    }
  });

  const first = stops[0];
  const last = stops[stops.length - 1];

  if (!first.departureTime) errors.push("The origin needs a departure time");
  if (!last.arrivalTime) errors.push("The terminus needs an arrival time");
  if (first.dayOffset !== 0) errors.push("The origin must be on day offset 0");

  // Time must move forward across the whole route once the day offset is
  // folded in — this is the check an overnight train would otherwise fail.
  let previousMoment = null;
  let previousLabel = "";

  stops.forEach((stop, i) => {
    const position = i + 1;
    const arrival = absoluteMinutes(stop.arrivalTime, stop.dayOffset);
    const departure = absoluteMinutes(stop.departureTime, stop.dayOffset);

    if (arrival !== null && departure !== null && departure < arrival) {
      errors.push(`Stop ${position} departs before it arrives`);
    }

    for (const [moment, label] of [
      [arrival, `stop ${position} arrival`],
      [departure, `stop ${position} departure`],
    ]) {
      if (moment === null) continue;
      if (previousMoment !== null && moment < previousMoment) {
        errors.push(
          `${label} is earlier than ${previousLabel} — check the times and day offsets`
        );
      }
      previousMoment = moment;
      previousLabel = label;
    }

    if (i > 0 && stop.dayOffset < stops[i - 1].dayOffset) {
      errors.push(`Stop ${position} has a day offset lower than the stop before it`);
    }
  });

  // Distance is cumulative from the origin, so it may only increase.
  let previousDistance = null;
  stops.forEach((stop, i) => {
    if (stop.distanceKm === null || stop.distanceKm === undefined) return;
    const distance = Number(stop.distanceKm);
    if (!Number.isFinite(distance) || distance < 0) {
      errors.push(`Stop ${i + 1} has an invalid distance`);
      return;
    }
    if (previousDistance !== null && distance < previousDistance) {
      errors.push(`Stop ${i + 1} is closer to the origin than the stop before it`);
    }
    previousDistance = distance;
  });

  if (stops[0].distanceKm != null && Number(stops[0].distanceKm) !== 0) {
    errors.push("The origin must be at distance 0");
  }

  return errors;
}

/**
 * The segments a route decomposes into: n stops give n-1 segments. This is the
 * unit that seat inventory will be sold against in Phase 4.
 */
function routeSegments(stops) {
  return stops.slice(0, -1).map((stop, i) => ({
    index: i,
    fromStationId: stop.stationId,
    toStationId: stops[i + 1].stationId,
  }));
}

/** Total journey time in minutes from origin departure to terminus arrival. */
function journeyMinutes(stops) {
  if (!stops?.length) return null;
  const start = absoluteMinutes(stops[0].departureTime, stops[0].dayOffset);
  const end = absoluteMinutes(stops[stops.length - 1].arrivalTime, stops[stops.length - 1].dayOffset);
  return start === null || end === null ? null : end - start;
}

module.exports = { validateRoute, routeSegments, journeyMinutes, toMinutes, absoluteMinutes };
