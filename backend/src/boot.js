const { sequelize } = require("./models");
const { connectMongo } = require("./config/mongo");
const { loadSettings } = require("./services/settingService");
const { syncPermissionCatalogue } = require("./services/permissionService");

/**
 * Everything the API needs before it can answer a request, in order.
 *
 * Shared by the server and the integration tests, so the tests start the app
 * exactly the way production does rather than through a second, drifting copy
 * of these steps.
 */
async function boot({ log = console.log } = {}) {
  await sequelize.authenticate();
  log("✅ Database connection established");

  // Schema is managed by migrations (npm run migrate) — no sync() here, so
  // the database shape is explicit, versioned, and identical across envs.

  /*
   * The permission catalogue lives in code, so the database follows it.
   *
   * It used to be reconciled only by a seeder, which meant a permission added
   * in code existed nowhere a role could be granted it — and because granting
   * an unknown key is silently ignored, the grant appeared to succeed and the
   * new endpoint stayed locked to everyone. Doing it here makes deploying the
   * code enough. Idempotent: an upsert per entry, and it only removes keys the
   * code no longer defines.
   */
  const { synced, removed } = await syncPermissionCatalogue();
  log(`✅ Permission catalogue synced (${synced} permissions${removed ? `, ${removed} retired` : ""})`);

  // Runtime-configurable values are read on hot paths, so they are cached in
  // memory once here rather than queried per request.
  const count = await loadSettings();
  log(`✅ Settings loaded (${count} values)`);

  // Connect MongoDB for document features (non-fatal if unavailable).
  await connectMongo();
}

module.exports = { boot };
