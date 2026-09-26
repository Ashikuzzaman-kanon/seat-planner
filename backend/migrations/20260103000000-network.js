"use strict";

/**
 * The network: stations, richer trains, routes, the fare rule chain, and the
 * seat attribute catalogue.
 *
 * Strictly additive, per the convention in REQUIREMENTS §16.3. `train_names`
 * gains columns rather than being renamed to `trains` — a rename would be a
 * destructive change for no functional gain, and seventeen files reference it
 * by its current association alias.
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

    // ---------- Trains gain an identity ----------
    // Bangladesh Railway numbers each direction separately (Madhumati runs as
    // 755 up and 756 down), so both codes are recorded.
    await queryInterface.addColumn("train_names", "code", {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
    await queryInterface.addColumn("train_names", "up_code", {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
    await queryInterface.addColumn("train_names", "down_code", {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
    await queryInterface.addColumn("train_names", "notes", {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addColumn("train_names", "is_active", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });

    // ---------- Stations ----------
    await queryInterface.createTable("stations", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      code: { type: Sequelize.STRING(10), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(100), allowNull: false, unique: true },
      district: { type: Sequelize.STRING(100), allowNull: true },
      // Retiring a station hides it from new routes without orphaning history.
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
    });

    // ---------- Routes ----------
    await queryInterface.createTable("route_stops", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      train_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("train_names", "CASCADE") },
      station_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("stations") },
      sequence: { type: Sequelize.INTEGER, allowNull: false },
      // Null at the origin (nothing arrives) and the terminus (nothing departs).
      arrival_time: { type: Sequelize.TIME, allowNull: true },
      departure_time: { type: Sequelize.TIME, allowNull: true },
      // Days after the origin's departure date — what makes overnight trains work.
      day_offset: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      // Cumulative kilometres from the origin.
      distance_km: { type: Sequelize.DECIMAL(8, 2), allowNull: true },
      halt_minutes: { type: Sequelize.INTEGER, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addConstraint("route_stops", {
      fields: ["train_id", "sequence"],
      type: "unique",
      name: "route_stops_train_id_sequence_unique",
    });
    await queryInterface.addConstraint("route_stops", {
      fields: ["train_id", "station_id"],
      type: "unique",
      name: "route_stops_train_id_station_id_unique",
    });

    // ---------- Fare rule chain ----------
    await queryInterface.createTable("fare_rules", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      name: { type: Sequelize.STRING(120), allowNull: false },
      kind: { type: Sequelize.ENUM("table", "distance"), allowNull: false },
      // Lower runs first; the first rule that produces an amount wins.
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 100 },
      // Null = applies to every train.
      train_id: { type: Sequelize.INTEGER, allowNull: true, ...fk("train_names", "CASCADE") },
      coach_class_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("coach_classes") },
      // `distance` rules only.
      rate_per_km: { type: Sequelize.DECIMAL(8, 4), allowNull: true },
      min_fare: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
    });
    await queryInterface.addIndex("fare_rules", ["coach_class_id", "priority"]);

    await queryInterface.createTable("fare_table_entries", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      fare_rule_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("fare_rules", "CASCADE") },
      from_station_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("stations") },
      to_station_id: { type: Sequelize.INTEGER, allowNull: false, ...fk("stations") },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      ...timestamps,
    });
    await queryInterface.addConstraint("fare_table_entries", {
      fields: ["fare_rule_id", "from_station_id", "to_station_id"],
      type: "unique",
      name: "fare_table_entries_rule_from_to_unique",
    });

    // ---------- Seat attribute catalogue ----------
    await queryInterface.createTable("seat_attributes", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      key: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      label: { type: Sequelize.STRING(100), allowNull: false },
      description: { type: Sequelize.STRING(300), allowNull: true },
      value_type: {
        type: Sequelize.ENUM("boolean", "enum"),
        allowNull: false,
        defaultValue: "boolean",
      },
      options: { type: Sequelize.JSON, allowNull: true },
      icon: { type: Sequelize.STRING(60), allowNull: true },
      is_filterable: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 100 },
      ...timestamps,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("seat_attributes");
    await queryInterface.dropTable("fare_table_entries");
    await queryInterface.dropTable("fare_rules");
    await queryInterface.dropTable("route_stops");
    await queryInterface.dropTable("stations");

    for (const column of ["code", "up_code", "down_code", "notes", "is_active"]) {
      await queryInterface.removeColumn("train_names", column);
    }
  },
};
