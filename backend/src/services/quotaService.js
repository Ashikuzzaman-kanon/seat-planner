const { Op } = require("sequelize");
const {
  sequelize,
  TrainQuotaRule,
  TripSeatQuota,
  TripSeat,
  TripCoach,
  Trip,
  RouteStop,
  Station,
  CoachClass,
  TrainName,
  SeatSegmentBooking,
} = require("../models");
const { TRIP_STATUS } = require("../models/Trip");
const { TRIP_COACH_STATUS } = require("../models/TripCoach");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { instantAt, todayInDhaka } = require("../utils/dhakaTime");
const audit = require("./auditService");

const RULE_INCLUDE = [
  { model: TrainName, as: "train" },
  { model: CoachClass, as: "coachClass" },
  { model: Station, as: "fromStation" },
  { model: Station, as: "toStation" },
];

/* ------------------------------------------------------------------ *
 * Standing rules
 * ------------------------------------------------------------------ */

async function listRules({ trainId } = {}) {
  const where = trainId ? { trainId: Number(trainId) } : {};
  const rules = await TrainQuotaRule.findAll({
    where,
    include: RULE_INCLUDE,
    order: [["trainId", "ASC"], ["priority", "ASC"], ["id", "ASC"]],
  });
  return rules.map((r) => r.toPublicJSON());
}

async function findRuleOr404(id) {
  const rule = await TrainQuotaRule.findByPk(id, { include: RULE_INCLUDE });
  if (!rule) throw ApiError.notFound("Quota rule not found");
  return rule;
}

/** The pair must actually exist on the train's route, in that direction. */
async function assertPairOnRoute(trainId, fromStationId, toStationId) {
  const stops = await RouteStop.findAll({
    where: { trainId: Number(trainId) },
    order: [["sequence", "ASC"]],
  });
  const sequenceOf = new Map(stops.map((s) => [s.stationId, s.sequence]));

  const from = sequenceOf.get(Number(fromStationId));
  const to = sequenceOf.get(Number(toStationId));

  if (!from) throw ApiError.badRequest("The origin is not on this train's route");
  if (!to) throw ApiError.badRequest("The destination is not on this train's route");
  if (to <= from) {
    throw ApiError.badRequest("The destination must come after the origin on the route");
  }
}

async function createRule(payload) {
  await assertPairOnRoute(payload.trainId, payload.fromStationId, payload.toStationId);

  if (!Number.isInteger(payload.quantity) || payload.quantity < 1) {
    throw ApiError.badRequest("Quantity must be at least one seat");
  }

  const rule = await TrainQuotaRule.create({
    trainId: payload.trainId,
    coachClassId: payload.coachClassId,
    fromStationId: payload.fromStationId,
    toStationId: payload.toStationId,
    quantity: payload.quantity,
    releaseHoursBefore: payload.releaseHoursBefore ?? 24,
    priority: payload.priority ?? 100,
    effectiveFrom: payload.effectiveFrom || null,
    effectiveTo: payload.effectiveTo || null,
  });

  const created = (await findRuleOr404(rule.id)).toPublicJSON();
  await audit.record({
    action: AUDIT_ACTIONS.QUOTA_RULE_CREATE,
    entity: { type: "quota_rule", id: rule.id, label: `${created.quantity} seats` },
    after: created,
  });

  return created;
}

async function updateRule(id, payload) {
  const rule = await findRuleOr404(id);
  const before = rule.toPublicJSON();

  if (payload.fromStationId || payload.toStationId) {
    await assertPairOnRoute(
      rule.trainId,
      payload.fromStationId ?? rule.fromStationId,
      payload.toStationId ?? rule.toStationId
    );
  }

  for (const field of [
    "coachClassId", "fromStationId", "toStationId", "quantity",
    "releaseHoursBefore", "priority", "effectiveFrom", "effectiveTo", "isActive",
  ]) {
    if (payload[field] !== undefined) rule[field] = payload[field];
  }
  await rule.save();

  const after = (await findRuleOr404(rule.id)).toPublicJSON();
  await audit.record({
    action: AUDIT_ACTIONS.QUOTA_RULE_UPDATE,
    entity: { type: "quota_rule", id: rule.id },
    before,
    after,
  });

  return after;
}

/**
 * Delete a rule and free the seats it was holding.
 *
 * The reservations must go with it. The foreign key only nulls `rule_id`, which
 * would leave seats held on upcoming departures with nothing left to explain
 * why — an invisible hold nobody can find the cause of. Past departures keep
 * theirs, because that is history.
 */
