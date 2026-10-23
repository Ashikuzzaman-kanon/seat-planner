const { Op } = require("sequelize");
const { sequelize, FeatureSwitch, FeatureSwitchTarget, User, Role } = require("../models");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { FEATURES, FEATURE_KEYS, SWITCH_STATES, featuresFor } = require("../constants/features");
const audit = require("./auditService");

/**
 * Feature switches: each tab of the app can be turned off for everyone, or for
 * chosen users and roles. The super admin is not exempt — a switch turned off
 * "for everyone" is off for them too — and Settings, where the switches live,
 * has none, so there is always a way back.
 *
 * A switched-off tab disappears from the menu, and the server refuses the API
 * calls that only it makes (constants/features.js says which). An endpoint
 * several tabs share keeps working while any of them is on.
 *
 * The switches are read on every signed-in request, so they are loaded once at
 * boot and kept in memory, like settings; `set` is the only way to change them
 * and refreshes the copy. Per process, as the settings cache is.
 */

const MESSAGE_MAX = 300;

/** key → { state, message, userIds: Set, roleIds: Set } — only switched features. */
const cache = new Map();

const entryOf = (row) => ({
  state: row.state,
  message: row.message || null,
  userIds: new Set((row.targets || []).filter((t) => t.userId).map((t) => t.userId)),
  roleIds: new Set((row.targets || []).filter((t) => t.roleId).map((t) => t.roleId)),
});

/** Populate the cache from the database. Called at startup. */
async function loadSwitches() {
  cache.clear();
  const rows = await FeatureSwitch.findAll({ include: [{ model: FeatureSwitchTarget, as: "targets" }] });
  // A switch for a feature since removed from the code is ignored.
  for (const row of rows) if (FEATURE_KEYS.includes(row.key)) cache.set(row.key, entryOf(row));
  return cache.size;
}

const whoOf = (user, access) => ({ userId: user.id, roleIds: (access?.roles || []).map((r) => r.id) });

function isOffFor(key, who) {
  const s = cache.get(key);
  if (!s || s.state === SWITCH_STATES.ON) return false;
  if (s.state === SWITCH_STATES.OFF_ALL) return true;
  return s.userIds.has(who.userId) || who.roleIds.some((id) => s.roleIds.has(id));
}

/** Whether a feature is switched off for everyone (and so for the public too). */
function offForEveryone(key) {
  return cache.get(key)?.state === SWITCH_STATES.OFF_ALL;
}

/** The features off for a person, each with the message left for them. */
function unavailableFor(user, access) {
  const who = whoOf(user, access);
  return FEATURE_KEYS.filter((key) => isOffFor(key, who)).map((key) => ({ key, message: cache.get(key).message }));
}

/** "/api/v1/wallet/topup?x=1" → "/wallet/topup". */
const apiPath = (url) => String(url).split("?")[0].replace(/^\/api(?:\/v\d+)?(?=\/|$)/, "") || "/";

/**
 * Refuse a request that serves only features switched off for the caller.
 * Called by `authenticate` once it knows who is asking.
 */
function guard(req) {
  if (!cache.size) return;
  const features = featuresFor(req.method, apiPath(req.originalUrl || req.url));
  if (!features?.length) return;
  const who = whoOf(req.user, req.access);
  if (!features.every((key) => isOffFor(key, who))) return;
  throw ApiError.featureUnavailable(features, cache.get(features[0])?.message);
}

/* ------------------------------------------------------------------ *
 * The switches screen (super admin only)
 * ------------------------------------------------------------------ */

const SWITCH_INCLUDE = [
  {
    model: FeatureSwitchTarget,
    as: "targets",
    include: [
      { model: User, as: "user", attributes: ["id", "fullName", "email"] },
      { model: Role, as: "role", attributes: ["id", "name"] },
    ],
  },
  { model: User, as: "updatedBy", attributes: ["id", "fullName"] },
];

