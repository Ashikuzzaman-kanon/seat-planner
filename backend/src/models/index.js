const sequelize = require("../config/database");
const User = require("./User");

const models = { User };

// Wire up associations here as more models are added (e.g. SeatPlan).
Object.values(models).forEach((model) => {
  if (typeof model.associate === "function") {
    model.associate(models);
  }
});

module.exports = { sequelize, ...models };
