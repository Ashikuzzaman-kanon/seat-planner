/**
 * Turning a published timetable into route stops, as pure functions.
 *
 * The railway publishes each stop as a city with 12-hour clock times
 * ("03:00 pm BST"). A route here needs 24-hour times, a day offset per stop,
 * and a cumulative distance for fares — none of which the timetable states
 * directly. The rules below derive them, and say so whenever the published
 * times have to be adjusted to make a coherent route:
 *
 *   - A station listed twice in a row is one stop: first arrival, last departure.
 *   - A time well over twelve hours earlier than the one before it means the
 *     train crossed midnight. A smaller step backwards is a typing error: if
 *     the stop before published only one time (no halt), that stop is the
 *     unreliable one and is left out; otherwise the time is raised to the one
 *     before it. Leaving the stop out matters — raising the next stop's time
 *     instead would tell its passengers to board after the train has gone.
 *   - A stop that departs before it arrives (not across midnight) keeps the
 *     arrival, which the published running times agree with.
 *   - A stop has one day offset. A halt that spans midnight keeps its
 *     departure and is recorded as arriving at 00:00.
 *   - An intermediate stop that publishes only one time is given it for both.
 *
 * The timetable publishes no distances. They are estimated from the fastest
 * running time between two stations on any train, at `KM_PER_MINUTE`, so the
 * same journey costs the same on every train. They are estimates, editable on
 * the route afterwards, and fares follow.
 */

const MINUTES_PER_DAY = 1440;
const MIDNIGHT_JUMP = 12 * 60;
const KM_PER_MINUTE = 1; // 60 km/h
const DEFAULT_SEGMENT_MINUTES = 2;

const DAY_NUMBERS = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });

const CLOCK = /^(\d{1,2}):(\d{2})\s*(am|pm)\b/i;

/** "03:00 pm BST" -> 900 (minutes after midnight); null for anything else. */
function parseClock(text) {
  const match = CLOCK.exec(String(text ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]) % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0);
  return hours * 60 + Number(match[2]);
}

