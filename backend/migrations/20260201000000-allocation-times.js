"use strict";

/**
 * When the seat-allocation data was brought up to date, since the railway can
 * change its allocation at any time.
 *
 *   allocation_classes.seats_updated_at / seats_updated_by_id
 *                       when a seat count was last set or cleared, and by whom
 *                       — not touched when a census upload merely keeps the
 *                       class. Counts already typed in take their row's last
 *                       change as a start.
 *   allocation_uploads  every file applied: which kind (stops, census, counts),
 *                       its name, who uploaded it and when, what it changed,
 *                       and for a census the span of times the railway was
 *                       scanned. Kept here rather than only in the audit log,
 *                       which a deployment may not have.
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

    await queryInterface.addColumn("allocation_classes", "seats_updated_at", { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn("allocation_classes", "seats_updated_by_id", user);
    await queryInterface.sequelize.query(
      "UPDATE allocation_classes SET seats_updated_at = updated_at, seats_updated_by_id = updated_by_id WHERE seats IS NOT NULL"
    );

    await queryInterface.createTable("allocation_uploads", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      kind: { type: Sequelize.STRING(20), allowNull: false },
      file_name: { type: Sequelize.STRING(200), allowNull: true },
      summary: { type: Sequelize.JSON, allowNull: false },
      scanned_from: { type: Sequelize.DATE, allowNull: true },
      scanned_to: { type: Sequelize.DATE, allowNull: true },
      uploaded_by_id: user,
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("allocation_uploads", ["kind", "id"], { name: "allocation_uploads_by_kind" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("allocation_uploads");
    await queryInterface.removeColumn("allocation_classes", "seats_updated_by_id");
    await queryInterface.removeColumn("allocation_classes", "seats_updated_at");
  },
};
