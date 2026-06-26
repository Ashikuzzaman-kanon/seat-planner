const { Op } = require("sequelize");
const { SeatPlan } = require("../models");
const ApiError = require("../utils/ApiError");

/**
 * Builds a CRUD service for one of the simple lookup tables (train names,
 * coach types, coach classes). `usageField` is the SeatPlan foreign key that
 * references this table, used to block deletion of an in-use entry.
 */
function makeReferenceService(Model, label, usageField) {
  async function list({ search = "" } = {}) {
    const where = search
      ? { name: { [Op.like]: `%${search}%` } }
      : undefined;
    const rows = await Model.findAll({ where, order: [["name", "ASC"]] });
    return rows.map((r) => r.toPublicJSON());
  }

  async function create({ name }) {
    const trimmed = name.trim();
    const existing = await Model.findOne({ where: { name: trimmed } });
    if (existing) throw ApiError.conflict(`${label} "${trimmed}" already exists`);
    const row = await Model.create({ name: trimmed });
    return row.toPublicJSON();
  }

  async function update(id, { name }) {
    const row = await Model.findByPk(id);
    if (!row) throw ApiError.notFound(`${label} not found`);

    const trimmed = name.trim();
    const clash = await Model.findOne({
      where: { name: trimmed, id: { [Op.ne]: row.id } },
    });
    if (clash) throw ApiError.conflict(`${label} "${trimmed}" already exists`);

    row.name = trimmed;
    await row.save();
    return row.toPublicJSON();
  }

  async function remove(id) {
    const row = await Model.findByPk(id);
    if (!row) throw ApiError.notFound(`${label} not found`);

    const inUse = await SeatPlan.count({ where: { [usageField]: row.id } });
    if (inUse > 0) {
      throw ApiError.conflict(
        `Cannot delete this ${label.toLowerCase()} — it is used by ${inUse} plan(s)`
      );
    }

    await row.destroy();
    return { id: row.id };
  }

  return { list, create, update, remove };
}

module.exports = makeReferenceService;
