"use strict";

/**
 * Composition, schedules, and the departures generated from them.
 *
 * `trips` is the object tickets will attach to. `trip_seats` is where each seat
 * plan's JSON layout gets flattened into one row per physical seat, because
 * availability is a relational question and a document cannot answer it
 * efficiently.
 *
 * Additive, per REQUIREMENTS §16.3. Both `trips` and `trip_seats` are keyed by
 * departure date so partitioning on it in Phase 9 stays possible.
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

    // ---------- Default composition ----------
    await queryInterface.createTable("train_coaches", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      train_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("train_names", "CASCADE") },
      seat_plan_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("seat_plans") },
      position: { type: Sequelize.INTEGER, allowNull: false },
      coach_code: { type: Sequelize.STRING(10), allowNull: false },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
    });
    await queryInterface.addConstraint("train_coaches", {
      fields: ["train_id", "position"],
      type: "unique",
      name: "train_coaches_train_position_unique",
    });
    await queryInterface.addConstraint("train_coaches", {
      fields: ["train_id", "coach_code"],
      type: "unique",
      name: "train_coaches_train_code_unique",
    });

    // ---------- Weekly schedule ----------
    await queryInterface.createTable("train_schedules", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      train_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("train_names", "CASCADE") },
      // JavaScript day numbers, 0 = Sunday.
      runs_on: { type: Sequelize.JSON, allowNull: false },
      effective_from: { type: Sequelize.DATEONLY, allowNull: true },
      effective_to: { type: Sequelize.DATEONLY, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
    });
    await queryInterface.addIndex("train_schedules", ["train_id"]);

    // ---------- Departures ----------
    await queryInterface.createTable("trips", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      train_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("train_names", "CASCADE") },
      // The date the train leaves its origin; later stops add their day offset.
      departure_date: { type: Sequelize.DATEONLY, allowNull: false },
      status: {
        type: Sequelize.ENUM("scheduled", "cancelled", "departed", "completed"),
        allowNull: false,
        defaultValue: "scheduled",
      },
      cancellation_reason: { type: Sequelize.STRING(500), allowNull: true },
      generated_at: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    });
    // This constraint is what makes generation idempotent.
    await queryInterface.addConstraint("trips", {
      fields: ["train_id", "departure_date"],
      type: "unique",
      name: "trips_train_departure_date_unique",
    });
    await queryInterface.addIndex("trips", ["departure_date"]);

    await queryInterface.createTable("trip_coaches", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      trip_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("trips", "CASCADE") },
      position: { type: Sequelize.INTEGER, allowNull: false },
      coach_code: { type: Sequelize.STRING(10), allowNull: false },
      seat_plan_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("seat_plans") },
      coach_class_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("coach_classes") },
      seat_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: {
        type: Sequelize.ENUM("active", "cancelled"),
        allowNull: false,
        defaultValue: "active",
      },
      ...timestamps,
    });
    await queryInterface.addConstraint("trip_coaches", {
      fields: ["trip_id", "coach_code"],
      type: "unique",
      name: "trip_coaches_trip_code_unique",
    });

    // ---------- Seats, flattened from the layout ----------
    await queryInterface.createTable("trip_seats", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      trip_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("trips", "CASCADE") },
      trip_coach_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("trip_coaches", "CASCADE") },
      coach_class_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("coach_classes") },
      seat_number: { type: Sequelize.STRING(10), allowNull: false },
      // Position in the plan, so a seat map can be redrawn from rows alone.
      row_index: { type: Sequelize.INTEGER, allowNull: false },
      cell_index: { type: Sequelize.INTEGER, allowNull: false },
      is_window: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      window_type: { type: Sequelize.STRING(10), allowNull: true },
      charging_port: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      fan: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      note: { type: Sequelize.STRING(300), allowNull: true },
      // Catalogue-driven features, so a new attribute needs no migration here.
      attributes: { type: Sequelize.JSON, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addConstraint("trip_seats", {
      fields: ["trip_coach_id", "seat_number"],
      type: "unique",
      name: "trip_seats_coach_seat_unique",
    });
    await queryInterface.addIndex("trip_seats", ["trip_id", "coach_class_id"]);
    await queryInterface.addIndex("trip_seats", ["trip_id", "is_window"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("trip_seats");
    await queryInterface.dropTable("trip_coaches");
    await queryInterface.dropTable("trips");
    await queryInterface.dropTable("train_schedules");
    await queryInterface.dropTable("train_coaches");
  },
};
