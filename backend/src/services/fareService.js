const { Op } = require("sequelize");
const {
  sequelize,
  FareRule,
  FareTableEntry,
  Station,
  RouteStop,
  CoachClass,
  TrainName,
} = require("../models");
const { FARE_RULE_KINDS } = require("../models/FareRule");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const audit = require("./auditService");

const RULE_INCLUDE = [
  { model: TrainName, as: "train" },
  { model: CoachClass, as: "coachClass" },
  {
    model: FareTableEntry,
    as: "entries",
    include: [
      { model: Station, as: "fromStation" },
      { model: Station, as: "toStation" },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Rule chain CRUD
 * ------------------------------------------------------------------ */

async function listRules({ trainId, coachClassId } = {}) {
  const where = {};
  if (coachClassId) where.coachClassId = Number(coachClassId);
  if (trainId) where[Op.or] = [{ trainId: Number(trainId) }, { trainId: null }];

  const rules = await FareRule.findAll({
    where,
    include: RULE_INCLUDE,
    order: [
      ["priority", "ASC"],
      ["id", "ASC"],
    ],
  });
  return rules.map((r) => r.toPublicJSON());
}

async function findRuleOr404(id) {
  const rule = await FareRule.findByPk(id, { include: RULE_INCLUDE });
  if (!rule) throw ApiError.notFound("Fare rule not found");
  return rule;
}

function assertKindShape(rule) {
  if (rule.kind === FARE_RULE_KINDS.DISTANCE) {
    if (rule.ratePerKm == null || Number(rule.ratePerKm) <= 0) {
      throw ApiError.badRequest("A distance rule needs a rate per kilometre above zero");
    }
  }
}

async function createRule(payload) {
  const rule = await FareRule.create({
    name: String(payload.name).trim(),
    kind: payload.kind,
    priority: payload.priority ?? 100,
    trainId: payload.trainId ?? null,
    coachClassId: payload.coachClassId,
    ratePerKm: payload.kind === FARE_RULE_KINDS.DISTANCE ? payload.ratePerKm : null,
    minFare: payload.kind === FARE_RULE_KINDS.DISTANCE ? (payload.minFare ?? null) : null,
  });
  assertKindShape(rule);
  await rule.save();

  await audit.record({
    action: AUDIT_ACTIONS.FARE_RULE_CREATE,
    entity: { type: "fare_rule", id: rule.id, label: rule.name },
    after: rule.toPublicJSON(),
  });

  return (await findRuleOr404(rule.id)).toPublicJSON();
}

async function updateRule(id, payload) {
  const rule = await findRuleOr404(id);
  const before = rule.toPublicJSON();

  for (const field of ["name", "priority", "trainId", "coachClassId", "isActive"]) {
    if (payload[field] !== undefined) rule[field] = payload[field];
  }
  if (rule.kind === FARE_RULE_KINDS.DISTANCE) {
    if (payload.ratePerKm !== undefined) rule.ratePerKm = payload.ratePerKm;
    if (payload.minFare !== undefined) rule.minFare = payload.minFare;
  }
  assertKindShape(rule);
  await rule.save();

  await audit.record({
    action: AUDIT_ACTIONS.FARE_RULE_UPDATE,
    entity: { type: "fare_rule", id: rule.id, label: rule.name },
    before,
    after: rule.toPublicJSON(),
  });

  return (await findRuleOr404(rule.id)).toPublicJSON();
}

async function deleteRule(id) {
  const rule = await findRuleOr404(id);
  const before = rule.toPublicJSON();
  await rule.destroy();

  await audit.record({
    action: AUDIT_ACTIONS.FARE_RULE_DELETE,
    entity: { type: "fare_rule", id: before.id, label: before.name },
    before,
  });

  return { id: before.id };
}

/** Replace the price table of a `table` rule wholesale, inside a transaction. */
async function setTableEntries(id, entries) {
  const rule = await findRuleOr404(id);
  if (rule.kind !== FARE_RULE_KINDS.TABLE) {
    throw ApiError.badRequest("Only a table rule holds station-pair prices");
  }

  const rows = (entries || []).map((entry, i) => {
    const amount = Number(entry.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw ApiError.badRequest(`Entry ${i + 1} has an invalid amount`);
    }
    if (!entry.fromStationId || !entry.toStationId) {
      throw ApiError.badRequest(`Entry ${i + 1} needs both stations`);
    }
    if (Number(entry.fromStationId) === Number(entry.toStationId)) {
      throw ApiError.badRequest(`Entry ${i + 1} starts and ends at the same station`);
    }
    return {
      fareRuleId: rule.id,
      fromStationId: Number(entry.fromStationId),
      toStationId: Number(entry.toStationId),
      amount,
    };
  });

  const seen = new Set();
  for (const row of rows) {
    const key = `${row.fromStationId}-${row.toStationId}`;
    if (seen.has(key)) throw ApiError.badRequest("The same station pair is priced twice");
    seen.add(key);
  }

  const before = rule.toPublicJSON();

  await sequelize.transaction(async (transaction) => {
    await FareTableEntry.destroy({ where: { fareRuleId: rule.id }, transaction });
    if (rows.length) await FareTableEntry.bulkCreate(rows, { transaction });
  });

  const after = (await findRuleOr404(rule.id)).toPublicJSON();

  await audit.record({
    action: AUDIT_ACTIONS.FARE_RULE_UPDATE,
    entity: { type: "fare_rule", id: rule.id, label: rule.name },
    before: { entryCount: before.entryCount },
    after: { entryCount: after.entryCount },
    message: `price table replaced with ${rows.length} entries`,
  });

  return after;
}

/* ------------------------------------------------------------------ *
 * Resolution — the chain in action
 * ------------------------------------------------------------------ */

/**
 * Price one journey.
 *
 * Rules are tried in priority order, train-specific before global at the same
 * priority, and the **first rule that produces an amount wins**. A table rule
 * produces nothing when the pair is not listed, which is exactly what makes it
 * an override rather than a replacement for the per-kilometre rate.
 *
 * Returns the amount along with which rule produced it, so a fare can always
 * be explained rather than merely asserted.
 */
async function resolveFare({ trainId, coachClassId, fromStationId, toStationId }) {
  const stops = await RouteStop.findAll({
    where: { trainId: Number(trainId) },
    order: [["sequence", "ASC"]],
  });

  if (!stops.length) throw ApiError.badRequest("This train has no route yet");

  const from = stops.find((s) => s.stationId === Number(fromStationId));
  const to = stops.find((s) => s.stationId === Number(toStationId));

  if (!from) throw ApiError.badRequest("The origin is not on this train's route");
  if (!to) throw ApiError.badRequest("The destination is not on this train's route");
  if (from.sequence >= to.sequence) {
    throw ApiError.badRequest("The destination must come after the origin on the route");
  }

  const rules = await FareRule.findAll({
    where: {
      coachClassId: Number(coachClassId),
      isActive: true,
      [Op.or]: [{ trainId: Number(trainId) }, { trainId: null }],
    },
    include: [{ model: FareTableEntry, as: "entries" }],
    order: [
      ["priority", "ASC"],
      // A rule scoped to this train beats a global rule of the same priority.
      [sequelize.literal("`FareRule`.`train_id` IS NULL"), "ASC"],
      ["id", "ASC"],
    ],
  });

  const distanceKm =
    from.distanceKm == null || to.distanceKm == null
      ? null
      : Number(to.distanceKm) - Number(from.distanceKm);

  for (const rule of rules) {
    if (rule.kind === FARE_RULE_KINDS.TABLE) {
      const entry = rule.entries.find(
        (e) =>
          e.fromStationId === Number(fromStationId) && e.toStationId === Number(toStationId)
      );
      if (entry) {
        return {
          amount: Number(entry.amount),
          distanceKm,
          basis: "table",
          rule: { id: rule.id, name: rule.name, kind: rule.kind, priority: rule.priority },
          explanation: `Listed price for this station pair in "${rule.name}"`,
        };
      }
      continue; // Not listed — fall through to the next rule.
    }

    if (rule.kind === FARE_RULE_KINDS.DISTANCE) {
      if (distanceKm == null) continue; // Route has no distances recorded.
      const raw = distanceKm * Number(rule.ratePerKm);
      const floor = rule.minFare == null ? 0 : Number(rule.minFare);
      const amount = Math.round(Math.max(raw, floor) * 100) / 100;
      return {
        amount,
        distanceKm,
        basis: "distance",
        rule: { id: rule.id, name: rule.name, kind: rule.kind, priority: rule.priority },
        explanation:
          raw >= floor
            ? `${distanceKm} km × ${Number(rule.ratePerKm)} per km`
            : `Minimum fare of ${floor} applied (${distanceKm} km × ${Number(rule.ratePerKm)} = ${raw.toFixed(2)})`,
      };
    }
  }

  throw ApiError.badRequest(
    "No fare rule covers this journey. Add a per-kilometre rule for this class as a fallback."
  );
}

/**
 * Every station pair on a train priced at once — what the fare editor shows so
 * an administrator can see the gaps the fallback rule is covering.
 */
async function fareMatrix({ trainId, coachClassId }) {
  const stops = await RouteStop.findAll({
    where: { trainId: Number(trainId) },
    include: [{ model: Station, as: "station" }],
    order: [["sequence", "ASC"]],
  });

  if (!stops.length) throw ApiError.badRequest("This train has no route yet");

  const pairs = [];
  for (let i = 0; i < stops.length - 1; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      try {
        const fare = await resolveFare({
          trainId,
          coachClassId,
          fromStationId: stops[i].stationId,
          toStationId: stops[j].stationId,
        });
        pairs.push({
          fromStation: stops[i].station.toPublicJSON(),
          toStation: stops[j].station.toPublicJSON(),
          ...fare,
        });
      } catch {
        pairs.push({
          fromStation: stops[i].station.toPublicJSON(),
          toStation: stops[j].station.toPublicJSON(),
          amount: null,
          basis: "none",
          explanation: "No rule covers this pair",
        });
      }
    }
  }

  return { stops: stops.map((s) => s.toPublicJSON()), pairs };
}

module.exports = {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  setTableEntries,
  resolveFare,
  fareMatrix,
};
