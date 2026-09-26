"use strict";

/**
 * Reporting a ticket, and holding an account (§14).
 *
 * ## Two tables, because they answer different questions
 *
 * A **report** is a checker's judgement about one ticket — the code verified,
 * the ticket is valid, and the person holding it is not the person on it. No
 * signature check catches that and no automatic verdict can; it takes somebody
 * looking at a face and a card. A report is a *signal*, never a penalty.
 *
 * A **hold** is the penalty, and it is deliberately far away from the signal.
 * The spec is explicit: scored signals feed a human review queue, and an
 * automatic hold happens only at a high threshold — always reversible, always
 * audited.
 *
 * ## Why holds are rows rather than a flag on the user
 *
 * "Always reversible" is satisfied by a boolean and made unsafe by one: a hold
 * placed, lifted and placed again leaves no trace, so nobody can answer "how
 * often, and who decided" — the first question asked when a hold turns out to
 * be wrong. An account is held when it has a row with no `released_at`.
 *
 * ## Why the report copies the user id
 *
 * A report against one ticket is an incident; several against tickets bought by
 * the same account is a pattern, and the pattern is what is worth acting on.
 * Copying `reported_user_id` at the time of the report keeps the signal
 * attached to the account even if the ticket is later transferred or refunded.
 *
 * Additive throughout: two new tables, nothing existing touched.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ticket_reports", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },

      reference: { type: Sequelize.STRING(40), allowNull: false, unique: true },

      ticket_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "tickets", key: "id" },
        onDelete: "SET NULL",
      },
      // Kept as text too, so a report survives its ticket going away.
      ticket_number: { type: Sequelize.STRING(20), allowNull: true },

      trip_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "trips", key: "id" },
        onDelete: "SET NULL",
      },

      // Copied, not joined — see the note above about transfers.
      reported_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },

      reported_by_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      station_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "stations", key: "id" },
      },

      kind: {
        type: Sequelize.ENUM(
          "identity_mismatch",
          "duplicate_in_use",
          "forgery",
          "beyond_journey",
          "other"
        ),
        allowNull: false,
      },

      // Required: a report with no account of what happened cannot be reviewed,
      // and an unreviewable report is noise in a score.
      detail: { type: Sequelize.STRING(1000), allowNull: false },

      status: {
        type: Sequelize.ENUM("open", "upheld", "dismissed"),
        allowNull: false,
        defaultValue: "open",
      },

      reviewed_by_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      reviewed_at: { type: Sequelize.DATE, allowNull: true },
      review_note: { type: Sequelize.STRING(500), allowNull: true },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex("ticket_reports", ["reported_user_id", "status"], {
      name: "ticket_reports_account_idx",
    });
    await queryInterface.addIndex("ticket_reports", ["status", "id"], {
      name: "ticket_reports_queue_idx",
    });
    await queryInterface.addIndex("ticket_reports", ["ticket_id"], {
      name: "ticket_reports_ticket_idx",
    });
    await queryInterface.addIndex("ticket_reports", ["trip_id"], {
      name: "ticket_reports_trip_idx",
    });

    await queryInterface.createTable("account_holds", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },

      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },

      reason: {
        type: Sequelize.ENUM("abuse_score", "review_decision", "manual"),
        allowNull: false,
      },
      // Said to the person, so a sentence rather than a code.
      detail: { type: Sequelize.STRING(500), allowNull: false },

      // Placed by the scorer rather than a person — deserves more scrutiny.
      automatic: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      score_at_hold: { type: Sequelize.INTEGER, allowNull: true },

      // Null when the scorer placed it; nobody is credited for arithmetic.
      placed_by_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
      },

      released_by_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      released_at: { type: Sequelize.DATE, allowNull: true },
      release_note: { type: Sequelize.STRING(500), allowNull: true },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    // "Is this account held" — asked whenever somebody tries to buy.
    await queryInterface.addIndex("account_holds", ["user_id", "released_at"], {
      name: "account_holds_active_idx",
    });
    await queryInterface.addIndex("account_holds", ["released_at"], {
      name: "account_holds_open_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("account_holds");
    await queryInterface.dropTable("ticket_reports");
  },
};