async function deleteRule(id) {
  const rule = await findRuleOr404(id);
  const before = rule.toPublicJSON();

  let freed = 0;
  await sequelize.transaction(async (transaction) => {
    const upcoming = await Trip.findAll({
      where: { trainId: rule.trainId, departureDate: { [Op.gte]: todayInDhaka() } },
      attributes: ["id"],
      raw: true,
      transaction,
    });

    if (upcoming.length) {
      freed = await TripSeatQuota.destroy({
        where: { ruleId: rule.id, tripId: upcoming.map((t) => t.id) },
        transaction,
      });
    }

    await rule.destroy({ transaction });
  });

  await audit.record({
    action: AUDIT_ACTIONS.QUOTA_RULE_DELETE,
    entity: { type: "quota_rule", id: before.id },
    before,
    message: `${freed} reserved seats released on upcoming departures`,
  });

  return { id: before.id, freed };
}

/* ------------------------------------------------------------------ *
 * Materialising rules onto a departure
 * ------------------------------------------------------------------ */

/** When a departure actually leaves, as a real instant. */
async function departureInstant(trip) {
  const origin = await RouteStop.findOne({
    where: { trainId: trip.trainId, sequence: 1 },
  });
  return origin ? instantAt(trip.departureDate, origin.departureTime, origin.dayOffset) : null;
}

/**
 * Turn a train's standing rules into concrete seat reservations on one
 * departure.
 *
 * Rules take seats in priority order, each claiming from what earlier rules
 * have not already taken. Seats already reserved by hand are left alone, so a
 * regeneration does not stomp a deliberate override.
 */
async function materialiseForTrip(tripId, { replace = false } = {}) {
  const trip = await Trip.findByPk(tripId);
  if (!trip) throw ApiError.notFound("Departure not found");
  if (trip.status === TRIP_STATUS.CANCELLED) {
    return { tripId: Number(tripId), assigned: 0, rules: 0, notes: ["departure is cancelled"] };
  }

  const rules = (
    await TrainQuotaRule.findAll({
      where: { trainId: trip.trainId, isActive: true },
      order: [["priority", "ASC"], ["id", "ASC"]],
    })
  ).filter((r) => r.coversDate(trip.departureDate));

  // Note the ordering: a `replace` with no surviving rules must still clear the
  // old reservations, so this cannot return before the clear below.
  if (!rules.length && !replace) {
    return { tripId: Number(tripId), assigned: 0, rules: 0, notes: ["no rules apply to this date"] };
  }

  const leaves = await departureInstant(trip);
  const notes = [];
  let assigned = 0;

  await sequelize.transaction(async (transaction) => {
    if (replace) {
      // Only rule-made reservations are cleared; hand-placed ones survive.
      await TripSeatQuota.destroy({
        where: { tripId: trip.id, ruleId: { [Op.ne]: null } },
        transaction,
      });
    }

    const taken = new Set(
      (
        await TripSeatQuota.findAll({
          where: { tripId: trip.id },
          attributes: ["tripSeatId"],
          raw: true,
          transaction,
        })
      ).map((r) => r.tripSeatId)
    );

    for (const rule of rules) {
      const candidates = await TripSeat.findAll({
        where: {
          tripId: trip.id,
          coachClassId: rule.coachClassId,
          ...(taken.size ? { id: { [Op.notIn]: [...taken] } } : {}),
        },
        include: [
          {
            model: TripCoach,
            as: "coach",
            attributes: [],
            where: { status: TRIP_COACH_STATUS.ACTIVE },
            required: true,
          },
        ],
        order: [["id", "ASC"]],
        limit: rule.quantity,
        transaction,
      });

      if (candidates.length < rule.quantity) {
        notes.push(
          `rule ${rule.id}: wanted ${rule.quantity} seats, only ${candidates.length} were free to reserve`
        );
      }
      if (!candidates.length) continue;

      const releaseAt = leaves
        ? new Date(leaves.getTime() - rule.releaseHoursBefore * 3_600_000)
        : null;

      await TripSeatQuota.bulkCreate(
        candidates.map((seat) => ({
          tripId: trip.id,
          tripSeatId: seat.id,
          fromStationId: rule.fromStationId,
          toStationId: rule.toStationId,
          releaseAt,
          ruleId: rule.id,
        })),
        { transaction }
      );

      candidates.forEach((seat) => taken.add(seat.id));
      assigned += candidates.length;
    }
  });

  if (assigned) {
    await audit.record({
      action: AUDIT_ACTIONS.QUOTA_MATERIALIZE,
      entity: { type: "trip", id: trip.id, label: `${trip.departureDate}` },
      after: { assigned, rules: rules.length },
      message: `${assigned} seats reserved by ${rules.length} rule(s)`,
    });
  }

  return { tripId: trip.id, assigned, rules: rules.length, notes };
}