function present(feature, row) {
  const targets = row?.targets || [];
  return {
    ...feature,
    state: row?.state || SWITCH_STATES.ON,
    message: row?.message || null,
    users: targets
      .filter((t) => t.user)
      .map((t) => ({ id: t.user.id, fullName: t.user.fullName, email: t.user.email }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    roles: targets
      .filter((t) => t.role)
      .map((t) => ({ id: t.role.id, name: t.role.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    updatedBy: row?.updatedBy ? { id: row.updatedBy.id, fullName: row.updatedBy.fullName } : null,
    updatedAt: row?.updatedAt || null,
  };
}

/** Every feature with its switch, and the roles one could be switched off for. */
async function list() {
  const [rows, roles] = await Promise.all([
    FeatureSwitch.findAll({ include: SWITCH_INCLUDE }),
    Role.findAll({ attributes: ["id", "name"], order: [["name", "ASC"]] }),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return {
    features: FEATURES.map((f) => present(f, byKey.get(f.key))),
    roles: roles.map((r) => ({ id: r.id, name: r.name })),
  };
}

/** People to choose from when switching a feature off for some: by name or email. */
async function people(search = "") {
  const term = String(search).trim();
  const where = term
    ? { [Op.or]: [{ fullName: { [Op.like]: `%${term}%` } }, { email: { [Op.like]: `%${term}%` } }] }
    : {};
  const users = await User.findAll({
    where,
    attributes: ["id", "fullName", "email"],
    order: [["fullName", "ASC"], ["id", "ASC"]],
    limit: 20,
  });
  return users.map((u) => ({ id: u.id, fullName: u.fullName, email: u.email }));
}

const ids = (list) => [...new Set((list || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

const snapshot = (entry) => ({
  state: entry.state,
  message: entry.message,
  users: entry.users.map((u) => ({ id: u.id, fullName: u.fullName })),
  roles: entry.roles.map((r) => ({ id: r.id, name: r.name })),
});

/**
 * Switch a feature: on, off for everyone, or off for the users and roles given.
 * The message is kept only while it is off; turning a feature on clears its
 * targets too, so switching it off again starts from a clean choice.
 */
async function set(key, { state, message, userIds, roleIds } = {}, actingUser) {
  const feature = FEATURES.find((f) => f.key === key);
  if (!feature) throw ApiError.notFound("There is no feature by that name");
  if (!Object.values(SWITCH_STATES).includes(state)) {
    throw ApiError.badRequest(`state must be one of ${Object.values(SWITCH_STATES).join(", ")}`);
  }

  const note = typeof message === "string" ? message.trim() : "";
  if (note.length > MESSAGE_MAX) throw ApiError.badRequest(`The message can be at most ${MESSAGE_MAX} characters`);

  const users = state === SWITCH_STATES.OFF_SOME ? ids(userIds) : [];
  const roles = state === SWITCH_STATES.OFF_SOME ? ids(roleIds) : [];
  if (state === SWITCH_STATES.OFF_SOME) {
    if (!users.length && !roles.length) throw ApiError.badRequest("Choose the users or roles to switch it off for");
    const [userCount, roleCount] = await Promise.all([
      users.length ? User.count({ where: { id: users } }) : 0,
      roles.length ? Role.count({ where: { id: roles } }) : 0,
    ]);
    if (userCount !== users.length) throw ApiError.badRequest("One of the chosen users does not exist");
    if (roleCount !== roles.length) throw ApiError.badRequest("One of the chosen roles does not exist");
  }

  const before = present(feature, await FeatureSwitch.findByPk(key, { include: SWITCH_INCLUDE }));

  await sequelize.transaction(async (transaction) => {
    await FeatureSwitch.upsert(
      {
        key,
        state,
        message: state === SWITCH_STATES.ON ? null : note || null,
        updatedById: actingUser?.id ?? null,
      },
      { transaction }
    );
    await FeatureSwitchTarget.destroy({ where: { featureKey: key }, transaction });
    await FeatureSwitchTarget.bulkCreate(
      [...users.map((userId) => ({ featureKey: key, userId })), ...roles.map((roleId) => ({ featureKey: key, roleId }))],
      { transaction }
    );
  });

  const row = await FeatureSwitch.findByPk(key, { include: SWITCH_INCLUDE });
  cache.set(key, entryOf(row));
  const after = present(feature, row);

  const words = {
    [SWITCH_STATES.ON]: "on",
    [SWITCH_STATES.OFF_ALL]: "off for everyone",
    [SWITCH_STATES.OFF_SOME]: `off for ${[
      users.length && `${users.length} user${users.length === 1 ? "" : "s"}`,
      roles.length && `${roles.length} role${roles.length === 1 ? "" : "s"}`,
    ]
      .filter(Boolean)
      .join(" and ")}`,
  };
  await audit.record({
    action: AUDIT_ACTIONS.FEATURE_SWITCH,
    entity: { type: "feature", id: key, label: feature.label },
    before: snapshot(before),
    after: snapshot(after),
    message: `${feature.label} switched ${words[state]}`,
  });

  return after;
}

module.exports = { loadSwitches, unavailableFor, offForEveryone, guard, list, people, set, apiPath };
