const { Sequelize } = require("sequelize");
const env = require("./env");

// Managed MySQL on free tiers (Aiven/TiDB) requires a TLS connection. Enable
// with DB_SSL=true. We don't ship a CA file, so validation is relaxed by
// default; set DB_SSL_REJECT_UNAUTHORIZED=true to enforce strict cert checks.
const dialectOptions =
  process.env.DB_SSL === "true"
    ? { ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true" } }
    : {};

const sequelize = new Sequelize(env.db.name, env.db.user, env.db.pass, {
  host: env.db.host,
  port: env.db.port,
  dialect: "mysql",
  dialectOptions,
  logging: env.isProduction ? false : (msg) => console.debug(msg),
  define: {
    underscored: true, // snake_case columns
    timestamps: true,
  },
  pool: {
    // Free DBs cap concurrent connections low — set DB_POOL_MAX=3 there.
    max: parseInt(process.env.DB_POOL_MAX || "10", 10),
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
});

module.exports = sequelize;
