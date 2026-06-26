const app = require("./app");
const env = require("./config/env");
const { sequelize } = require("./models");

async function start() {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connection established");

    // Schema is managed by migrations (npm run migrate) — no sync() here, so
    // the database shape is explicit, versioned, and identical across envs.

    app.listen(env.port, () => {
      console.log(`🚀 API listening on http://localhost:${env.port}/api (${env.nodeEnv})`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

start();
