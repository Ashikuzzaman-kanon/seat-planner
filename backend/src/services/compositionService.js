const { sequelize, TrainCoach, SeatPlan, CoachClass, CoachType } = require("../models");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { PLAN_STATUS } = require("../constants/planStatus");
const { countSeats } = require("../utils/seatMaterializer");
const audit = require("./auditService");

const PLAN_INCLUDE = [
  { model: CoachClass, as: "coachClass" },
  { model: CoachType, as: "coachType" },
];

async function get(trainId) {
  const coaches = await TrainCoach.findAll({
    where: { trainId: Number(trainId) },
    include: [{ model: SeatPlan, as: "seatPlan", include: PLAN_INCLUDE }],
    order: [["position", "ASC"]],
  });

  return coaches.map((coach) => {
    const json = coach.toPublicJSON();
    let seatCount = 0;
    try {
      seatCount = countSeats(coach.seatPlan?.layout);
    } catch {
      seatCount = 0; // A malformed layout is reported at generation, not here.
    }
    return {
      ...json,
      seatCount,
      // Only approved layouts are put into service, so the editor can warn
      // before a departure silently comes up short.
      planApproved: coach.seatPlan?.status === PLAN_STATUS.APPROVED,
    };
  });
}

/**
 * Replace a train's default composition.
 *
 * Wholesale, like the route: positions renumber when a coach is inserted, and
 * the line-up is only meaningful in order. Transactional, so a rejected
 * composition leaves the current one untouched.
 */
async function set(trainId, coachesInput) {
  const coaches = (coachesInput || []).map((coach, i) => ({
    trainId: Number(trainId),
    position: i + 1,
    coachCode: String(coach.coachCode || "").trim().toUpperCase(),
    seatPlanId: Number(coach.seatPlanId),
    isActive: coach.isActive !== false,
  }));

  if (coaches.some((c) => !c.coachCode)) {
    throw ApiError.badRequest("Every coach needs a code");
  }

  const codes = coaches.map((c) => c.coachCode);
  if (new Set(codes).size !== codes.length) {
    throw ApiError.badRequest("Two coaches share the same code");
  }

  const planIds = [...new Set(coaches.map((c) => c.seatPlanId))];
  if (planIds.some((id) => !Number.isInteger(id))) {
    throw ApiError.badRequest("Every coach needs a seat plan");
  }

  const plans = await SeatPlan.findAll({ where: { id: planIds } });
  if (plans.length !== planIds.length) {
    throw ApiError.badRequest("One or more coaches reference a seat plan that does not exist");
  }

  const before = await get(trainId);

  await sequelize.transaction(async (transaction) => {
    await TrainCoach.destroy({ where: { trainId: Number(trainId) }, transaction });
    if (coaches.length) await TrainCoach.bulkCreate(coaches, { transaction });
  });

  const after = await get(trainId);

  const unapproved = after.filter((c) => !c.planApproved).map((c) => c.coachCode);
  await audit.record({
    action: AUDIT_ACTIONS.COMPOSITION_UPDATE,
    entity: { type: "train", id: Number(trainId) },
    before: { coaches: before.map((c) => c.coachCode) },
    after: { coaches: after.map((c) => c.coachCode) },
    message:
      `${after.length} coaches, ${after.reduce((n, c) => n + c.seatCount, 0)} seats` +
      (unapproved.length ? ` · awaiting approval: ${unapproved.join(", ")}` : ""),
  });

  return after;
}

module.exports = { get, set };
