"use strict";

/**
 * Seat allocation: which station pairs the railway actually sets seats aside
 * for, train by train and class by class, as found by scanning the railway's
 * own booking site.
 *
 * Kept apart from everything the site books on. These tables name trains by
 * the railway's number, stations by the railway's name and classes by the
 * railway's code, as text; nothing here points at the site's trains, stations,
 * coach classes, seat plans or quota rules, and loading or syncing railway
 * data, demo data and the clean-ups never touch them.
 *
 *   allocation_trains    each railway train: its name and, once a route file
 *                        is uploaded, its stations in order (to lay pairs out
 *                        in travel order).
 *   allocation_pairs     one train and one from → to pair the railway was
 *                        checked for: allocated or not, and when. A pair with
 *                        no row has not been checked.
 *   allocation_classes   for an allocated pair, each class with seats, and how
 *                        many — `seats` NULL while the count is not known,
 *                        which is not the same as 0.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const user = {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "users", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    };

    await queryInterface.createTable("allocation_trains", {
      number: { type: Sequelize.INTEGER, primaryKey: true },
      name: { type: Sequelize.STRING(120), allowNull: false },
      stops: { type: Sequelize.JSON, allowNull: true },
      stops_updated_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable("allocation_pairs", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      train_number: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "allocation_trains", key: "number" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      from_station: { type: Sequelize.STRING(100), allowNull: false },
      to_station: { type: Sequelize.STRING(100), allowNull: false },
      status: { type: Sequelize.STRING(20), allowNull: false },
      checked_at: { type: Sequelize.DATE, allowNull: true },
      source: { type: Sequelize.STRING(20), allowNull: false },
      updated_by_id: user,
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("allocation_pairs", ["train_number", "from_station", "to_station"], {
      unique: true,
      name: "allocation_pairs_key",
    });

    await queryInterface.createTable("allocation_classes", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      pair_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "allocation_pairs", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      class_code: { type: Sequelize.STRING(20), allowNull: false },
      seats: { type: Sequelize.INTEGER, allowNull: true },
      updated_by_id: user,
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("allocation_classes", ["pair_id", "class_code"], {
      unique: true,
      name: "allocation_classes_key",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("allocation_classes");
    await queryInterface.dropTable("allocation_pairs");
    await queryInterface.dropTable("allocation_trains");
  },
};
