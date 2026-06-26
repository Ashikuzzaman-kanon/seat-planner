"use strict";

/**
 * Initial schema: users, the three reference tables, and seat_plans.
 * Mirrors the current Sequelize models. Tables are created in foreign-key
 * dependency order (referenced tables first).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    };

    await queryInterface.createTable("users", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      full_name: { type: Sequelize.STRING, allowNull: false },
      email: { type: Sequelize.STRING, allowNull: false, unique: true },
      password_hash: { type: Sequelize.STRING, allowNull: false },
      role: {
        type: Sequelize.ENUM("user", "planner", "admin", "super_admin"),
        allowNull: false,
        defaultValue: "user",
      },
      is_verified: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      verification_code: { type: Sequelize.STRING, allowNull: true },
      verification_code_expires: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    });

    // The three lookup tables share an identical shape.
    for (const table of ["train_names", "coach_types", "coach_classes"]) {
      await queryInterface.createTable(table, {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        name: { type: Sequelize.STRING, allowNull: false, unique: true },
        ...timestamps,
      });
    }

    await queryInterface.createTable("seat_plans", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      coach_no: { type: Sequelize.STRING, allowNull: false },
      status: {
        type: Sequelize.ENUM("draft", "pending", "approved", "rejected"),
        allowNull: false,
        defaultValue: "draft",
      },
      rejection_reason: { type: Sequelize.TEXT, allowNull: true },
      layout: { type: Sequelize.JSON, allowNull: false },
      approved_at: { type: Sequelize.DATE, allowNull: true },
      train_name_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: "train_names", key: "id" },
        onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      coach_type_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: "coach_types", key: "id" },
        onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      coach_class_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: "coach_classes", key: "id" },
        onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      created_by_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      approved_by_id: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE", onDelete: "SET NULL",
      },
      ...timestamps,
    });
  },

  async down(queryInterface) {
    // Reverse order: drop the table with foreign keys first.
    await queryInterface.dropTable("seat_plans");
    await queryInterface.dropTable("coach_classes");
    await queryInterface.dropTable("coach_types");
    await queryInterface.dropTable("train_names");
    await queryInterface.dropTable("users");
  },
};
