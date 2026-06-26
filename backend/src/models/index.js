const sequelize = require("../config/database");
const User = require("./User");
const TrainName = require("./TrainName");
const CoachType = require("./CoachType");
const CoachClass = require("./CoachClass");
const SeatPlan = require("./SeatPlan");

const models = { User, TrainName, CoachType, CoachClass, SeatPlan };

// Wire up associations for any model that declares them.
Object.values(models).forEach((model) => {
  if (typeof model.associate === "function") {
    model.associate(models);
  }
});

module.exports = { sequelize, ...models };