/** Apply rules across every upcoming departure of a train. */
async function materialiseForTrain(trainId, options = {}) {
  const trips = await Trip.findAll({
    where: {
      trainId: Number(trainId),
      status: TRIP_STATUS.SCHEDULED,
      departureDate: { [Op.gte]: todayInDhaka() },
    },
    order: [["departureDate", "ASC"]],
  });

  const results = [];
  for (const trip of trips) {
    results.push(await materialiseForTrip(trip.id, options));
  }

  return {
    trips: results.length,
    assigned: results.reduce((n, r) => n + r.assigned, 0),
    notes: [...new Set(results.flatMap((r) => r.notes))],
  };
}

/* ------------------------------------------------------------------ *
 * Reserving one named seat, by hand
 * ------------------------------------------------------------------ */

/**
 * Hold a **specific** seat for a **specific** station pair.
 *
 * The rules above say "hold ten AC Chair seats for A→C" and let the system
 * choose which. This is the other half: naming the seat yourself, for the cases
 * where which seat matters — a seat by the door held for a short-hop pair, or
 * one kept back at a particular station's request.
 *
 * Hand-placed holds carry no `ruleId`, which is what makes `materialise` leave
 * them alone: re-running the standing rules never overwrites a deliberate
 * decision.
 */
/** "3 days", "6 hours", "40 minutes" — for a message an operator reads. */
function describeHours(hours) {
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  if (hours >= 2) return `${Math.floor(hours)} hours`;
  return `${Math.max(1, Math.round(hours * 60))} minutes`;
}

async function setSeatQuota({ tripId, tripSeatId, fromStationId, toStationId, releaseHoursBefore }) {
  const trip = await Trip.findByPk(tripId);
  if (!trip) throw ApiError.notFound("Departure not found");
  if (trip.status === TRIP_STATUS.CANCELLED) {
    throw ApiError.badRequest("This departure is cancelled");
  }

  const seat = await TripSeat.findOne({ where: { id: tripSeatId, tripId: trip.id } });
  if (!seat) throw ApiError.notFound("That seat is not on this departure");

  await assertPairOnRoute(trip.trainId, fromStationId, toStationId);

  // Holding a seat that is already sold over that stretch would be a promise
  // the system cannot keep, so it is refused rather than silently ignored.
  const stops = await RouteStop.findAll({
    where: { trainId: trip.trainId },
    order: [["sequence", "ASC"]],
  });
  const sequenceOf = new Map(stops.map((s) => [s.stationId, s.sequence]));
  const from = sequenceOf.get(Number(fromStationId));
  const to = sequenceOf.get(Number(toStationId));

  const clash = await SeatSegmentBooking.count({
    where: {
      tripSeatId: seat.id,
      segmentIndex: { [Op.between]: [from - 1, to - 2] },
    },
  });
  if (clash) {
    throw ApiError.conflict(
      `Seat ${seat.seatNumber} is already taken over part of that stretch, so it cannot be held for it.`
    );
  }

  const leaves = await departureInstant(trip);
  const hours = releaseHoursBefore ?? 24;
  const releaseAt = leaves ? new Date(leaves.getTime() - hours * 3_600_000) : null;

  /*
   * A reservation stops applying once its release time passes. Ask for a
   * 24-hour release on a train leaving in six, and the release has already
   * happened — the row is written, the seat is never withheld from anyone, and
   * the operator is told it worked.
   *
   * That is how someone concludes the availability matrix is broken. Refusing
   * with the numbers in it is far better than accepting a hold that does
   * nothing.
   */
  if (releaseAt && releaseAt <= new Date()) {
    const hoursToDeparture = Math.max(0, (leaves.getTime() - Date.now()) / 3_600_000);
    const usable = Math.floor(hoursToDeparture);

    throw ApiError.badRequest(
      `This departure leaves in about ${describeHours(hoursToDeparture)}, so a reservation ` +
        `released ${hours} hours beforehand would already be past its release time and would ` +
        `hold nothing. ` +
        (usable >= 1
          ? `Use a release window under ${usable} hour(s), or hold the seat on a later departure.`
          : "Hold the seat on a later departure.")
    );
  }

  const existing = await TripSeatQuota.findOne({ where: { tripSeatId: seat.id } });
  const before = existing ? existing.toPublicJSON() : null;

  const [row] = await TripSeatQuota.upsert({
    ...(existing ? { id: existing.id } : {}),
    tripId: trip.id,
    tripSeatId: seat.id,
    fromStationId: Number(fromStationId),
    toStationId: Number(toStationId),
    releaseAt,
    releasedAt: null,
    // Deliberately null: this is a hand-placed hold, and `materialise` skips it.
    ruleId: null,
  });

  await audit.record({
    action: AUDIT_ACTIONS.QUOTA_SEAT_SET,
    entity: { type: "trip_seat", id: seat.id, label: `Seat ${seat.seatNumber}` },
    before,
    after: row.toPublicJSON(),
    message: `seat ${seat.seatNumber} held for stops ${from}→${to}, releasing ${hours}h before departure`,
  });

  return { ...row.toPublicJSON(), seatNumber: seat.seatNumber };
}

