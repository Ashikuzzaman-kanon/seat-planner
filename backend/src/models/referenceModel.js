const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Factory for the simple admin-managed lookup tables (train names, coach
 * types, coach classes). Each is just a unique name that planners pick from a
 * dropdown when building a plan.
 */
function defineReferenceModel(modelName, tableName) {
  class Reference extends Model {
    toPublicJSON() {
      return {
        id: this.id,
        name: this.name,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
      };
    }
  }

  Reference.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
    },
    { sequelize, modelName, tableName }
  );

  return Reference;
}

module.exports = defineReferenceModel;
