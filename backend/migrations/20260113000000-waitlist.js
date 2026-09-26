"use strict";

/**
 * The waitlist (§12).
 *
 * When a segment is full, passengers queue. A return or an abandoned checkout
 * auto-offers the freed seat to whoever is next, who confirms in one click from
 * wallet credit.
 *
 * ## Why this table exists at all
 *
 * The demand-based return (§11.2) pays out only if the seat resells before the
 * train leaves. Without a queue, resale depends on someone happening to search
 * for that exact stretch in the window between the return and the departure —
 * which makes the whole policy a lottery. The waitlist is what turns "might
 * resell" into "resells within seconds of coming back", and so is what makes
 * the elegant refund policy an honest offer rather than a trap.
 *
 * ## Why the passengers are stored here
 *
 * Confirmation has to be one click, and a click cannot carry a name, an NID and
 * a date of birth for each seat. So they are captured when someone joins the
 * queue — a moment with no time pressure — and the offer is then answerable
 * with a single yes. Collecting them at the offer instead would mean asking for
 * paperwork at the one moment that is genuinely time-critical.
 *
 * ## Why there is no stored position
 *
 * Queue order is join order, and position is a count of the open rows ahead.
 * Storing it would mean renumbering every entry behind anyone who leaves, for a
 * number that is cheap to derive and only ever displayed.
 *
 * Wholly additive: a new table and nothing touched.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("waitlist_entries", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },

      reference: { type: Sequelize.STRING(40), allowNull: false, unique: true },

      trip_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "trips", key: "id" },
        onDelete: "CASCADE",
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },

      from_station_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "stations", key: "id" },
      },
      to_station_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "stations", key: "id" },
      },

      seat_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },

      // Optional: narrows what counts as a match, rather than being required.
      coach_class_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "coach_classes", key: "id" },
      },

      passengers: { type: Sequelize.JSON, allowNull: false },

      status: {
        type: Sequelize.ENUM(
          "waiting",
          "offered",
          "confirmed",
          "declined",
          "lapsed",
          "withdrawn",
          "closed"
        ),
        allowNull: false,
        defaultValue: "waiting",
      },

      // The hold standing in their name while an offer is open. Nulled when the
      // offer closes, so a stale hold is never mistaken for a live one.
      hold_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "seat_holds", key: "id" },
        onDelete: "SET NULL",
      },
      offer_expires_at: { type: Sequelize.DATE, allowNull: true },

      offers_made: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },

      booking_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "bookings", key: "id" },
        onDelete: "SET NULL",
      },

      closed_at: { type: Sequelize.DATE, allowNull: true },
      note: { type: Sequelize.STRING(255), allowNull: true },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // Serving one departure's queue, oldest first — the hot path when a seat
    // comes back and the sweep has to find who is next.
    await queryInterface.addIndex("waitlist_entries", ["trip_id", "status", "id"], {
      name: "waitlist_trip_status_idx",
    });
    await queryInterface.addIndex("waitlist_entries", ["user_id", "status"], {
      name: "waitlist_user_status_idx",
    });
    // The job that closes unanswered offers scans on exactly this.
    await queryInterface.addIndex("waitlist_entries", ["status", "offer_expires_at"], {
      name: "waitlist_offer_expiry_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("waitlist_entries");
  },
};
