"use strict";

/**
 * Connecting standing tickets (§10).
 *
 * A passenger who could only get a seat for part of their journey may buy
 * standing for the rest of it, on the same train, abutting the seated leg.
 * Without that they abandon the booking or ride unticketed, and neither serves
 * anybody.
 *
 * ## Why a standing ticket is a ticket
 *
 * It could have been its own table. Making it a row in `tickets` instead means
 * ticket numbers, the signed QR, the PDF, the status lifecycle, refunds and
 * payment all work on it unchanged — a standing ticket is checked on a train by
 * the same person doing the same thing. What it lacks is a seat, so
 * `trip_seat_id` becomes nullable and `kind` says which sort it is.
 *
 * ## Why capacity is not a segment row
 *
 * A seat is exclusive: one ticket per seat-segment, enforced by a unique index.
 * Standing is a *quantity* — twenty people may stand in a coach — so there is
 * nothing to be unique about. Capacity is counted and checked under a lock on
 * the coach instead, which is what `standingService` does.
 *
 * Additive throughout: existing tickets get `kind = 'seated'` and keep their
 * seat, and every coach class starts at zero standing capacity, so nothing
 * begins selling standing by accident.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    /* ---------------- Capacity, per class ---------------- */

    await queryInterface.addColumn("coach_classes", "standing_capacity", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });

    /*
     * Zero by default on purpose. Standing room in an air-conditioned cabin is
     * not a thing, and a migration that quietly made every class sellable
     * standing would be a commercial decision disguised as a schema change.
     * An administrator opts each class in.
     */

    /* ---------------- A ticket without a seat ---------------- */

    /*
     * Raw SQL rather than changeColumn: this column carries a foreign key, and
     * Sequelize's changeColumn quietly leaves the NOT NULL in place when it
     * tries to redefine one. MODIFY COLUMN changes only the nullability and
     * leaves the constraint alone, which is exactly what is wanted.
     */
    await queryInterface.sequelize.query("ALTER TABLE tickets MODIFY COLUMN trip_seat_id INT NULL");

    await queryInterface.changeColumn("tickets", "seat_number", {
      type: Sequelize.STRING(10),
      allowNull: true,
    });

    await queryInterface.addColumn("tickets", "kind", {
      type: Sequelize.ENUM("seated", "standing"),
      allowNull: false,
      defaultValue: "seated",
    });

    // Which seated ticket this standing leg accompanies. Standing is never sold
    // on its own, and refunding the seat takes its standing legs with it.
    await queryInterface.addColumn("tickets", "seated_ticket_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "tickets", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // Which coach the passenger stands in — capacity is counted per coach.
    await queryInterface.addColumn("tickets", "trip_coach_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "trip_coaches", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });

    // The stretch this ticket covers. A seated ticket takes it from its
    // booking; a standing leg has its own, which is not the booking's.
    await queryInterface.addColumn("tickets", "from_station_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "stations", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });
    await queryInterface.addColumn("tickets", "to_station_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "stations", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });

    // The segments it occupies, so capacity can be counted without re-deriving
    // the route on every check.
    await queryInterface.addColumn("tickets", "segments", {
      type: Sequelize.JSON,
      allowNull: true,
    });

    // The query every standing purchase runs: how many are already standing in
    // this coach.
    await queryInterface.addIndex("tickets", ["trip_coach_id", "kind", "status"], {
      name: "tickets_standing_capacity",
    });
    await queryInterface.addIndex("tickets", ["seated_ticket_id"], {
      name: "tickets_seated_parent",
    });

    /* ---------------- Backfill ---------------- */

    // Every ticket that already exists is a seated one, and its stretch is its
    // booking's. Filling it in now means the new columns are usable everywhere
    // rather than only on tickets sold from today.
    await queryInterface.sequelize.query(`
      UPDATE tickets t
        JOIN bookings b ON b.id = t.booking_id
      SET t.from_station_id = b.from_station_id,
          t.to_station_id   = b.to_station_id
      WHERE t.from_station_id IS NULL
    `);
  },

  async down(queryInterface, Sequelize) {
    // Standing tickets cannot survive a schema without standing.
    await queryInterface.sequelize.query("DELETE FROM tickets WHERE kind = 'standing'");

    await queryInterface.removeIndex("tickets", "tickets_seated_parent");
    await queryInterface.removeIndex("tickets", "tickets_standing_capacity");

    for (const column of [
      "segments",
      "to_station_id",
      "from_station_id",
      "trip_coach_id",
      "seated_ticket_id",
      "kind",
    ]) {
      await queryInterface.removeColumn("tickets", column);
    }

    await queryInterface.changeColumn("tickets", "seat_number", {
      type: Sequelize.STRING(10),
      allowNull: false,
    });
    await queryInterface.sequelize.query("ALTER TABLE tickets MODIFY COLUMN trip_seat_id INT NOT NULL");

    await queryInterface.removeColumn("coach_classes", "standing_capacity");
  },
};
