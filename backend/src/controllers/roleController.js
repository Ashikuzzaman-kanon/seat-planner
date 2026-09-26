const asyncHandler = require("../utils/asyncHandler");
const roleService = require("../services/roleService");
const { PERMISSION_CATALOGUE } = require("../constants/permissions");

const listRoles = asyncHandler(async (_req, res) => {
  res.json({ roles: await roleService.listRoles() });
});

const getRole = asyncHandler(async (req, res) => {
  res.json({ role: await roleService.getRole(req.params.id) });
});

/**
 * The full catalogue, with the subset the caller may actually grant. The role
 * editor uses this to disable permissions the caller does not hold, so the
 * escalation guard is visible in the UI rather than only as a rejected save.
 */
const listPermissions = asyncHandler(async (req, res) => {
  const held = new Set(req.access.permissions);
  res.json({
    permissions: PERMISSION_CATALOGUE.map((entry) => ({
      ...entry,
      grantable: req.access.isSuperAdmin || held.has(entry.key),
    })),
  });
});

const createRole = asyncHandler(async (req, res) => {
  const role = await roleService.createRole({
    actingAccess: req.access,
    name: req.body.name,
    description: req.body.description,
    permissions: req.body.permissions,
  });
  res.status(201).json({ message: "Role created", role });
});

const updateRole = asyncHandler(async (req, res) => {
  const role = await roleService.updateRole({
    actingAccess: req.access,
    id: req.params.id,
    name: req.body.name,
    description: req.body.description,
    permissions: req.body.permissions,
  });
  res.json({ message: "Role updated", role });
});

const deleteRole = asyncHandler(async (req, res) => {
  await roleService.deleteRole({ actingAccess: req.access, id: req.params.id });
  res.json({ message: "Role deleted" });
});

module.exports = { listRoles, getRole, listPermissions, createRole, updateRole, deleteRole };
