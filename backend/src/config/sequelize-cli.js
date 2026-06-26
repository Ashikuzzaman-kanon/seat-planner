const path = require("path");
// Load the same .env the app uses, so migrations hit the same database.
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

function cfg(database) {
  return {
    username: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    database,
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306", 10),
    dialect: "mysql",
    define: { underscored: true, timestamps: true },
    logging: false,
  };
}

// sequelize-cli picks the block matching NODE_ENV (default "development").
module.exports = {
  development: cfg(process.env.DB_NAME || "seat_planner"),
  test: cfg(process.env.DB_NAME_TEST || "seat_planner_test"),
  production: cfg(process.env.DB_NAME || "seat_planner"),
};
