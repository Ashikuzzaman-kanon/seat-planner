const test = require("node:test");
const assert = require("node:assert/strict");

const { refusalToRestrict } = require("../../src/utils/restrictionRules");

/**
 * Who may restrict whom: never yourself, never a super admin, and never an
 * account that can do something you cannot.
 */

const access = (permissions, isSuperAdmin = false) => ({ permissions, isSuperAdmin });
const ADMIN = access(["user:view", "user:restrict", "booking:create"]);
const PASSENGER = access(["booking:create"]);
const SUPER = access(["user:view", "user:restrict", "role:manage", "booking:create"], true);

test("an account with less than you can be restricted", () => {
  assert.equal(refusalToRestrict({ actorId: 1, actorAccess: ADMIN, targetId: 2, targetAccess: PASSENGER }), null);
});

test("so can one with exactly what you have", () => {
  assert.equal(refusalToRestrict({ actorId: 1, actorAccess: ADMIN, targetId: 2, targetAccess: ADMIN }), null);
});

test("not your own account, even as a super admin", () => {
  assert.match(refusalToRestrict({ actorId: 1, actorAccess: SUPER, targetId: "1", targetAccess: SUPER }), /your own account/);
  assert.match(refusalToRestrict({ actorId: 3, actorAccess: ADMIN, targetId: 3, targetAccess: ADMIN }), /your own account/);
});

test("never a super admin's", () => {
  assert.match(refusalToRestrict({ actorId: 1, actorAccess: SUPER, targetId: 2, targetAccess: SUPER }), /super admin/);
  assert.match(refusalToRestrict({ actorId: 1, actorAccess: ADMIN, targetId: 2, targetAccess: SUPER }), /super admin/);
});

test("not an account holding a permission you do not", () => {
  const planner = access(["booking:create", "plan:approve"]);
  assert.match(refusalToRestrict({ actorId: 1, actorAccess: ADMIN, targetId: 2, targetAccess: planner }), /permissions you do not/);
});

test("what every passenger is given does not count: an admin who never signed up as one can restrict one", () => {
  const admin = access(["user:view", "user:restrict", "plan:view"]);
  const passenger = access(["plan:view", "booking:create", "waitlist:join"]);
  const baseline = ["plan:view", "booking:create", "waitlist:join"];
  assert.match(refusalToRestrict({ actorId: 1, actorAccess: admin, targetId: 2, targetAccess: passenger }), /permissions you do not/);
  assert.equal(refusalToRestrict({ actorId: 1, actorAccess: admin, targetId: 2, targetAccess: passenger, baseline }), null);
  // But anything beyond the baseline still does.
  const planner = access([...baseline, "plan:approve"]);
  assert.match(refusalToRestrict({ actorId: 1, actorAccess: admin, targetId: 2, targetAccess: planner, baseline }), /permissions you do not/);
});

test("a super admin may restrict anyone else who is not one", () => {
  const planner = access(["booking:create", "plan:approve", "railway:manage"]);
  assert.equal(refusalToRestrict({ actorId: 1, actorAccess: SUPER, targetId: 2, targetAccess: planner }), null);
});
