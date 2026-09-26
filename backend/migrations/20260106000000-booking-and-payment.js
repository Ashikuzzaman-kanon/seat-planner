"use strict";

/**
 * Wallet, seat holds, bookings, tickets and payments.
 *
 * Every amount is stored in **minor units** (poisha) as an integer. Floating
 * point cannot represent 0.1 exactly, so a ledger built on DECIMAL-to-float
 * arithmetic drifts a fraction of a paisa at a time until the books stop
 * balancing. Fares stay DECIMAL because they are configuration someone types;
 * they convert to minor units at the boundary.
 *
 * Additive, per REQUIREMENTS §16.3.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    };

    const fk = (table, onDelete = "RESTRICT") => ({
      references: { model: table, key: "id" },
      onUpdate: "CASCADE",
      onDelete,
    });

    // ---------- Wallet ----------
    await queryInterface.createTable("wallets", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: { type: Sequelize.INTEGER, allowNull: false, unique: true, ...fk("users", "CASCADE") },
      // A cache of the ledger below, only ever written under a row lock in the
      // same transaction that appends an entry.
      balance_minor: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: "BDT" },
      status: { type: Sequelize.ENUM("active", "frozen"), allowNull: false, defaultValue: "active" },
      ...timestamps,
    });

    // Append-only. Nothing here is ever updated or deleted — a mistake is
    // corrected by appending a compensating entry.
    await queryInterface.createTable("wallet_transactions", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      wallet_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("wallets", "CASCADE") },
      direction: { type: Sequelize.ENUM("credit", "debit"), allowNull: false },
      // Always positive; `direction` carries the sign.
      amount_minor: { type: Sequelize.BIGINT, allowNull: false },
      balance_after_minor: { type: Sequelize.BIGINT, allowNull: false },
      reason: {
        type: Sequelize.ENUM("topup", "booking", "refund", "withdrawal", "adjustment"),
        allowNull: false,
      },
      reference_type: { type: Sequelize.STRING(40), allowNull: true },
      reference_id: { type: Sequelize.STRING(60), allowNull: true },
      description: { type: Sequelize.STRING(300), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("wallet_transactions", ["wallet_id", "created_at"]);
    await queryInterface.addIndex("wallet_transactions", ["reference_type", "reference_id"]);

    // ---------- Seat holds ----------
    await queryInterface.createTable("seat_holds", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      reference: { type: Sequelize.STRING(40), allowNull: false, unique: true },
      trip_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("trips", "CASCADE") },
      user_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("users", "CASCADE") },
      from_station_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("stations") },
      to_station_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("stations") },
      seat_ids: { type: Sequelize.JSON, allowNull: false },
      status: {
        type: Sequelize.ENUM("active", "converted", "expired", "released"),
        allowNull: false,
        defaultValue: "active",
      },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      ...timestamps,
    });
    // The expiry job scans on exactly this pair.
    await queryInterface.addIndex("seat_holds", ["status", "expires_at"]);
    await queryInterface.addIndex("seat_holds", ["user_id"]);
    await queryInterface.addIndex("seat_holds", ["trip_id"]);

    // ---------- Bookings ----------
    await queryInterface.createTable("bookings", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      // The PNR a passenger quotes.
      reference: { type: Sequelize.STRING(12), allowNull: false, unique: true },
      user_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("users") },
      trip_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("trips") },
      from_station_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("stations") },
      to_station_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("stations") },
      status: {
        type: Sequelize.ENUM("confirmed", "cancelled", "refunded"),
        allowNull: false,
        defaultValue: "confirmed",
      },
      total_minor: { type: Sequelize.BIGINT, allowNull: false },
      ticket_count: { type: Sequelize.INTEGER, allowNull: false },
      ...timestamps,
    });
    await queryInterface.addIndex("bookings", ["user_id", "created_at"]);
    await queryInterface.addIndex("bookings", ["trip_id"]);

    await queryInterface.createTable("tickets", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      booking_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("bookings", "CASCADE") },
      ticket_number: { type: Sequelize.STRING(20), allowNull: false, unique: true },
      trip_seat_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("trip_seats") },
      // Copied at purchase: a seat plan can be rebuilt, but what the passenger
      // was sold must not change underneath them.
      seat_number: { type: Sequelize.STRING(10), allowNull: false },
      coach_code: { type: Sequelize.STRING(10), allowNull: false },
      coach_class_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("coach_classes") },
      passenger_name: { type: Sequelize.STRING(120), allowNull: false },
      passenger_nid: { type: Sequelize.STRING(20), allowNull: false },
      passenger_dob: { type: Sequelize.DATEONLY, allowNull: false },
      fare_minor: { type: Sequelize.BIGINT, allowNull: false },
      status: {
        type: Sequelize.ENUM("valid", "cancelled", "used"),
        allowNull: false,
        defaultValue: "valid",
      },
      ...timestamps,
    });
    await queryInterface.addIndex("tickets", ["booking_id"]);
    await queryInterface.addIndex("tickets", ["trip_seat_id"]);
    await queryInterface.addIndex("tickets", ["passenger_nid"]);

    // ---------- Payments ----------
    // One row per source, so wallet-plus-gateway is two rows and a new provider
    // never disturbs the ones already there.
    await queryInterface.createTable("payments", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      booking_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("bookings", "CASCADE") },
      provider: { type: Sequelize.ENUM("wallet", "gateway"), allowNull: false },
      amount_minor: { type: Sequelize.BIGINT, allowNull: false },
      status: {
        type: Sequelize.ENUM("captured", "failed", "refunded"),
        allowNull: false,
        defaultValue: "captured",
      },
      reference: { type: Sequelize.STRING(80), allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex("payments", ["booking_id"]);

    // ---------- Link inventory rows back to what bought them ----------
    await queryInterface.addConstraint("seat_segment_bookings", {
      fields: ["ticket_id"],
      type: "foreign key",
      name: "seat_segment_bookings_ticket_fk",
      references: { table: "tickets", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });
    await queryInterface.addConstraint("seat_segment_bookings", {
      fields: ["hold_id"],
      type: "foreign key",
      name: "seat_segment_bookings_hold_fk",
      references: { table: "seat_holds", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint("seat_segment_bookings", "seat_segment_bookings_hold_fk");
    await queryInterface.removeConstraint("seat_segment_bookings", "seat_segment_bookings_ticket_fk");
    await queryInterface.dropTable("payments");
    await queryInterface.dropTable("tickets");
    await queryInterface.dropTable("bookings");
    await queryInterface.dropTable("seat_holds");
    await queryInterface.dropTable("wallet_transactions");
    await queryInterface.dropTable("wallets");
  },
};
