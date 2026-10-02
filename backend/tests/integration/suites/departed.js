// A train that has left a station is not on sale from that station.
//
// Found by the waitlist suite: late in the evening it searched today's
// departures, found Ekota (gone from Dhaka at 22:00) and bought seats on it —
// which the return policy then, correctly, called "departed". Sales for a stop
// now close when the train leaves it.
//
// Checked at a chosen moment rather than the real clock: search and holds both
// take `now`, so the rule is tested one minute either side of departure on any
// day, at any hour.
const { sequelize, Trip, TrainName, RouteStop, Station, User } = require("../../../src/models");
const { TRIP_STATUS } = require("../../../src/models/Trip");
const { loadSettings } = require("../../../src/services/settingService");
const searchService = require("../../../src/services/searchService");
const holdService = require("../../../src/services/holdService");
const availabilityService = require("../../../src/services/availabilityService");
const { instantAt, todayInDhaka, addDays } = require("../../../src/utils/dhakaTime");

let pass = 0;
let fail = 0;
const check = (what, ok, note = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${ok ? "" : `  -- ${note}`}`);
  ok ? pass++ : fail++;
};
const MINUTE = 60_000;

(async () => {
  await loadSettings();

  const ekota = await TrainName.findOne({ where: { name: "Ekota Express" } });
  const trip = await Trip.findOne({
    where: { trainId: ekota.id, status: TRIP_STATUS.SCHEDULED, departureDate: addDays(todayInDhaka(), 4) },
  });
  const stops = await RouteStop.findAll({
    where: { trainId: ekota.id },
    order: [["sequence", "ASC"]],
    include: [{ model: Station, as: "station" }],
  });
  const [dhaka, joydebpur] = stops;
  const ishwardi = stops.find((s) => s.station.code === "ISD");
  const dinajpur = stops[stops.length - 1];
  const buyer = await User.findOne({ where: { email: "unittest-user@example.com" } });

  const leavesDhaka = instantAt(trip.departureDate, dhaka.departureTime, dhaka.dayOffset);
  const before = new Date(leavesDhaka.getTime() - MINUTE);
  const after = new Date(leavesDhaka.getTime() + MINUTE);
  console.log(`Ekota ${trip.departureDate}, leaves Dhaka ${leavesDhaka.toISOString()}\n`);

  const freeSeat = async (from, to) =>
    (await availabilityService.forJourney({ tripId: trip.id, fromStationId: from.stationId, toStationId: to.stationId }))
      .available[0].id;

  console.log("== search ==");
  const search = (now) =>
    searchService.departures({ fromStationId: dhaka.stationId, toStationId: dinajpur.stationId, date: trip.departureDate, now });
  const listed = (result) => result.departures.some((d) => d.tripId === trip.id);
  check("a minute before it leaves Dhaka, it is listed", listed(await search(before)));
  check("a minute after, it is gone from the results", !listed(await search(after)));

  console.log("\n== holding seats ==");
  let refused = null;
  try {
    await holdService.create({
      tripId: trip.id, userId: buyer.id, seatIds: [await freeSeat(dhaka, joydebpur)],
      fromStationId: dhaka.stationId, toStationId: joydebpur.stationId, now: after,
    });
  } catch (err) {
    refused = err;
  }
  check("a seat from Dhaka cannot be held after it has left", refused?.statusCode === 400, refused?.message || "it was held");
  check("and the passenger is told why", /already left Dhaka/.test(refused?.message || ""), refused?.message);

  const early = await holdService.create({
    tripId: trip.id, userId: buyer.id, seatIds: [await freeSeat(dhaka, joydebpur)],
    fromStationId: dhaka.stationId, toStationId: joydebpur.stationId, now: before,
  });
  check("a minute before, the same hold is fine", Boolean(early?.reference), JSON.stringify(early).slice(0, 120));

  // The rule is about the passenger's own station, not the train's first one.
  const onward = await holdService.create({
    tripId: trip.id, userId: buyer.id, seatIds: [await freeSeat(ishwardi, dinajpur)],
    fromStationId: ishwardi.stationId, toStationId: dinajpur.stationId, now: after,
  }).catch((err) => err);
  check("someone boarding later, at Ishwardi, can still buy once it has left Dhaka",
    Boolean(onward?.reference), onward?.message || JSON.stringify(onward).slice(0, 120));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await sequelize.close();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error("suite crashed:", err);
  await sequelize.close();
  process.exit(1);
});
