/**
 * How a train's saved route and running days differ from what the railway
 * publishes now, as pure functions — the arithmetic of "Check with the
 * railway" (services/railwaySyncService).
 *
 * Stops are compared by station name, without case: the railway is the only
 * source of these trains' stations, and its names are what they were saved
 * under. Times are compared as HH:MM, with the day offset.
 */

const hhmm = (time) => (time ? String(time).slice(0, 5) : null);
const key = (stop) => String(stop.station).trim().toLowerCase();
const clock = (stop) => ({ arrival: hhmm(stop.arrivalTime), departure: hhmm(stop.departureTime), dayOffset: stop.dayOffset ?? 0 });

/**
 * Compare a saved route with the published one. Both are lists of
 * `{ station, arrivalTime, departureTime, dayOffset }`, first stop first.
 *
 * Returns one of:
 *   { kind: "same" }
 *   { kind: "times", stops: [{ station, from, to }] }     the same stations, in order; some times moved
 *   { kind: "stations", added, removed, reordered }       stations added, removed, or put in another order
 *   { kind: "new_route", stops }                          nothing saved yet
 */
function compareRoute(current, next) {
  if (!current.length) return { kind: "new_route", stops: next.length };

  const sameStations = current.length === next.length && current.every((stop, i) => key(stop) === key(next[i]));
  if (!sameStations) {
    const before = new Set(current.map(key));
    const after = new Set(next.map(key));
    const added = next.filter((stop) => !before.has(key(stop))).map((stop) => stop.station);
    const removed = current.filter((stop) => !after.has(key(stop))).map((stop) => stop.station);
    return { kind: "stations", added, removed, reordered: !added.length && !removed.length };
  }

  const stops = [];
  next.forEach((stop, i) => {
    const from = clock(current[i]);
    const to = clock(stop);
    if (from.arrival !== to.arrival || from.departure !== to.departure || from.dayOffset !== to.dayOffset) {
      stops.push({ station: stop.station, from, to });
    }
  });
  return stops.length ? { kind: "times", stops } : { kind: "same" };
}

/**
 * The published stops with the saved distances kept, for a route whose
 * stations have not changed: new times should not move fares, and a distance
 * someone corrected by hand must survive.
 */
function keepDistances(current, next) {
  return next.map((stop, i) => ({ ...stop, distanceKm: current[i]?.distanceKm ?? stop.distanceKm }));
}

const sortedDays = (days) => [...new Set(days || [])].map(Number).sort((a, b) => a - b);

/** Whether two sets of running days (0 = Sunday … 6) are the same. */
function sameDays(a, b) {
  return sortedDays(a).join() === sortedDays(b).join();
}

/** The days a train ran on before and no longer does. */
function droppedDays(before, after) {
  const now = new Set(sortedDays(after));
  return sortedDays(before).filter((day) => !now.has(day));
}

/** The weekday (0 = Sunday) of a YYYY-MM-DD date. */
function weekdayOf(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

module.exports = { compareRoute, keepDistances, sameDays, droppedDays, weekdayOf };
