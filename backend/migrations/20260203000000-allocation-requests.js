"use strict";

/**
 * Seat Allocation requests, from the public page and from inside the app.
 *
 *   public_visits.channel      where a request came from: "public" (the
 *                              /seat-allocation page) or "app" (signed in,
 *                              inside the app). Every row so far is public.
 *   public_visit_days.channel  each day's totals, kept apart the same way —
 *                              the day and the channel are its key now.
 *
 * And the permission to analyse them — "allocation:requests", which shows
 * names and internet addresses — granted to the admin role where there is one
 * (the super admin holds every permission already).
 *
 * Undoing it deletes the app's requests (rows and day totals): the code
 * before this cannot tell them from the public page's, and would count them
 * against a visitor's free searches.
 */
const PERMISSION = {
  key: "allocation:requests",
  group_name: "Seat allocation",
  label: "See allocation requests",
  description:
    "Analyse who looks at the seat allocation — on the public page and in the app — and what they look for: " +
    "grouped by person, train, station, place, device or time, with names and internet addresses.",
};

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("public_visits", "channel", {
      type: Sequelize.STRING(10),
      allowNull: false,
      defaultValue: "public",
      after: "outcome",
    });
    await queryInterface.addIndex("public_visits", ["channel", "created_at"], { name: "public_visits_by_channel" });

    await queryInterface.sequelize.query(
      "ALTER TABLE public_visit_days ADD COLUMN channel VARCHAR(10) NOT NULL DEFAULT 'public' AFTER day, " +
        "DROP PRIMARY KEY, ADD PRIMARY KEY (day, channel)"
    );

    const now = new Date();
    await queryInterface.bulkInsert("permissions", [{ ...PERMISSION, created_at: now, updated_at: now }], {
      ignoreDuplicates: true,
    });
    const [[permission]] = await queryInterface.sequelize.query("SELECT id FROM permissions WHERE `key` = ?", {
      replacements: [PERMISSION.key],
    });
    const [[admin]] = await queryInterface.sequelize.query("SELECT id FROM roles WHERE name = 'admin'");
    if (permission && admin) {
      await queryInterface.bulkInsert(
        "role_permissions",
        [{ role_id: admin.id, permission_id: permission.id, created_at: now, updated_at: now }],
        { ignoreDuplicates: true }
      );
    }
  },

  async down(queryInterface) {
    const [[permission]] = await queryInterface.sequelize.query("SELECT id FROM permissions WHERE `key` = ?", {
      replacements: [PERMISSION.key],
    });
    if (permission) {
      await queryInterface.sequelize.query("DELETE FROM role_permissions WHERE permission_id = ?", {
        replacements: [permission.id],
      });
      await queryInterface.sequelize.query("DELETE FROM permissions WHERE id = ?", { replacements: [permission.id] });
    }

    await queryInterface.sequelize.query("DELETE FROM public_visit_days WHERE channel <> 'public'");
    await queryInterface.sequelize.query(
      "ALTER TABLE public_visit_days DROP PRIMARY KEY, DROP COLUMN channel, ADD PRIMARY KEY (day)"
    );
    await queryInterface.sequelize.query("DELETE FROM public_visits WHERE channel <> 'public'");
    await queryInterface.removeIndex("public_visits", "public_visits_by_channel");
    await queryInterface.removeColumn("public_visits", "channel");
  },
};
