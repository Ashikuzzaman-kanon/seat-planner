// Clearing long-departed trains' unsold seats: only seat rows nobody bought go;
// every booking, ticket, payment, refund and wallet record stays.
const BACKEND = require("path").resolve(__dirname, "../../..");
const { sequelize, Trip, TripSeat, TripCoach, RouteStop } = require(`${BACKEND}/src/models`);
const settings = require(`${BACKEND}/src/services/settingService`);
const retention = require(`${BACKEND}/src/services/seatRetentionService`);
const { todayInDhaka, addDays } = require(`${BACKEND}/src/utils/dhakaTime`);

const BASE = process.env.API_BASE;

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

const login = async (email) =>
  (await call("POST", "/auth/login", { body: { email, password: "UnitTest123!" } })).body;

const count = async (table, where = "") =>
  Number((await sequelize.query(`SELECT COUNT(*) AS n FROM ${table} ${where}`, { type: "SELECT" }))[0].n);

/** Everything that is a record of money or a journey, which must come through untouched. */
const RECORDS = ["bookings", "tickets", "payments", "refunds", "refund_segments", "wallets", "wallet_transactions", "trip_coaches"];
const records = async () => Object.fromEntries(await Promise.all(RECORDS.map(async (t) => [t, await count(t)])));

(async () => {
  await settings.loadSettings();
  const user = await login("unittest-user@example.com");
  const su = await login("unittest-super1@example.com");
  const ut = user.accessToken;

  console.log("== a departure with tickets on it ==");
  const tomorrow = addDays(todayInDhaka(), 1);
  const trips = await Trip.findAll({
    where: { status: "scheduled", departureDate: { [require(`${BACKEND}/node_modules/sequelize`).Op.gte]: tomorrow } },
    order: [["departureDate", "ASC"]],
  });
  const withSeats = [];
  for (const t of trips) if ((await TripSeat.count({ where: { tripId: t.id } })) > 10) withSeats.push(t);
  check("there are departures with seats to work on", withSeats.length >= 3, `${withSeats.length}`);
  const [old, recent, future] = withSeats;

  const stops = await RouteStop.findAll({ where: { trainId: old.trainId }, order: [["sequence", "ASC"]] });
  const journey = { tripId: old.id, fromStationId: stops[0].stationId, toStationId: stops[stops.length - 1].stationId };
  const held = await call("POST", "/holds/auto", { token: ut, body: { ...journey, count: 2, together: true } });
  check("two seats are held", held.status === 201, JSON.stringify(held.body?.error));
  const quote = await call("POST", "/bookings/quote", { token: ut, body: { holdReference: held.body.hold.reference } });
  await call("POST", "/wallet/topup", { token: ut, body: { amount: Math.ceil(quote.body.totalMinor / 100) + 10 } });
  const booked = await call("POST", "/bookings", {
    token: ut,
    body: {
      holdReference: held.body.hold.reference,
      passengers: [
        { name: "Kept Passenger", nid: "1990555566663", dob: "1990-01-01" },
        { name: "Returned Passenger", nid: "1990555566664", dob: "1990-01-01" },
      ],
      method: "wallet",
    },
  });
  check("and bought", booked.status === 201, JSON.stringify(booked.body?.error || booked.body?.message));
  const booking = booked.body.booking;
  const returned = await call("POST", `/tickets/${booking.tickets[1].id}/refund`, { token: ut, body: { type: "demand" } });
  check("one ticket is returned on demand, so a return points at its seat", [200, 201].includes(returned.status),
    JSON.stringify(returned.body).slice(0, 200));

  const totalSeats = await TripSeat.count({ where: { tripId: old.id } });
  const recentSeats = await TripSeat.count({ where: { tripId: recent.id } });
  const futureSeats = await TripSeat.count({ where: { tripId: future.id } });
  const coachSeats = (await TripCoach.findAll({ where: { tripId: old.id } })).reduce((n, c) => n + c.seatCount, 0);
  const before = await records();

  console.log("\n== time passes ==");
  const keep = settings.get("trip.keep_unsold_seats_days");
  check("unsold seats are kept 90 days by default", keep === 90, `${keep}`);
  await old.update({ departureDate: addDays(todayInDhaka(), -(keep + 10)) });
  await recent.update({ departureDate: addDays(todayInDhaka(), -(keep - 10)) });

  const report = await retention.clearDeparted();
  check("the sweep clears the departure past the window", report.departures >= 1, JSON.stringify(report));
  check("and reports its cutoff", report.cutoff === addDays(todayInDhaka(), -keep), report.cutoff);

  const left = await TripSeat.findAll({ where: { tripId: old.id }, attributes: ["id"] });
  const leftIds = new Set(left.map((s) => s.id));
  check("only the two seats with tickets are left", left.length === 2, `${left.length} of ${totalSeats}`);
  check("they are exactly the booked seats",
    booking.tickets.every((t) => leftIds.has(t.tripSeatId ?? t.seatId ?? -1)) ||
      (await count("tickets", `WHERE booking_id = ${booking.id} AND trip_seat_id IN (${[...leftIds].join(",") || 0})`)) === 2);
  const marked = await Trip.findByPk(old.id);
  check("the departure is marked cleared, with the count", !!marked.seatsClearedAt && marked.seatsCleared === totalSeats - 2,
    `${marked.seatsClearedAt} ${marked.seatsCleared}`);

  const after = await records();
  check("every booking, ticket, payment, refund and wallet record is untouched",
    JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  check("the coaches still say how many seats ran",
    (await TripCoach.findAll({ where: { tripId: old.id } })).reduce((n, c) => n + c.seatCount, 0) === coachSeats);

  check("a departure inside the window keeps every seat", (await TripSeat.count({ where: { tripId: recent.id } })) === recentSeats);
  check("and so does one still to run", (await TripSeat.count({ where: { tripId: future.id } })) === futureSeats);

  const shown = await call("GET", `/bookings/${booking.id}`, { token: ut });
  check("the passenger's booking still reads in full", shown.status === 200 &&
    shown.body.booking.tickets.every((t) => t.coachCode && t.seatNumber), JSON.stringify(shown.body?.booking?.tickets?.[0]));

  console.log("\n== once is enough ==");
  const again = await retention.clearDeparted();
  check("a second sweep finds nothing to do", again.departures === 0, JSON.stringify(again));
  const rebuild = await call("POST", `/trips/${old.id}/rebuild`, { token: su.accessToken });
  check("a cleared departure cannot be rebuilt", rebuild.status === 400 && /cleared/.test(rebuild.body?.error?.message),
    `${rebuild.status} ${rebuild.body?.error?.message}`);
  const trip = await call("GET", `/trips/${old.id}`, { token: su.accessToken });
  check("and says when it was cleared", !!trip.body?.trip?.seatsClearedAt, JSON.stringify(trip.body?.trip).slice(0, 200));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await sequelize.close();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
