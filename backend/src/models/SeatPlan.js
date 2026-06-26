const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const { ALL_PLAN_STATUSES, PLAN_STATUS } = require("../constants/planStatus");

class SeatPlan extends Model {
  static associate(models) {
    SeatPlan.belongsTo(models.TrainName, {
      as: "trainName",
      foreignKey: { name: "trainNameId", allowNull: false },
    });
    SeatPlan.belongsTo(models.CoachType, {
      as: "coachType",
      foreignKey: { name: "coachTypeId", allowNull: false },
    });
    SeatPlan.belongsTo(models.CoachClass, {
      as: "coachClass",
      foreignKey: { name: "coachClassId", allowNull: false },
    });
    SeatPlan.belongsTo(models.User, {
      as: "createdBy",
      foreignKey: { name: "createdById", allowNull: false },
    });
    SeatPlan.belongsTo(models.User, {
      as: "approvedBy",
      foreignKey: { name: "approvedById", allowNull: true },
    });
  }

  /**
   * Full representation for API responses. Includes nested reference names
   * and author info when they were eager-loaded, plus the raw layout JSON.
   */
  toPublicJSON() {
    const ref = (r) => (r ? { id: r.id, name: r.name } : null);
    const usr = (u) => (u ? { id: u.id, fullName: u.fullName, email: u.email } : null);
    return {
      id: this.id,
      coachNo: this.coachNo,
      status: this.status,
      rejectionReason: this.rejectionReason,
      trainNameId: this.trainNameId,
      coachTypeId: this.coachTypeId,
      coachClassId: this.coachClassId,
      trainName: ref(this.trainName),
      coachType: ref(this.coachType),
      coachClass: ref(this.coachClass),
      layout: this.layout,
      createdBy: usr(this.createdBy),
      approvedBy: usr(this.approvedBy),
      approvedAt: this.approvedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

SeatPlan.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    coachNo: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM(...ALL_PLAN_STATUSES),
      allowNull: false,
      defaultValue: PLAN_STATUS.DRAFT,
    },
    rejectionReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // The whole seat grid: stations, direction divider, rows -> cells -> seats.
    layout: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
    approvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: "SeatPlan",
    tableName: "seat_plans",
  }
);

module.exports = SeatPlan;
