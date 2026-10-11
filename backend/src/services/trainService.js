const { Op, fn, col } = require("sequelize");
const { PLAN_STATUS } = require("../constants/planStatus");
const {
  sequelize,
  TrainName,
  RouteStop,
  Station,
  SeatPlan,
  TrainCoach,
  TrainSchedule,
  Trip,
  FareRule,
} = require("../models");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { validateRoute, routeSegments, journeyMinutes } = require("../utils/routeRules");
const audit = require("./auditService");

const ROUTE_INCLUDE = {
  model: RouteStop,
  as: "stops",
  include: [{ model: Station, as: "station" }],
};

async function list({ search = "", includeInactive = false } = {}) {
  const where = {};
  if (!includeInactive) where.isActive = true;
  if (search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${search}%` } },
      { code: { [Op.like]: `%${search}%` } },
    ];
  }

  const [trains, coachRows, scheduleRows] = await Promise.all([
    TrainName.findAll({
      where,
      include: [ROUTE_INCLUDE],
      order: [
        ["name", "ASC"],
        [{ model: RouteStop, as: "stops" }, "sequence", "ASC"],
      ],
    }),
    // Coaches that would actually be built: active, on an approved layout.
    TrainCoach.findAll({
      attributes: ["trainId", [fn("COUNT", col("TrainCoach.id")), "coaches"]],
      where: { isActive: true },
      include: [{ model: SeatPlan, as: "seatPlan", attributes: [], where: { status: PLAN_STATUS.APPROVED } }],
      group: ["trainId"],
      raw: true,
    }),
    TrainSchedule.findAll({ attributes: ["trainId"], where: { isActive: true }, group: ["trainId"], raw: true }),
  ]);
  const coachesBy = new Map(coachRows.map((r) => [r.trainId, Number(r.coaches)]));
  const scheduled = new Set(scheduleRows.map((r) => r.trainId));

  return trains.map((train) => {
    const json = train.toPublicJSON();
    const stops = json.stops || [];
    const coachCount = coachesBy.get(train.id) || 0;
    return {
      ...json,
      coachCount,
      // What departure generation needs: coaches it can build, and running days.
      readyForDepartures: coachCount > 0 && scheduled.has(train.id),
      stopCount: stops.length,
      originStation: stops[0]?.station?.name || null,
      terminusStation: stops[stops.length - 1]?.station?.name || null,
      // n stops make n-1 sellable segments — the unit Phase 4 prices inventory in.
      segmentCount: Math.max(stops.length - 1, 0),
      journeyMinutes: journeyMinutes(stops),
    };
  });
}

async function findOr404(id) {
  const train = await TrainName.findByPk(id, {
    include: [ROUTE_INCLUDE],
    order: [[{ model: RouteStop, as: "stops" }, "sequence", "ASC"]],
  });
  if (!train) throw ApiError.notFound("Train not found");
  return train;
}

async function get(id) {
  const train = await findOr404(id);
  const json = train.toPublicJSON();
  const stops = json.stops || [];
  return {
    ...json,
    segments: routeSegments(stops),
    journeyMinutes: journeyMinutes(stops),
  };
}

async function assertNameFree(name, exceptId) {
  const clash = await TrainName.findOne({
    where: { name: String(name).trim(), ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}) },
  });
  if (clash) throw ApiError.conflict(`A train named "${String(name).trim()}" already exists`);
}

async function create(payload) {
  await assertNameFree(payload.name);

  const train = await TrainName.create({
    name: String(payload.name).trim(),
    code: payload.code?.trim() || null,
    upCode: payload.upCode?.trim() || null,
    downCode: payload.downCode?.trim() || null,
    notes: payload.notes?.trim() || null,
  });

  await audit.record({
    action: AUDIT_ACTIONS.TRAIN_CREATE,
    entity: { type: "train", id: train.id, label: train.name },
    after: train.toPublicJSON(),
  });

  return get(train.id);
}

async function update(id, payload) {
  const train = await findOr404(id);
  const before = train.toPublicJSON();

  if (payload.name !== undefined) {
    await assertNameFree(payload.name, train.id);
    train.name = String(payload.name).trim();
  }
  if (payload.code !== undefined) train.code = payload.code?.trim() || null;
  if (payload.upCode !== undefined) train.upCode = payload.upCode?.trim() || null;
  if (payload.downCode !== undefined) train.downCode = payload.downCode?.trim() || null;
  if (payload.notes !== undefined) train.notes = payload.notes?.trim() || null;
  if (payload.isActive !== undefined) train.isActive = payload.isActive;

  await train.save();

  await audit.record({
    action: AUDIT_ACTIONS.TRAIN_UPDATE,
    entity: { type: "train", id: train.id, label: train.name },
    before,
    after: train.toPublicJSON(),
  });

  return get(train.id);
}

/**
 * Replace a train's whole route in one go.
 *
 * Wholesale replacement rather than per-stop edits, because a route is only
 * meaningful as a sequence: inserting a station halfway renumbers everything
 * after it, and the times, day offsets and distances have to stay coherent as a
 * set. It runs in a transaction so a rejected route leaves the old one intact
 * rather than half-deleted.
 */
async function setRoute(id, stopsInput) {
  const train = await findOr404(id);
  const before = { stops: train.toPublicJSON().stops };

  const stops = (stopsInput || []).map((stop, i) => ({
    sequence: i + 1,
    stationId: Number(stop.stationId),
    arrivalTime: stop.arrivalTime || null,
    departureTime: stop.departureTime || null,
    dayOffset: Number.isInteger(stop.dayOffset) ? stop.dayOffset : 0,
    distanceKm: stop.distanceKm === "" || stop.distanceKm == null ? null : Number(stop.distanceKm),
    haltMinutes: stop.haltMinutes == null ? null : Number(stop.haltMinutes),
  }));

  const problems = validateRoute(stops);
  if (problems.length) {
    throw ApiError.badRequest(`This route is not coherent: ${problems.join("; ")}`);
  }

  const stationIds = [...new Set(stops.map((s) => s.stationId))];
  const found = await Station.count({ where: { id: stationIds } });
  if (found !== stationIds.length) {
    throw ApiError.badRequest("One or more stops reference a station that does not exist");
  }

  await sequelize.transaction(async (transaction) => {
    await RouteStop.destroy({ where: { trainId: train.id }, transaction });
    await RouteStop.bulkCreate(
      stops.map((stop) => ({ ...stop, trainId: train.id })),
      { transaction }
    );
  });

  const after = await get(train.id);

  await audit.record({
    action: AUDIT_ACTIONS.ROUTE_UPDATE,
    entity: { type: "train", id: train.id, label: train.name },
    before,
    after: { stops: after.stops },
    message: `${stops.length} stops · ${Math.max(stops.length - 1, 0)} segments`,
  });

  return after;
}

/**
 * Delete a train.
 *
 * Every one of these tables cascades on `train_names`, so a delete that only
 * checked seat plans would silently destroy a train's route, composition,
 * schedule and every departure generated from it. Each is counted and named
 * instead, and deactivating is offered as the thing the caller almost always
 * actually wants.
 */
async function remove(id) {
  const train = await findOr404(id);

  const [plans, stops, coaches, schedules, trips, fareRules] = await Promise.all([
    SeatPlan.count({ where: { trainNameId: train.id } }),
    RouteStop.count({ where: { trainId: train.id } }),
    TrainCoach.count({ where: { trainId: train.id } }),
    TrainSchedule.count({ where: { trainId: train.id } }),
    Trip.count({ where: { trainId: train.id } }),
    FareRule.count({ where: { trainId: train.id } }),
  ]);

  const blockers = [
    plans && `${plans} seat plan(s)`,
    stops && `a route of ${stops} stops`,
    coaches && `${coaches} coach(es) in its composition`,
    schedules && `${schedules} schedule(s)`,
    trips && `${trips} generated departure(s)`,
    fareRules && `${fareRules} fare rule(s)`,
  ].filter(Boolean);

  if (blockers.length) {
    throw ApiError.conflict(
      `Cannot delete ${train.name} — it still has ${blockers.join(", ")}. ` +
        `Deactivate it instead, which takes it out of service without losing any of that.`
    );
  }

  await train.destroy();
  return { id: train.id };
}

module.exports = { list, get, create, update, setRoute, remove, findOr404 };
