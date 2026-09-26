"use strict";

/**
 * Phase 6A — returned tickets and the approval queue.
 *
 * Additive, per §16.3: three new tables and one new ticket status value.
 * Nothing existing is altered destructively, so this migration can be rolled
 * back without losing a sale.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    };

    /* ---------------- Approval queue ---------------- */

    await queryInterface.createTable("approval_requests", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      reference: { type: Sequelize.STRING(20), allowNull: false, unique: true },

      type: {
        type: Sequelize.ENUM("ticket_transfer", "wallet_withdrawal", "abuse_review"),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM("pending", "approved", "rejected", "cancelled"),
        allowNull: false,
        defaultValue: "pending",
      },

      // Deliberately not a foreign key: one queue serves several subject kinds.
      subject_type: { type: Sequelize.STRING(40), allowNull: false },
      subject_id: { type: Sequelize.STRING(64), allowNull: false },
      subject_label: { type: Sequelize.STRING(200), allowNull: true },

      requested_by_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      reason: { type: Sequelize.STRING(500), allowNull: true },
      payload: { type: Sequelize.JSON, allowNull: true },

      decided_by_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      decided_at: { type: Sequelize.DATE, allowNull: true },
      decision_note: { type: Sequelize.STRING(500), allowNull: true },

      ...timestamps,
    });

    await queryInterface.addIndex("approval_requests", ["type", "status", "created_at"], {
      name: "approval_requests_queue",
    });
    await queryInterface.addIndex("approval_requests", ["requested_by_id"], {
      name: "approval_requests_requester",
    });
    await queryInterface.addIndex("approval_requests", ["subject_type", "subject_id"], {
      name: "approval_requests_subject",
    });

    /* ---------------- Refunds ---------------- */

    await queryInterface.createTable("refunds", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      reference: { type: Sequelize.STRING(20), allowNull: false, unique: true },

      ticket_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "tickets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      booking_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "bookings", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },

      type: { type: Sequelize.STRING(20), allowNull: false },
      status: {
        type: Sequelize.ENUM("settled", "awaiting_resale", "partially_settled", "closed"),
        allowNull: false,
        defaultValue: "settled",
      },

      fare_minor: { type: Sequelize.BIGINT, allowNull: false },
      deduction_percent: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      refunded_minor: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      maximum_minor: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },

      closed_at: { type: Sequelize.DATE, allowNull: true },
      note: { type: Sequelize.STRING(500), allowNull: true },

      ...timestamps,
    });

    // One refund per ticket: a ticket already returned cannot be returned again,
    // and the constraint says so rather than the service hoping so.
    await queryInterface.addIndex("refunds", ["ticket_id"], {
      unique: true,
      name: "refunds_ticket_unique",
    });
    await queryInterface.addIndex("refunds", ["user_id", "created_at"], { name: "refunds_user" });
    await queryInterface.addIndex("refunds", ["booking_id"], { name: "refunds_booking" });
    await queryInterface.addIndex("refunds", ["status"], { name: "refunds_status" });

    /* ---------------- Refund segments ---------------- */

    await queryInterface.createTable("refund_segments", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },

      refund_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "refunds", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      trip_seat_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "trip_seats", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      segment_index: { type: Sequelize.INTEGER, allowNull: false },

      share_minor: { type: Sequelize.BIGINT, allowNull: false },
      refund_minor: { type: Sequelize.BIGINT, allowNull: false },

      resold_at: { type: Sequelize.DATE, allowNull: true },
      resold_ticket_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "tickets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      settled_at: { type: Sequelize.DATE, allowNull: true },

      ...timestamps,
    });

    await queryInterface.addIndex("refund_segments", ["refund_id"], {
      name: "refund_segments_refund",
    });
    // The lookup every sale performs: is anyone waiting on this exact space?
    await queryInterface.addIndex(
      "refund_segments",
      ["trip_seat_id", "segment_index", "settled_at"],
      { name: "refund_segments_watch" }
    );

    /* ---------------- Ticket status ---------------- */

    // `refunded` and `transferred` join the existing three. Widening an ENUM
    // keeps every row that already exists valid, which is what makes this
    // additive — no ticket sold under the old set becomes unreadable.
    await queryInterface.changeColumn("tickets", "status", {
      type: Sequelize.ENUM("valid", "cancelled", "used", "refunded", "transferred"),
      allowNull: false,
      defaultValue: "valid",
    });
  },

  async down(queryInterface, Sequelize) {
    // Narrowing back would break any ticket already refunded or transferred, so
    // those are returned to `cancelled` first — the closest surviving meaning.
    await queryInterface.sequelize.query(
      "UPDATE tickets SET status = 'cancelled' WHERE status IN ('refunded', 'transferred')"
    );
    await queryInterface.changeColumn("tickets", "status", {
      type: Sequelize.ENUM("valid", "cancelled", "used"),
      allowNull: false,
      defaultValue: "valid",
    });

    await queryInterface.dropTable("refund_segments");
    await queryInterface.dropTable("refunds");
    await queryInterface.dropTable("approval_requests");
  },
};