/** 900 -> "15:00". Takes minutes of the day or absolute minutes. */
function clockText(minutes) {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "07:30" -> 450; null when it is not a duration. */
function parseDuration(text) {
  const match = /^(\d+):(\d{2})$/.exec(String(text ?? "").trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** ["Fri", "Sun"] -> [0, 5]. Unknown names are ignored. */
function runningDays(days) {
  return [...new Set((days || []).map((d) => DAY_NUMBERS[d]).filter((d) => d !== undefined))].sort();
}

/**
 * Stops as `{ city, arrival, departure, single }` in minutes of the day,
 * repeats merged. `single` marks a stop that published one time only.
 */
function mergeRepeats(routes, notes) {
  const stops = [];
  for (const row of routes) {
    const arrival = parseClock(row.arrival_time);
    const departure = parseClock(row.departure_time);
    const last = stops[stops.length - 1];
    if (last && last.city === row.city) {
      if (last.arrival === null) last.arrival = arrival;
      if (departure !== null) last.departure = departure;
      last.single = (last.arrival === null) !== (last.departure === null);
      notes.push(`${row.city} is listed twice in a row — merged into one stop`);
      continue;
    }
    stops.push({ city: row.city, arrival, departure, single: (arrival === null) !== (departure === null) });
  }
  return stops;
}

/**
 * One train's stops with 24-hour times, day offsets and halts, plus notes on
 * every adjustment the published times needed.
 *
 * Each stop carries `arrivalAt` / `departureAt` — absolute minutes from
 * midnight of the origin's departure day — for distance estimation.
 */
function buildStops(routes) {
  const notes = [];
  let stops = mergeRepeats(routes, notes);

  for (;;) {
    if (stops.length < 2) return { stops: [], notes: [...notes, "fewer than two stops"] };
    const attempt = timeline(stops);
    if (attempt.drop === null) return { stops: attempt.stops, notes: [...notes, ...attempt.notes] };
    const dropped = stops[attempt.drop];
    notes.push(
      `${dropped.city}: publishes a single time (${clockText(dropped.arrival ?? dropped.departure)}) out of ` +
        "order with the stops around it — left out of the route"
    );
    stops = stops.filter((_, i) => i !== attempt.drop);
  }
}

/**
 * Lay the stops on a timeline. Returns `{ drop: index }` instead when a stop
 * should be left out (see the rules above) and the timeline built again.
 */
function timeline(input) {
  const notes = [];
  const stops = input.map((s) => ({ city: s.city, arrival: s.arrival, departure: s.departure }));

  const first = stops[0];
  const last = stops[stops.length - 1];
  first.departure ??= first.arrival;
  first.arrival = null;
  last.arrival ??= last.departure;
  last.departure = null;

  for (const stop of stops.slice(1, -1)) {
    if (stop.arrival === null && stop.departure !== null) stop.arrival = stop.departure;
    if (stop.departure === null && stop.arrival !== null) stop.departure = stop.arrival;
  }

  let day = 0;
  let previous = null;

  for (const [index, stop] of stops.entries()) {
    // Departing before arriving, short of a midnight crossing: keep the arrival.
    if (stop.arrival !== null && stop.departure !== null) {
      const back = stop.arrival - stop.departure;
      if (back > 0 && back < MIDNIGHT_JUMP) {
        notes.push(
          `${stop.city}: departs ${clockText(stop.departure)} before it arrives ${clockText(stop.arrival)} — ` +
            `departure recorded as ${clockText(stop.arrival)}`
        );
        stop.departure = stop.arrival;
      }
    }

    for (const field of ["arrival", "departure"]) {
      if (stop[field] === null) continue;
      let at = day * MINUTES_PER_DAY + stop[field];
      if (previous !== null && at < previous) {
        if (previous - at >= MIDNIGHT_JUMP) {
          day += 1;
          at += MINUTES_PER_DAY;
        } else if (index > 1 && field === "arrival" && input[index - 1].single) {
          return { drop: index - 1, stops: null, notes: null };
        } else {
          notes.push(
            `${stop.city}: ${field} ${clockText(stop[field])} is earlier than the stop before — ` +
              `recorded as ${clockText(previous)}`
          );
          at = previous;
        }
      }
      stop[`${field}At`] = at;
      previous = at;
    }

    stop.arrivalAt ??= null;
    stop.departureAt ??= null;

    const arrivalDay = stop.arrivalAt === null ? null : Math.floor(stop.arrivalAt / MINUTES_PER_DAY);
    const departureDay = stop.departureAt === null ? null : Math.floor(stop.departureAt / MINUTES_PER_DAY);
    if (arrivalDay !== null && departureDay !== null && arrivalDay !== departureDay) {
      notes.push(
        `${stop.city}: the halt spans midnight (arrives ${clockText(stop.arrivalAt)}, departs ` +
          `${clockText(stop.departureAt)}) — arrival recorded as 00:00`
      );
      stop.arrivalAt = departureDay * MINUTES_PER_DAY;
    }
  }

  return {
    drop: null,
    stops: stops.map((stop) => {
      const at = stop.departureAt ?? stop.arrivalAt;
      return {
        city: stop.city,
        arrivalTime: stop.arrivalAt === null ? null : clockText(stop.arrivalAt),
        departureTime: stop.departureAt === null ? null : clockText(stop.departureAt),
        dayOffset: Math.floor(at / MINUTES_PER_DAY),
        haltMinutes:
          stop.arrivalAt !== null && stop.departureAt !== null ? stop.departureAt - stop.arrivalAt : null,
        arrivalAt: stop.arrivalAt,
        departureAt: stop.departureAt,
      };
    }),
    notes,
  };
}

/** Minutes of running between consecutive stops, keyed by the station pair. */
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * The fastest running time between each pair of neighbouring stations, over
 * every train — the basis for distances that agree across trains.
 */
function fastestSegments(trainStops) {
  const fastest = new Map();
  for (const stops of trainStops) {
    for (let i = 1; i < stops.length; i++) {
      const minutes = stops[i].arrivalAt - stops[i - 1].departureAt;
      if (!(minutes > 0)) continue;
      const key = pairKey(stops[i - 1].city, stops[i].city);
      if (!fastest.has(key) || minutes < fastest.get(key)) fastest.set(key, minutes);
    }
  }
  return fastest;
}

/** Cumulative kilometres for one train's stops, from the shared segment times. */
function estimateDistances(stops, fastest) {
  let km = 0;
  return stops.map((stop, i) => {
    if (i > 0) {
      const minutes = fastest.get(pairKey(stops[i - 1].city, stop.city)) ?? DEFAULT_SEGMENT_MINUTES;
      km += minutes * KM_PER_MINUTE;
    }
    return Math.round(km * 10) / 10;
  });
}

module.exports = {
  KM_PER_MINUTE,
  parseClock,
  clockText,
  parseDuration,
  runningDays,
  buildStops,
  fastestSegments,
  estimateDistances,
};
