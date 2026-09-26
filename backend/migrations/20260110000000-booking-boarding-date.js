"use strict";

/**
 * The date the passenger actually travels.
 *
 * A booking has always carried its trip's `departureDate` — the day the train
 * left its *origin*. For anyone boarding at the origin those are the same day,
 * so nothing looked wrong. For anyone joining an overnight service after
 * midnight they are not: a train leaving Dhaka at 22:00 on the 17th calls at
 * Bangabandhu Setu at 00:08 on the 18th, and a ticket for that leg was printing
 * the 17th.
 *
 * A wrong date on a ticket sends someone to a station on the wrong night, which
 * is about the worst thing a ticket can do.
 *
 * Stored rather than derived, for the same reason the seat number and coach
 * code are copied onto a ticket at purchase: what was sold should not change
 * because a timetable was edited afterwards.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("bookings", "boarding_date", {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });

    await queryInterface.addColumn("bookings", "arrival_date", {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });

    /*
     * Backfill from the timetable. Every existing booking has a trip and an
     * origin station, so the correct date is recoverable — there is no need to
     * leave history wrong just because the column is new.
     */
    await queryInterface.sequelize.query(`
      UPDATE bookings b
        JOIN trips t ON t.id = b.trip_id
        JOIN route_stops rs ON rs.train_id = t.train_id AND rs.station_id = b.from_station_id
      SET b.boarding_date = DATE_ADD(t.departure_date, INTERVAL rs.day_offset DAY)
      WHERE b.boarding_date IS NULL
    `);

    await queryInterface.sequelize.query(`
      UPDATE bookings b
        JOIN trips t ON t.id = b.trip_id
        JOIN route_stops rs ON rs.train_id = t.train_id AND rs.station_id = b.to_station_id
      SET b.arrival_date = DATE_ADD(t.departure_date, INTERVAL rs.day_offset DAY)
      WHERE b.arrival_date IS NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("bookings", "arrival_date");
    await queryInterface.removeColumn("bookings", "boarding_date");
  },
};