/** Return one named seat to open sale. */
async function clearSeatQuota({ tripId, tripSeatId }) {
  const seat = await TripSeat.findOne({ where: { id: tripSeatId, tripId } });
  if (!seat) throw ApiError.notFound("That seat is not on this departure");

  const existing = await TripSeatQuota.findOne({ where: { tripSeatId: seat.id } });
  if (!existing) throw ApiError.badRequest("That seat is not being held");

  const before = existing.toPublicJSON();
  await existing.destroy();

  await audit.record({
    action: AUDIT_ACTIONS.QUOTA_SEAT_CLEAR,
    entity: { type: "trip_seat", id: seat.id, label: `Seat ${seat.seatNumber}` },
    before,
    message: `seat ${seat.seatNumber} returned to open sale`,
  });

  return { tripSeatId: seat.id, seatNumber: seat.seatNumber };
}

/* ------------------------------------------------------------------ *
 * Release
 * ------------------------------------------------------------------ */

/**
 * Return reservations to open sale once their release time has passed.
 *
 * Without this, exact-pair matching would simply strand seats: a seat held for
 * A→C that nobody wanted would travel empty. Idempotent — already-released rows
 * are skipped by the same query that finds due ones.
 */
async function releaseDue({ now = new Date() } = {}) {
  const due = await TripSeatQuota.findAll({
    where: { releasedAt: null, releaseAt: { [Op.lte]: now } },
    attributes: ["id", "tripId"],
    raw: true,
  });

  if (!due.length) return { released: 0, trips: 0 };

  const [released] = await TripSeatQuota.update(
    { releasedAt: now },
    { where: { id: due.map((r) => r.id) } }
  );

  const trips = new Set(due.map((r) => r.tripId));

  await audit.record({
    action: AUDIT_ACTIONS.QUOTA_RELEASE,
    entity: { type: "horizon", id: String(now.toISOString().slice(0, 10)) },
    after: { released, trips: trips.size },
    message: `${released} reserved seats returned to open sale across ${trips.size} departure(s)`,
  });

  return { released, trips: trips.size };
}

/** Release one departure's reservations early, by hand. */
async function releaseTrip(tripId) {
  const now = new Date();
  const [released] = await TripSeatQuota.update(
    { releasedAt: now },
    { where: { tripId: Number(tripId), releasedAt: null } }
  );

  await audit.record({
    action: AUDIT_ACTIONS.QUOTA_RELEASE,
    entity: { type: "trip", id: Number(tripId) },
    after: { released },
    message: `${released} reserved seats released early`,
  });

  return { released };
}

/** What is currently reserved on a departure, and for which pairs. */
async function forTrip(tripId) {
  const rows = await TripSeatQuota.findAll({
    where: { tripId: Number(tripId) },
    include: [
      { model: TripSeat, as: "seat", attributes: ["id", "seatNumber", "coachClassId"] },
      { model: Station, as: "fromStation" },
      { model: Station, as: "toStation" },
    ],
    order: [["id", "ASC"]],
  });

  const now = new Date();
  return rows.map((row) => ({
    ...row.toPublicJSON(),
    seatNumber: row.seat?.seatNumber,
    coachClassId: row.seat?.coachClassId,
    fromStation: row.fromStation?.toPublicJSON(),
    toStation: row.toStation?.toPublicJSON(),
    isReleased: Boolean(row.releasedAt) || Boolean(row.releaseAt && row.releaseAt <= now),
  }));
}

module.exports = {
  listRules,
  setSeatQuota,
  clearSeatQuota,
  createRule,
  updateRule,
  deleteRule,
  materialiseForTrip,
  materialiseForTrain,
  releaseDue,
  releaseTrip,
  forTrip,
};
