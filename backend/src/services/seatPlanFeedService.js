const { Op } = require("sequelize");
const { SeatPlan, TrainName, TrainCoach, CoachClass, CoachType } = require("../models");
const { PLAN_STATUS } = require("../constants/planStatus");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { VERSION_REFUSAL } = require("../utils/appVersion");
const ApiError = require("../utils/ApiError");
const audit = require("./auditService");
const devices = require("./deviceService");
const versions = require("./appVersionService");
const subscriptions = require("./subscriptionService");

/**
 * Seat plans for an app outside, signed in as a subscriber.
 *
 * An app whose account holds a subscription that includes seat plans
 * (`includesSeatPlans`) asks for a train's plans — all of them, one class, or
 * one coach — with the same sign-in as the subscription check: email,
 * password, and the device and app version it is calling from. So a
 * subscription's device limits and its version rules apply here as they do
 * there, and asking takes a device's place the way a check does.
 *
 * What a refusal says follows the check's rule: nothing about the device. A
 * version the subscription turns away is the one thing the app is told,
 * because it can do something about it; anything else is the same 403.
 *
 * Every call is in the audit log, answered or refused.
 */

const NOT_VALID = "No subscription that includes seat plans is valid on this device";

/** Why a call was refused, for the audit log. */
const WHY = Object.freeze({
  NO_SUBSCRIPTION: "no_seat_plan_subscription",
  NO_TRAIN: "no_such_train",
  NO_MATCH: "no_matching_plan",
});

const person = (user) => ({ id: user.id, email: user.email });
const account = (user) => ({ type: "user", id: user.id, label: user.email });
const cleanText = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/**
 * The plans asked for, or an ApiError. `asked` is `{ train, className, coach }`
 * as the caller sent them; `train` is a train's name or its number.
 */
async function forSubscriber(user, sent, asked, now = new Date()) {
  const query = {
    train: cleanText(asked.train, 100),
    class: cleanText(asked.className, 40),
    coach: cleanText(asked.coach, 40),
  };
  const record = (outcome, after, message) =>
    audit.record({
      action: AUDIT_ACTIONS.SUBSCRIPTION_SEAT_PLANS,
      actor: person(user),
      entity: account(user),
      after: { ...devices.asRecorded(sent), ...query, ...after },
      outcome,
      message,
    });

  // Which subscriptions are valid on this device, exactly as the check decides it.
  const { subscriptions: offered, held, verdict } = await subscriptions.standingOn(user, sent, now);
  const withPlans = new Set(offered.filter((s) => s.includesSeatPlans).map((s) => s.id));
  const usable = [...verdict.allowed].filter((id) => withPlans.has(id));

  if (!usable.length) {
    const versionRefusal = [...verdict.versionRefused].find(([id]) => withPlans.has(id))?.[1];
    const reason = !held.some((m) => withPlans.has(m.subscriptionId))
      ? WHY.NO_SUBSCRIPTION
      : versionRefusal || verdict.reason || devices.REASON.BEYOND_LIMIT;
    await record("failure", { reason }, `seat plans refused: ${versions.WORDS[reason] || devices.REASON_WORDS[reason] || reason.replace(/_/g, " ")}`);
    if (versionRefusal === VERSION_REFUSAL.REQUIRED) throw new ApiError(400, versions.MESSAGE[versionRefusal]);
    if (versionRefusal) throw new ApiError(426, versions.MESSAGE[versionRefusal]);
    throw ApiError.forbidden(NOT_VALID);
  }

  const train = query.train
    ? await TrainName.findOne({ where: { [Op.or]: [{ name: query.train }, { code: query.train }] }, attributes: ["id", "name", "code"] })
    : null;
  if (!train) {
    await record("failure", { reason: WHY.NO_TRAIN }, `seat plans asked for a train that does not exist: ${query.train}`);
    throw ApiError.notFound("No such train");
  }

  const plans = await SeatPlan.findAll({
    where: {
      trainNameId: train.id,
      status: PLAN_STATUS.APPROVED,
      revisionOfId: null,
      ...(query.coach ? { coachNo: query.coach } : {}),
    },
    include: [
      { model: CoachClass, as: "coachClass", attributes: ["name"], ...(query.class ? { where: { name: query.class }, required: true } : {}) },
      { model: CoachType, as: "coachType", attributes: ["name"] },
    ],
  });
  if (!plans.length) {
    await record("failure", { reason: WHY.NO_MATCH }, `no seat plan of ${train.name} matches what was asked`);
    throw ApiError.notFound("No seat plan matches");
  }

  // Front to back as the train's line-up runs; coaches not in it after, by letter.
  const line = await TrainCoach.findAll({ where: { trainId: train.id, seatPlanId: plans.map((p) => p.id) }, attributes: ["seatPlanId", "position"] });
  const position = new Map(line.map((c) => [c.seatPlanId, c.position]));
  plans.sort(
    (a, b) =>
      (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity) || String(a.coachNo).localeCompare(String(b.coachNo))
  );

  await record("success", { plans: plans.length }, `seat plans sent: ${plans.length} of ${train.name}`);
  return {
    train: { name: train.name, number: train.code },
    coaches: plans.map((p) => ({
      coach: p.coachNo,
      class: p.coachClass?.name || null,
      type: p.coachType?.name || null,
      planId: p.id,
      updatedAt: p.updatedAt,
      layout: p.layout,
    })),
  };
}

module.exports = { NOT_VALID, WHY, forSubscriber };
