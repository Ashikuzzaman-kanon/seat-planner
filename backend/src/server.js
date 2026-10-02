const app = require("./app");
const env = require("./config/env");
const { boot } = require("./boot");
const jobs = require("./jobs");

async function start() {
  try {
    await boot();

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
