"use strict";

/**
 * App-version rules move from platforms to subscriptions.
 *
 * Each subscription now has its own rules for each platform, so one version of
 * an app can be fine for one subscription and too old for another.
 *
 *   subscription_version_rules   one row per subscription and platform that
 *                                has rules: whether a check must say its
 *                                version, and the oldest version accepted.
 *   subscription_version_blocks  single versions a rule turns away whatever
 *                                its minimum says. Each belongs to a rule, and
 *                                goes with it.
 *
 * Gone: `subscription_platforms.version_required` and `min_version`, and
 * `subscription_blocked_versions`. Any rule already set on a platform is first
 * copied onto every subscription for that platform, so nothing that was turned
 * away before is let through after.
 *
 * Down puts the platform columns and table back. A platform gets its rules
 * back only where every subscription has the same ones for it — exactly what
 * up leaves behind — since rules that differ between subscriptions have no
 * single platform-wide form.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    };
    const parent = (model) => ({
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model, key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });

    await queryInterface.createTable("subscription_version_rules", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      subscription_id: parent("subscriptions"),
      platform_id: parent("subscription_platforms"),
      version_required: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      min_version: { type: Sequelize.STRING(40), allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex("subscription_version_rules", ["subscription_id", "platform_id"], {
      unique: true,
      name: "subscription_version_rules_one_each",
    });

    await queryInterface.createTable("subscription_version_blocks", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      rule_id: parent("subscription_version_rules"),
      version: { type: Sequelize.STRING(40), allowNull: false },
      note: { type: Sequelize.STRING(200), allowNull: true },
      created_by_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      ...timestamps,
    });
    await queryInterface.addIndex("subscription_version_blocks", ["rule_id", "version"], {
      unique: true,
      name: "subscription_version_blocks_one_each",
    });

    // Every subscription takes on the rules of each platform that had any.
    await queryInterface.sequelize.query(
      `INSERT INTO subscription_version_rules (subscription_id, platform_id, version_required, min_version, created_at, updated_at)
       SELECT s.id, p.id, p.version_required, p.min_version, UTC_TIMESTAMP(), UTC_TIMESTAMP()
       FROM subscriptions s CROSS JOIN subscription_platforms p
       WHERE p.version_required = 1 OR p.min_version IS NOT NULL
          OR EXISTS (SELECT 1 FROM subscription_blocked_versions b WHERE b.platform_id = p.id)`
    );
    await queryInterface.sequelize.query(
      `INSERT INTO subscription_version_blocks (rule_id, version, note, created_by_id, created_at, updated_at)
       SELECT r.id, b.version, b.note, b.created_by_id, b.created_at, b.updated_at
       FROM subscription_blocked_versions b JOIN subscription_version_rules r ON r.platform_id = b.platform_id`
    );

    await queryInterface.dropTable("subscription_blocked_versions");
    await queryInterface.removeColumn("subscription_platforms", "min_version");
    await queryInterface.removeColumn("subscription_platforms", "version_required");
  },

  async down(queryInterface, Sequelize) {
    const select = (sql) => queryInterface.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT });

    await queryInterface.addColumn("subscription_platforms", "version_required", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn("subscription_platforms", "min_version", { type: Sequelize.STRING(40), allowNull: true });
    await queryInterface.createTable("subscription_blocked_versions", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      platform_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "subscription_platforms", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      version: { type: Sequelize.STRING(40), allowNull: false },
      note: { type: Sequelize.STRING(200), allowNull: true },
      created_by_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("subscription_blocked_versions", ["platform_id", "version"], {
      unique: true,
      name: "subscription_blocked_versions_one_each",
    });

    const [{ count: subscriptions }] = await select("SELECT COUNT(*) AS count FROM subscriptions");
    const rules = await select("SELECT id, platform_id, version_required, min_version FROM subscription_version_rules");
    const blocks = await select("SELECT rule_id, version, note, created_by_id, created_at, updated_at FROM subscription_version_blocks");

    const byPlatform = new Map();
    for (const rule of rules) {
      const blocked = blocks.filter((b) => b.rule_id === rule.id);
      const shape = JSON.stringify([Boolean(rule.version_required), rule.min_version, blocked.map((b) => b.version).sort()]);
      if (!byPlatform.has(rule.platform_id)) byPlatform.set(rule.platform_id, []);
      byPlatform.get(rule.platform_id).push({ shape, rule, blocked });
    }
    for (const [platformId, held] of byPlatform) {
      // Only rules every subscription shares have a platform-wide form.
      if (held.length !== Number(subscriptions) || new Set(held.map((h) => h.shape)).size !== 1) continue;
      const { rule, blocked } = held[0];
      await queryInterface.bulkUpdate(
        "subscription_platforms",
        { version_required: Boolean(rule.version_required), min_version: rule.min_version },
        { id: platformId }
      );
      if (blocked.length) {
        await queryInterface.bulkInsert(
          "subscription_blocked_versions",
          blocked.map((b) => ({
            platform_id: platformId,
            version: b.version,
            note: b.note,
            created_by_id: b.created_by_id,
            created_at: b.created_at,
            updated_at: b.updated_at,
          }))
        );
      }
    }

    await queryInterface.dropTable("subscription_version_blocks");
    await queryInterface.dropTable("subscription_version_rules");
  },
};
