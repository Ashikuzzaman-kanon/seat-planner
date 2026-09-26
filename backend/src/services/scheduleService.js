const { sequelize, TrainSchedule } = require("../models");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { DAY_NAMES } = require("../utils/dhakaTime");
const audit = require("./auditService");

async function get(trainId) {
  const schedules = await TrainSchedule.findAll({
    where: { trainId: Number(trainId) },
    order: [["effectiveFrom", "ASC"]],
  });
  return schedules.map((s) => s.toPublicJSON());
}

/**
 * Replace a train's schedules.
 *
 * Kept as a list with effective dates rather than a single weekday set, so a
 * timetable change is a new period rather than an edit that rewrites what the
 * train used to do.
 */
async function set(trainId, schedulesInput) {
  const schedules = (schedulesInput || []).map((schedule, i) => {
    const runsOn = [...new Set((schedule.runsOn || []).map(Number))].sort();

    if (runsOn.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw ApiError.badRequest(`Schedule ${i + 1} has an invalid day`);
    }
    if (
      schedule.effectiveFrom &&
      schedule.effectiveTo &&
      schedule.effectiveTo < schedule.effectiveFrom
    ) {
      throw ApiError.badRequest(`Schedule ${i + 1} ends before it starts`);
    }

    return {
      trainId: Number(trainId),
      runsOn,
      effectiveFrom: schedule.effectiveFrom || null,
      effectiveTo: schedule.effectiveTo || null,
      isActive: schedule.isActive !== false,
    };
  });

  const before = await get(trainId);

  await sequelize.transaction(async (transaction) => {
    await TrainSchedule.destroy({ where: { trainId: Number(trainId) }, transaction });
    if (schedules.length) await TrainSchedule.bulkCreate(schedules, { transaction });
  });

  const after = await get(trainId);

  await audit.record({
    action: AUDIT_ACTIONS.SCHEDULE_UPDATE,
    entity: { type: "train", id: Number(trainId) },
    before,
    after,
    message: after
      .map((s) => s.runsOn.map((d) => DAY_NAMES[d].slice(0, 3)).join("/") || "never")
      .join(" | "),
  });

  return after;
}

/** The schedule in force on a given calendar date, or null if none is. */
function scheduleFor(schedules, date) {
  return schedules.find((s) => s.coversDate(date)) || null;
}

module.exports = { get, set, scheduleFor };
