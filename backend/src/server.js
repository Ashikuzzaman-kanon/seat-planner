const app = require("./app");
const env = require("./config/env");
const { sequelize } = require("./models");

async function start() {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connection established");

    // Dev convenience: keep schema in sync. Use migrations in production.
    await sequelize.sync({ alter: !env.isProduction });
    console.log("✅ Models synchronized");

    app.listen(env.port, () => {
      console.log(`🚀 API listening on http://localhost:${env.port}/api (${env.nodeEnv})`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

start();
