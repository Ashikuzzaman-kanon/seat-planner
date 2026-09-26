const app = require("./app");
const env = require("./config/env");
const { sequelize } = require("./models");
const { connectMongo } = require("./config/mongo");
const { loadSettings } = require("./services/settingService");
const { syncPermissionCatalogue } = require("./services/permissionService");
const jobs = require("./jobs");

async function start() {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connection established");

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
    console.log(
      `✅ Permission catalogue synced (${synced} permissions` +
        `${removed ? `, ${removed} retired` : ""})`
    );

    // Runtime-configurable values are read on hot paths, so they are cached in
    // memory once here rather than queried per request.
    const count = await loadSettings();
    console.log(`✅ Settings loaded (${count} values)`);

    // Connect MongoDB for document features (non-fatal if unavailable).
    await connectMongo();

    // Background work: the recurring sweeps (horizon, lapsed holds, …) and the
    // durable job worker, which on boot also resumes any job a stopped process
    // left half-done — a cancelled departure's refunds, for one.
    jobs.start();

    const server = app.listen(env.port, () => {
      console.log(`🚀 API listening on http://localhost:${env.port}/api/v1 (${env.nodeEnv})`);
    });

    /*
     * A deploy or a host recycling the process sends SIGTERM. Stop claiming new
     * jobs and let go: nothing has to be finished first, because a job cut off
     * here is still in the table and its lease simply lapses for the next
     * worker to pick up. That is the whole point of Phase 8B.
     */
    const shutdown = (signal) => {
      console.log(`${signal} received — stopping the job worker and closing`);
      jobs.stop();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    };
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

start();
