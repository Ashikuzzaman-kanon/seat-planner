"use strict";

/**
 * Segment-level seat inventory — the core of the product.
 *
 * `seat_segment_bookings` holds one row per seat per occupied segment. The
 * unique constraint on (trip_seat_id, segment_index) is the concurrency
 * control: two simultaneous purchases of the same seat-segment cannot both
 * commit, and the loser rolls back on the constraint rather than on a lock the
 * application forgot to take.
 *
 * Additive, per REQUIREMENTS §16.3. Both new inventory tables carry `trip_id`
 * so Phase 9 can partition them by departure date.
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

    // ---------- The inventory itself ----------
    await queryInterface.createTable("seat_segment_bookings", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      trip_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("trips", "CASCADE") },
      trip_seat_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("trip_seats", "CASCADE") },
      // Zero-based: segment i spans route stop i to stop i+1.
      segment_index: { type: Sequelize.INTEGER, allowNull: false },
      source: {
        type: Sequelize.ENUM("ticket", "hold", "block"),
        allowNull: false,
        defaultValue: "ticket",
      },
      // Populated from Phase 5; nothing issues tickets or holds yet.
      ticket_id: { type: Sequelize.INTEGER, allowNull: true },
      hold_id: { type: Sequelize.INTEGER, allowNull: true },
      reason: { type: Sequelize.STRING(300), allowNull: true },
      ...timestamps,
    });

    // THE constraint. Not bookkeeping — this is what makes concurrent booking safe.
    await queryInterface.addConstraint("seat_segment_bookings", {
      fields: ["trip_seat_id", "segment_index"],
      type: "unique",
      name: "seat_segment_bookings_seat_segment_unique",
    });
    await queryInterface.addIndex("seat_segment_bookings", ["trip_id", "segment_index"]);

    // ---------- Standing distribution rules ----------
    await queryInterface.createTable("train_quota_rules", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      train_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("train_names", "CASCADE") },
      coach_class_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("coach_classes") },
      from_station_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("stations") },
      to_station_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("stations") },
      quantity: { type: Sequelize.INTEGER, allowNull: false },
      // Exact-pair matching would strand inventory without this release.
      release_hours_before: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 24 },
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 100 },
      effective_from: { type: Sequelize.DATEONLY, allowNull: true },
      effective_to: { type: Sequelize.DATEONLY, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
    });
    await queryInterface.addIndex("train_quota_rules", ["train_id", "priority"]);

    // ---------- Materialised onto each departure ----------
    await queryInterface.createTable("trip_seat_quotas", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      trip_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("trips", "CASCADE") },
      trip_seat_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("trip_seats", "CASCADE") },
      from_station_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("stations") },
      to_station_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("stations") },
      release_at: { type: Sequelize.DATE, allowNull: true },
      released_at: { type: Sequelize.DATE, allowNull: true },
      rule_id: { type: Sequelize.INTEGER, allowNull: true, ...fk("train_quota_rules", "SET NULL") },
      ...timestamps,
    });
    // A seat cannot be held for two station pairs at once.
    await queryInterface.addConstraint("trip_seat_quotas", {
      fields: ["trip_seat_id"],
      type: "unique",
      name: "trip_seat_quotas_seat_unique",
    });
    // The release job scans on exactly this pair of columns.
    await queryInterface.addIndex("trip_seat_quotas", ["release_at", "released_at"]);
    await queryInterface.addIndex("trip_seat_quotas", ["trip_id"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("trip_seat_quotas");
    await queryInterface.dropTable("train_quota_rules");
    await queryInterface.dropTable("seat_segment_bookings");
  },
};
