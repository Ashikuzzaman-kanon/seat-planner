/**
 * The safety property the whole product rests on:
 * two simultaneous purchases of the same seat-segment must not both succeed.
 *
 */
const { sequelize, Trip, TripSeat, RouteStop, SeatSegmentBooking } = require("../../../src/models");
const inventory = require("../../../src/services/inventoryService");
const { SEGMENT_SOURCE } = require("../../../src/models/SeatSegmentBooking");

// Marks this suite's own rows, so cleaning up never touches a real sale.
const MINE = "concurrency-suite";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} ${ok ? "" : detail}`);
};

(async () => {
  // Pick the latest departure that actually has seats built — a departure whose
  // layouts are still pending review has no inventory to contend over.
  const withSeats = await TripSeat.findAll({
    attributes: ["tripId"],
    group: ["tripId"],
    raw: true,
  });
  const trip = await Trip.findOne({
    where: { status: "scheduled", id: withSeats.map((r) => r.tripId) },
    order: [["departureDate", "DESC"]],
  });
  if (!trip) throw new Error("no scheduled departure has seats — run seed:departures first");
  const stops = await RouteStop.findAll({
    where: { trainId: trip.trainId },
    order: [["sequence", "ASC"]],
  });
  const seats = await TripSeat.findAll({ where: { tripId: trip.id }, limit: 5, order: [["id", "ASC"]] });

  const A = stops[0].stationId;
  const B = stops[1].stationId;
  const C = stops[2].stationId;
  const D = stops[3].stationId;

  // Only ever removes this suite's own rows. Now that real tickets and holds
  // occupy the same table, a blanket delete by trip would quietly strip the
  // seats out from under a genuine sale.
  const clean = () =>
    SeatSegmentBooking.destroy({
      where: { tripId: trip.id, source: SEGMENT_SOURCE.BLOCK, reason: MINE },
    });
  await clean();

  /** Counts only this suite's rows, so a real sale on the seat cannot skew it. */
  const countMine = (tripSeatId) =>
    SeatSegmentBooking.count({
      where: { tripSeatId, source: SEGMENT_SOURCE.BLOCK, reason: MINE },
    });

  // Reserved as blocks rather than tickets: the race under test lives in the
  // unique index on (trip_seat_id, segment_index), which every source shares,
  // and a block needs no ticket row to point at.
  const attempt = (tripSeatId, fromStationId, toStationId) =>
    inventory.reserveSegments({
      tripId: trip.id,
      seats: [{ tripSeatId, fromStationId, toStationId }],
      source: SEGMENT_SOURCE.BLOCK,
      reason: MINE,
    });

  console.log(`\nDeparture ${trip.departureDate}, ${seats.length} seats sampled, ${stops.length} stops\n`);

  console.log("== 2 buyers, same seat, same segment ==");
  let results = await Promise.allSettled([
    attempt(seats[0].id, A, B, 1001),
    attempt(seats[0].id, A, B, 1002),
  ]);
  let won = results.filter((r) => r.status === "fulfilled").length;
  check("exactly one succeeds", won === 1, `${won} succeeded`);
  check("the loser gets a clear conflict, not a crash",
    results.some((r) => r.status === "rejected" && /taken for part of this journey/i.test(r.reason.message)),
    JSON.stringify(results.filter((r) => r.status === "rejected").map((r) => r.reason.message)));
  let rows = await countMine(seats[0].id);
  check("exactly one row is stored", rows === 1, `${rows} rows`);

  console.log("\n== 10 buyers, same seat, same segment ==");
  await clean();
  results = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) => attempt(seats[1].id, A, B, 2000 + i))
  );
  won = results.filter((r) => r.status === "fulfilled").length;
  check("still exactly one winner out of ten", won === 1, `${won} succeeded`);
  rows = await countMine(seats[1].id);
  check("still exactly one row", rows === 1, `${rows} rows`);

  console.log("\n== 2 buyers, same seat, journeys that only touch end to end ==");
  await clean();
  results = await Promise.allSettled([
    attempt(seats[2].id, A, B, 3001), // segment 0
    attempt(seats[2].id, B, C, 3002), // segment 1
  ]);
  won = results.filter((r) => r.status === "fulfilled").length;
  check("both succeed — meeting at B is not an overlap", won === 2,
    JSON.stringify(results.filter((r) => r.status === "rejected").map((r) => r.reason.message)));
  rows = await countMine(seats[2].id);
  check("two rows stored, one per segment", rows === 2, `${rows} rows`);

  console.log("\n== 2 buyers, same seat, overlapping journeys ==");
  await clean();
  results = await Promise.allSettled([
    attempt(seats[3].id, A, C, 4001), // segments 0,1
    attempt(seats[3].id, B, D, 4002), // segments 1,2 - collides on 1
  ]);
  won = results.filter((r) => r.status === "fulfilled").length;
  check("exactly one succeeds — they share segment 1", won === 1, `${won} succeeded`);
  rows = await countMine(seats[3].id);
  check("only the winner's two segments are stored", rows === 2, `${rows} rows`);

  console.log("\n== the loser's partial work is rolled back ==");
  await clean();
  // First buyer takes B->C only. Second wants A->D, which needs 0,1,2 and will
  // fail on 1 - segment 0 must not survive from the failed attempt.
  await attempt(seats[4].id, B, C, 5001);
  const before = await countMine(seats[4].id);
  let rejected = null;
  try {
    await attempt(seats[4].id, A, D, 5002);
  } catch (err) {
    rejected = err;
  }
  const after = await countMine(seats[4].id);
  check("the overlapping purchase is refused", !!rejected, "it was allowed");
  check("no partial rows remain from it", after === before, `${before} -> ${after}`);

  console.log("\n== different seats never contend ==");
  await clean();
  results = await Promise.allSettled(
    seats.map((s, i) => attempt(s.id, A, B, 6000 + i))
  );
  won = results.filter((r) => r.status === "fulfilled").length;
  check("all five succeed in parallel", won === seats.length, `${won}/${seats.length}`);

  await clean();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await sequelize.close();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error("harness error:", err);
  await sequelize.close();
  process.exit(1);
});
