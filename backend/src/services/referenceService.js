const { Op } = require("sequelize");
const { SeatPlan } = require("../models");
const ApiError = require("../utils/ApiError");

/**
 * Builds a CRUD service for one of the simple lookup tables (train names,
 * coach types, coach classes). `usageField` is the SeatPlan foreign key that
 * references this table, used to block deletion of an in-use entry.
 */
function makeReferenceService(Model, label, usageField, extraFields = []) {
  /*
   * Most lookup tables are a name and nothing else. Coach classes outgrew that
   * — they carry how many passengers may stand in a coach of that class — so
   * the factory takes a list of further fields to accept rather than every
   * table having to be rewritten the first time one of them grows.
   */
  const pickExtras = (input) => {
    const out = {};
    for (const field of extraFields) {
      if (input[field] !== undefined) out[field] = input[field];
    }
    return out;
  };

  async function list({ search = "" } = {}) {
    const where = search
      ? { name: { [Op.like]: `%${search}%` } }
      : undefined;
    const rows = await Model.findAll({ where, order: [["name", "ASC"]] });
    return rows.map((r) => r.toPublicJSON());
  }

  async function create(input) {
    const trimmed = String(input.name || "").trim();
    const existing = await Model.findOne({ where: { name: trimmed } });
    if (existing) throw ApiError.conflict(`${label} "${trimmed}" already exists`);
    const row = await Model.create({ name: trimmed, ...pickExtras(input) });
    return row.toPublicJSON();
  }

  async function update(id, input) {
    const row = await Model.findByPk(id);
    if (!row) throw ApiError.notFound(`${label} not found`);

    if (input.name !== undefined) {
      const trimmed = String(input.name).trim();
      const clash = await Model.findOne({
        where: { name: trimmed, id: { [Op.ne]: row.id } },
      });
      if (clash) throw ApiError.conflict(`${label} "${trimmed}" already exists`);
      row.name = trimmed;
    }

    Object.assign(row, pickExtras(input));
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
