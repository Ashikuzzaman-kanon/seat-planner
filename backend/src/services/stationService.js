const { Op } = require("sequelize");
const { Station, RouteStop, FareTableEntry } = require("../models");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const audit = require("./auditService");

async function list({ search = "", includeInactive = false } = {}) {
  const where = {};
  if (!includeInactive) where.isActive = true;
  if (search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${search}%` } },
      { code: { [Op.like]: `%${search}%` } },
      { district: { [Op.like]: `%${search}%` } },
    ];
  }
  const rows = await Station.findAll({ where, order: [["name", "ASC"]] });
  return rows.map((r) => r.toPublicJSON());
}

async function findOr404(id) {
  const station = await Station.findByPk(id);
  if (!station) throw ApiError.notFound("Station not found");
  return station;
}

async function get(id) {
  return (await findOr404(id)).toPublicJSON();
}

async function assertUnique({ code, name, exceptId }) {
  const clash = await Station.findOne({
    where: {
      [Op.or]: [{ code: String(code).trim().toUpperCase() }, { name: String(name).trim() }],
      ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}),
    },
  });
  if (clash) {
    const field = clash.code === String(code).trim().toUpperCase() ? "code" : "name";
    throw ApiError.conflict(`A station with that ${field} already exists`);
  }
}

async function create({ code, name, district }) {
  await assertUnique({ code, name });

  const station = await Station.create({
    code,
    name: String(name).trim(),
    district: district?.trim() || null,
  });

  await audit.record({
    action: AUDIT_ACTIONS.STATION_CREATE,
    entity: { type: "station", id: station.id, label: station.name },
    after: station.toPublicJSON(),
  });

  return station.toPublicJSON();
}

async function update(id, { code, name, district, isActive }) {
  const station = await findOr404(id);
  const before = station.toPublicJSON();

  await assertUnique({
    code: code ?? station.code,
    name: name ?? station.name,
    exceptId: station.id,
  });

  if (code !== undefined) station.code = code;
  if (name !== undefined) station.name = String(name).trim();
  if (district !== undefined) station.district = district?.trim() || null;
  if (isActive !== undefined) station.isActive = isActive;
  await station.save();

  await audit.record({
    action: AUDIT_ACTIONS.STATION_UPDATE,
    entity: { type: "station", id: station.id, label: station.name },
    before,
    after: station.toPublicJSON(),
  });

  return station.toPublicJSON();
}

/**
 * Deletion is blocked once anything references the station — a route or a fare
 * entry pointing at a missing station is worse than a station nobody uses.
 * Retiring it with `isActive: false` is the way to take one out of service.
 */
async function remove(id) {
  const station = await findOr404(id);
  const before = station.toPublicJSON();

  const [routeUses, fareUses] = await Promise.all([
    RouteStop.count({ where: { stationId: station.id } }),
    FareTableEntry.count({
      where: { [Op.or]: [{ fromStationId: station.id }, { toStationId: station.id }] },
    }),
  ]);

  if (routeUses || fareUses) {
    const parts = [
      routeUses ? `${routeUses} route stop(s)` : null,
      fareUses ? `${fareUses} fare entry(s)` : null,
    ].filter(Boolean);
    throw ApiError.conflict(
      `Cannot delete this station — it is used by ${parts.join(" and ")}. Retire it instead.`
    );
  }

  await station.destroy();

  await audit.record({
    action: AUDIT_ACTIONS.STATION_DELETE,
    entity: { type: "station", id: before.id, label: before.name },
    before,
  });

  return { id: before.id };
}

module.exports = { list, get, create, update, remove };
