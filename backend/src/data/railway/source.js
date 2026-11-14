/**
 * Where the railway's timetable comes from, and which trains to ask it for —
 * shared by the command-line fetch (tools/railway/fetch-timetable.js) and the
 * "Check with the railway" button (services/railwaySyncService).
 *
 * The source is the API behind Bangladesh Railway's online ticketing. It is
 * not an official public API: it may change or refuse without notice, and
 * everything that uses it says so plainly when it does.
 *
 * `RAILWAY_SOURCE_URL` points it elsewhere — the tests run a stand-in, so no
 * test ever calls the real one.
 */

const DEFAULT_SOURCE = "https://railspaapi.shohoz.com/v1.0/web/train-routes";

const sourceUrl = () => process.env.RAILWAY_SOURCE_URL || DEFAULT_SOURCE;

function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** The intercity, mail and commuter services the system carries. Adding one is a change here. */
const TRAIN_NUMBERS = Object.freeze([
  ...range(701, 806),
  809, 810, 813, 814, 815, 816, 821, 822, 823, 824, 825, 826, 827, 828,
  41, 42, 57, 58, 61, 62, 65, 66, 77, 78, 110, 135, 136,
  ...range(1001, 1016),
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits, in milliseconds: before a retry (times the attempt), and between batches. Shortened in tests. */
const retryMs = () => Number(process.env.RAILWAY_RETRY_MS) || 1000;
const pauseMs = () => (process.env.RAILWAY_PAUSE_MS !== undefined ? Number(process.env.RAILWAY_PAUSE_MS) : 200);

/**
 * One train's timetable for a day, as the railway publishes it — or null when
 * it publishes none for that number. Throws after `attempts` failed tries.
 * Responses are kept as sent; every conversion happens in the loader.
 */
async function fetchTrain(number, date, { attempts = 3, backoffMs = retryMs(), timeoutMs = 20_000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(sourceUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ model: String(number), departure_date_time: date }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404 || res.status === 422) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = await res.json();
      if (!data?.train_name || !Array.isArray(data.routes) || !data.routes.length) return null;
      return {
        number,
        name: data.train_name,
        days: data.days || [],
        totalDuration: data.total_duration || null,
        routes: data.routes.map((r) => ({
          city: r.city,
          arrival_time: r.arrival_time ?? null,
          departure_time: r.departure_time ?? null,
          halt: r.halt ?? null,
          duration: r.duration ?? null,
        })),
      };
    } catch (err) {
      if (attempt === attempts) throw new Error(`train ${number}: ${err.message}`);
      await sleep(backoffMs * attempt);
    }
  }
  return null;
}

module.exports = { DEFAULT_SOURCE, sourceUrl, TRAIN_NUMBERS, fetchTrain, sleep, pauseMs };
