"use strict";

/**
 * Field operations: scanning a ticket (§14).
 *
 * ## Why a scan log rather than two columns on the ticket
 *
 * "Scanned at / scanned by" on `tickets` would answer the one question the
 * ticket itself needs and throw away everything else. The value is in the
 * attempts that were *refused*: a ticket presented twice is how a shared
 * screenshot shows up, a forged signature is somebody trying it on, and a real
 * ticket on the wrong train is either a confused passenger or a probe. None of
 * that has a ticket to hang off — a forged code names no ticket we hold — so it
 * needs a table of its own, and `ticket_id` is nullable for exactly that case.
 *
 * The ticket keeps its `used` status regardless: deriving "already scanned"
 * from this table would mean a query against an ever-growing log on every scan,
 * when the ticket row already knows.
 *
 * ## Why `scanned_at` and `synced_at` are different columns
 *
 * A checker on a moving train has no network. Their device verifies the
 * signature by itself, records the scan, and uploads later — so the time the
 * scan happened and the time it was written down can be hours apart, and only
 * the first is evidence of anything. `client_reference` is the device's own id,
 * unique so a sync retried after a dropped connection cannot double-record.
 *
 * Additive: a new table, and nothing existing is touched.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ticket_scans", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },

      // Nullable on purpose: a forged or unreadable code corresponds to no
      // ticket, and those are the attempts most worth keeping.
      ticket_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "tickets", key: "id" },
        onDelete: "SET NULL",
      },
      // Kept as text too, because a forged code still *claims* a number.
      ticket_number: { type: Sequelize.STRING(20), allowNull: true },

      trip_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "trips", key: "id" },
        onDelete: "SET NULL",
      },

      checked_by_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      station_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "stations", key: "id" },
      },

      verdict: {
        type: Sequelize.ENUM(
          "accepted",
          "checked",
          "already_used",
          "not_valid",
          "wrong_service",
          "forged",
          "unreadable",
          "unknown"
        ),
        allowNull: false,
      },

      scanned_at: { type: Sequelize.DATE, allowNull: false },
      synced_at: { type: Sequelize.DATE, allowNull: true },
      offline: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },

      client_reference: { type: Sequelize.STRING(64), allowNull: true, unique: true },

      note: { type: Sequelize.STRING(255), allowNull: true },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // The refusal message for a second scan has to name the first one.
    await queryInterface.addIndex("ticket_scans", ["ticket_id", "scanned_at"], {
      name: "ticket_scans_ticket_idx",
    });
    // Reconciling a service after it has run.
    await queryInterface.addIndex("ticket_scans", ["trip_id", "scanned_at"], {
      name: "ticket_scans_trip_idx",
    });
    // What one checker did on a shift.
    await queryInterface.addIndex("ticket_scans", ["checked_by_id", "scanned_at"], {
      name: "ticket_scans_checker_idx",
    });
    // Counting refusals, which feeds the abuse score.
    await queryInterface.addIndex("ticket_scans", ["verdict", "scanned_at"], {
      name: "ticket_scans_verdict_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ticket_scans");
  },
};
