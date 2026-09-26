const { Op } = require("sequelize");
const { SeatAttribute } = require("../models");
const { ATTRIBUTE_VALUE_TYPES, slugifyKey } = require("../models/SeatAttribute");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const audit = require("./auditService");

async function list({ includeInactive = false } = {}) {
  const where = includeInactive ? {} : { isActive: true };
  const rows = await SeatAttribute.findAll({
    where,
    order: [
      ["sortOrder", "ASC"],
      ["label", "ASC"],
    ],
  });
  return rows.map((r) => r.toPublicJSON());
}

async function findOr404(id) {
  const row = await SeatAttribute.findByPk(id);
  if (!row) throw ApiError.notFound("Seat attribute not found");
  return row;
}

/** Enum attributes are meaningless without choices, so the shape is enforced. */
function validateOptions({ valueType, options }) {
  if (valueType !== ATTRIBUTE_VALUE_TYPES.ENUM) return null;

  if (!Array.isArray(options) || options.length === 0) {
    throw ApiError.badRequest("An enum attribute needs at least one option");
  }
  return options.map((option, i) => {
    if (!option || typeof option !== "object" || !option.value) {
      throw ApiError.badRequest(`Option ${i + 1} needs a value`);
    }
    return { value: String(option.value), label: String(option.label || option.value) };
  });
}

async function create(payload) {
  const key = String(payload.key || "").trim();
  if (!key) throw ApiError.badRequest("A key is required");

  const normalizedKey = slugifyKey(key);
  if (await SeatAttribute.findOne({ where: { key: normalizedKey } })) {
    throw ApiError.conflict(`A seat attribute with key "${normalizedKey}" already exists`);
  }

  const row = await SeatAttribute.create({
    key,
    label: String(payload.label).trim(),
    description: payload.description?.trim() || null,
    valueType: payload.valueType || ATTRIBUTE_VALUE_TYPES.BOOLEAN,
    options: validateOptions(payload),
    icon: payload.icon?.trim() || null,
    isFilterable: payload.isFilterable ?? true,
    sortOrder: payload.sortOrder ?? 100,
  });

  await audit.record({
    action: AUDIT_ACTIONS.SEAT_ATTRIBUTE_CREATE,
    entity: { type: "seat_attribute", id: row.id, label: row.label },
    after: row.toPublicJSON(),
  });

  return row.toPublicJSON();
}

async function update(id, payload) {
  const row = await findOr404(id);
  const before = row.toPublicJSON();

  if (payload.key !== undefined) {
    const normalizedKey = slugifyKey(payload.key);
    const clash = await SeatAttribute.findOne({
      where: { key: normalizedKey, id: { [Op.ne]: row.id } },
    });
    if (clash) throw ApiError.conflict(`A seat attribute with key "${normalizedKey}" already exists`);
    row.key = payload.key;
  }

  if (payload.label !== undefined) row.label = String(payload.label).trim();
  if (payload.description !== undefined) row.description = payload.description?.trim() || null;
  if (payload.valueType !== undefined) row.valueType = payload.valueType;
  if (payload.icon !== undefined) row.icon = payload.icon?.trim() || null;
  if (payload.isFilterable !== undefined) row.isFilterable = payload.isFilterable;
  if (payload.isActive !== undefined) row.isActive = payload.isActive;
  if (payload.sortOrder !== undefined) row.sortOrder = payload.sortOrder;

  if (payload.options !== undefined || payload.valueType !== undefined) {
    row.options = validateOptions({ valueType: row.valueType, options: payload.options ?? row.options });
  }

  await row.save();

  await audit.record({
    action: AUDIT_ACTIONS.SEAT_ATTRIBUTE_UPDATE,
    entity: { type: "seat_attribute", id: row.id, label: row.label },
    before,
    after: row.toPublicJSON(),
  });

  return row.toPublicJSON();
}

/**
 * Seats carry attribute keys inside layout JSON, which no foreign key protects.
 * Deactivating is therefore the safe default and deletion is reserved for
 * attributes that were never used.
 */
async function remove(id) {
  const row = await findOr404(id);
  const before = row.toPublicJSON();

  await row.destroy();

  await audit.record({
    action: AUDIT_ACTIONS.SEAT_ATTRIBUTE_DELETE,
    entity: { type: "seat_attribute", id: before.id, label: before.label },
    before,
  });

  return { id: before.id };
}

module.exports = { list, create, update, remove };
