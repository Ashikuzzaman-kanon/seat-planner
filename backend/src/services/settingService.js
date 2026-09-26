const { Setting } = require("../models");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const {
  SETTING_DEFINITIONS,
  SETTING_SCOPES,
  getDefinition,
  coerceValue,
} = require("../constants/settingDefinitions");
const audit = require("./auditService");

/**
 * Settings are read on hot paths (every token issued, every code emailed), so
 * they are loaded once at boot and kept in memory. Writes go through `set`,
 * which refreshes the cache — there is no other way to change them.
 *
 * Like the permission cache, this is per process: with several API instances a
 * change is seen immediately only by the one that served the write. Settings
 * change rarely enough that this is acceptable; a shared cache is the fix if we
 * ever scale out.
 */
const cache = new Map();

/** Populate the cache from the database. Call once during startup. */
async function loadSettings() {
  cache.clear();

  // Start from the declared defaults so a missing row is never a missing value.
  for (const definition of SETTING_DEFINITIONS) {
    cache.set(definition.key, definition.default);
  }

  const rows = await Setting.findAll({ where: { scope: SETTING_SCOPES.GLOBAL } });
  for (const row of rows) {
    // Ignore rows for settings that have since left the catalogue.
    if (getDefinition(row.key)) cache.set(row.key, row.value);
  }

  return cache.size;
}

/** Current value of a setting. Synchronous — the cache is loaded at startup. */
function get(key) {
  if (!cache.has(key)) {
    const definition = getDefinition(key);
    if (!definition) throw new Error(`Unknown setting: ${key}`);
    return definition.default;
  }
  return cache.get(key);
}

/**
 * Value equality that works for scalars and for the JSON settings alike.
 *
 * Serialising is enough here because these values come from the same validator,
 * which returns keys in a fixed order — this is not a general deep-equal and
 * does not need to be.
 */
function sameValue(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The whole catalogue with current values, for the admin screen. */
async function list() {
  const rows = await Setting.findAll({ where: { scope: SETTING_SCOPES.GLOBAL } });
  const overrides = new Map(rows.map((r) => [r.key, r]));

  return SETTING_DEFINITIONS.map((definition) => {
    const override = overrides.get(definition.key);
    const value = get(definition.key);
    return {
      ...definition,
      value,
      // Whether this reads as the stock value, not whether a row happens to
      // exist. A setting changed and changed back is at its default again, and
      // showing it as "modified" would give an operator nothing to act on.
      // Compared by value: a JSON setting is an array or object, and `===` on
      // those compares identity, so every one of them would read as modified.
      isDefault: sameValue(value, definition.default),
      updatedAt: override?.updatedAt ?? null,
    };
  });
}

/** Validate and store a new value, then refresh the cache and audit the change. */
async function set({ key, value, actingUser }) {
  const definition = getDefinition(key);
  if (!definition) throw ApiError.badRequest(`Unknown setting: ${key}`);

  let typed;
  try {
    typed = coerceValue(definition, value);
  } catch (err) {
    throw ApiError.badRequest(err.message);
  }

  const before = get(key);

  const [row] = await Setting.findOrCreate({
    where: { key, scope: SETTING_SCOPES.GLOBAL, scopeId: null },
    defaults: {
      key,
      scope: SETTING_SCOPES.GLOBAL,
      scopeId: null,
      value: typed,
      updatedById: actingUser?.id ?? null,
    },
  });

  if (row.value !== typed) {
    row.value = typed;
    row.updatedById = actingUser?.id ?? null;
    await row.save();
  }

  cache.set(key, typed);

  await audit.record({
    action: AUDIT_ACTIONS.SETTING_UPDATE,
    entity: { type: "setting", id: key, label: definition.label },
    before: { value: before },
    after: { value: typed },
  });

  return { ...definition, value: typed, isDefault: sameValue(typed, definition.default), updatedAt: row.updatedAt };
}

module.exports = { loadSettings, get, list, set };
