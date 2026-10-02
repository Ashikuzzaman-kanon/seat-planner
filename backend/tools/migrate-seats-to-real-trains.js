#!/usr/bin/env node

/**
 * Delete all 12 dummy test trains.
 * Since there are no real bookings (all test data), we just remove them cleanly.
 */

const { TrainName, TripSeat, SeatPlan, TrainCoach, sequelize } = require("../src/models");

const DUMMY_TRAINS = [
  'Ekota Express',
  'Madhumati Express',
  'Kurigram Express',
  'Rangpur Express',
  'Banalata Express',
  'Parabat Express',
  'Rupsa Express',
  'Silk City Express',
  'Sundarban Express',
  'Subarna Express',
  'Turna Nishitha',
  'Route Test Express',
];

async function countDummySeats() {
  let total = 0;
  for (const name of DUMMY_TRAINS) {
    const train = await TrainName.findOne({ where: { name } });
    if (!train) continue;

    const count = await TripSeat.count({
      include: [
        {
          association: 'coach',
          attributes: [],
          required: true,
          include: [
            {
              association: 'trip',
              attributes: [],
              required: true,
              where: { trainId: train.id },
            },
          ],
        },
      ],
    });
    total += count;
  }
  return total;
}

async function deleteDummyTrains() {
  console.log('Deleting all 12 dummy test trains...\n');

  const countBefore = await countDummySeats();
  console.log(`Total dummy seats: ${countBefore}\n`);

  // Get all dummy train IDs
  const dummyTrains = await TrainName.findAll({
    where: { name: DUMMY_TRAINS },
    attributes: ['id', 'name'],
  });

  if (dummyTrains.length === 0) {
    console.log('⚠️  No dummy trains found');
    return;
  }

  const trainIds = dummyTrains.map(t => t.id);
  console.log(`Found ${trainIds.length} dummy trains to delete\n`);

  try {
    // Delete in correct order to handle foreign key constraints
    // Use raw queries to bypass ORM restrictions

    // 1. Delete bookings (references trips)
    await sequelize.query(`
      DELETE FROM bookings
      WHERE trip_id IN (
        SELECT id FROM trips WHERE train_id IN (${trainIds.join(',')})
      )
    `);

    // 2. Delete tickets (references trip_seats)
    await sequelize.query(`
      DELETE t FROM tickets t
      INNER JOIN trip_seats ts ON t.trip_seat_id = ts.id
      INNER JOIN trip_coaches tc ON ts.trip_coach_id = tc.id
      INNER JOIN trips tr ON tc.trip_id = tr.id
      WHERE tr.train_id IN (${trainIds.join(',')})
    `);

    // 3. Delete trip seats
    await sequelize.query(`
      DELETE ts FROM trip_seats ts
      INNER JOIN trip_coaches tc ON ts.trip_coach_id = tc.id
      INNER JOIN trips t ON tc.trip_id = t.id
      WHERE t.train_id IN (${trainIds.join(',')})
    `);

    // 4. Delete trip coaches
    await sequelize.query(`
      DELETE tc FROM trip_coaches tc
      INNER JOIN trips t ON tc.trip_id = t.id
      WHERE t.train_id IN (${trainIds.join(',')})
    `);

    // 5. Delete trips
    await sequelize.query(`
      DELETE FROM trips WHERE train_id IN (${trainIds.join(',')})
    `);

    // 6. Delete train coaches
    await sequelize.query(`
      DELETE FROM train_coaches WHERE train_id IN (${trainIds.join(',')})
    `);

    // 7. Delete seat plans
    await sequelize.query(`
      DELETE FROM seat_plans WHERE train_name_id IN (${trainIds.join(',')})
    `);

    // 8. Delete train names
    await sequelize.query(`
      DELETE FROM train_names WHERE id IN (${trainIds.join(',')})
    `);

    console.log(`✓ Deleted ${dummyTrains.length} trains`);
    console.log(`✓ Deleted seat plans for all trains`);
    console.log(`✓ Deleted train coaches for all trains`);
    console.log(`✓ Deleted trips for all trains`);
    console.log(`✓ Deleted trip coaches for all trains`);
    console.log(`✓ Deleted trip seats for all trains`);
    console.log(`✓ Deleted all bookings`);
    console.log(`✓ Deleted all associated tickets\n`);

    const countAfter = await countDummySeats();
    console.log(`✓ Removed ${countBefore} seats`);
    console.log(`✓ Remaining dummy seats: ${countAfter}`);

    if (countAfter === 0) {
      console.log(`\n✅ All dummy trains successfully removed!`);
    }
  } catch (err) {
    console.error(`Error during deletion: ${err.message}`);
    throw err;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  Remove All Dummy Test Trains             ║');
  console.log('╚════════════════════════════════════════════╝\n');

  try {
    await deleteDummyTrains();
    console.log('\n✅ Cleanup complete!');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }

  process.exit(0);
}

main();
