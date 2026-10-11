/**
 * Test fixture: what an operator and the first passengers set up by hand, and
 * no seeder makes.
 *
 * - Standing is sold in no class until an operator gives it a capacity
 *   (Reference Data → Coach classes). The standing suites need one class that
 *   sells it, on the train they use — Ekota's Shovon Chair coaches.
 * - A passenger fills in name, National ID and date of birth once, before their
 *   first booking. The suites buy as the unit-test accounts, so those have it.
 * - Some suites inspect a ticket that already exists (its QR code, its PDF)
 *   rather than buying one, so unittest-super1 holds a booking: two seats on an
 *   Ekota departure three days out, over a middle stretch (Bangabandhu Setu
 *   East → Santahar) — so those seats are sold there and free either side.
 */
const { sequelize, CoachClass, User, Trip, TrainName, RouteStop } = require("../../../src/models");
const { TRIP_STATUS } = require("../../../src/models/Trip");
const walletService = require("../../../src/services/walletService");
const selectionService = require("../../../src/services/selectionService");
const bookingService = require("../../../src/services/bookingService");
const { loadSettings } = require("../../../src/services/settingService");
const { todayInDhaka, addDays } = require("../../../src/utils/dhakaTime");
const money = require("../../../src/utils/money");

const STANDING = { "Shovon Chair": 20 };

const PROFILES = [
  ["unittest-super1@example.com", "1985000000011", "1985-01-11"],
  ["unittest-super2@example.com", "1985000000022", "1985-02-22"],
  ["unittest-admin@example.com", "1986000000033", "1986-03-03"],
  ["unittest-planner@example.com", "1987000000044", "1987-04-04"],
  ["unittest-checker@example.com", "1988000000055", "1988-05-05"],
  ["unittest-user@example.com", "1990000000066", "1990-06-06"],
  ["unittest-target@example.com", "1991000000077", "1991-07-07"],
];

(async () => {
  await loadSettings();

  for (const [name, standingCapacity] of Object.entries(STANDING)) {
    const [count] = await CoachClass.update({ standingCapacity }, { where: { name } });
    if (count !== 1) throw new Error(`coach class "${name}" not found`);
  }
  console.log(`standing capacity set: ${JSON.stringify(STANDING)}`);

  for (const [email, nid, dateOfBirth] of PROFILES) {
    const [count] = await User.update({ nid, dateOfBirth }, { where: { email } });
    if (count !== 1) throw new Error(`no account ${email}`);
  }
  console.log(`travel profiles filled in for ${PROFILES.length} unit-test accounts`);

  // A booking to look at.
  const owner = await User.findOne({ where: { email: "unittest-super1@example.com" } });
  const ekota = await TrainName.findOne({ where: { name: "Ekota Express" } });
  const trip = await Trip.findOne({
    where: { trainId: ekota.id, status: TRIP_STATUS.SCHEDULED, departureDate: addDays(todayInDhaka(), 3) },
  });
  if (!trip) throw new Error("no Ekota departure three days out");
  const stops = await RouteStop.findAll({ where: { trainId: ekota.id }, order: [["sequence", "ASC"]] });

  await walletService.topUp({ userId: owner.id, amountMinor: money.toMinor(10000), reference: "FIXTURE", actorLabel: "test fixture" });
  const { hold } = await selectionService.selectAndHold({
    tripId: trip.id,
    userId: owner.id,
    fromStationId: stops[3].stationId,
    toStationId: stops[7].stationId,
    count: 2,
  });
  const booking = await bookingService.create({
    userId: owner.id,
    holdReference: hold.reference,
    passengers: [
      { name: "Fixture Passenger One", nid: "1985000000011", dob: "1985-01-11" },
      { name: "Fixture Passenger Two", nid: "1992000000088", dob: "1992-08-08" },
    ],
    method: "wallet",
  });
  console.log(`booking ${booking.reference}: 2 tickets on Ekota ${trip.departureDate}`);

  // The confirmation email is sent after the response, in the background.
  await new Promise((r) => setTimeout(r, 1500));
  await sequelize.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
