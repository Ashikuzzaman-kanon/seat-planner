// End-to-end check of the dynamic RBAC layer against the running API.
const { PERMISSION_CATALOGUE } = require("../../../src/constants/permissions");
const { DEMO_ROLES } = require("../../../src/seeders/demoAccounts");
const CATALOGUE = PERMISSION_CATALOGUE.length;
const ADMIN = DEMO_ROLES.find((r) => r.name === "admin").permissions.length;
// The default role: buy, return, queue, and read plans (seed:superadmin).
const PASSENGER_BASELINE = 4;
const BASE = process.env.API_BASE.replace(/\/v1$/, "");

let pass = 0;
let fail = 0;

function check(label, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label} ${detail}`);
  }
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

const login = (email, password) => call("POST", "/auth/login", { body: { email, password } });

(async () => {
  // The catalogue grows every phase, so counts are derived, never hardcoded.
  const catalogue = (await call("GET", "/meta/permissions")).body.permissions;
  const TOTAL = catalogue.length;

  console.log("\n== login and session shape ==");
  const su = await login("superadmin1@example.com", "SuperAdmin123!");
  check("super admin logs in", su.status === 200, JSON.stringify(su.body));
  check("issues an access token", !!su.body?.accessToken);
  check("issues a refresh token", !!su.body?.refreshToken);
  check(`super admin holds every permission in the catalogue (${CATALOGUE})`, su.body?.permissions?.length === CATALOGUE,
    `got ${su.body?.permissions?.length}`);
  check("no legacy role field on user", su.body?.user?.role === undefined);

  const admin = await login("admin1@example.com", "Admin123!");
  check("admin logs in", admin.status === 200);
  check(`admin holds exactly the demo admin role's ${ADMIN} permissions`, admin.body?.permissions?.length === ADMIN,
    `got ${admin.body?.permissions?.length}`);

  const planner = await login("planner1@example.com", "Planner123!");
  check("planner holds 4 permissions", planner.body?.permissions?.length === 4,
    `got ${planner.body?.permissions?.length}`);

  const user = await login("user1@example.com", "User123!");
  check(`default user holds the passenger baseline of ${PASSENGER_BASELINE}`, user.body?.permissions?.length === PASSENGER_BASELINE,
    `got ${user.body?.permissions?.length}`);

  const suToken = su.body.accessToken;
  const adminToken = admin.body.accessToken;
  const plannerToken = planner.body.accessToken;

  console.log("\n== /auth/me ==");
  const me = await call("GET", "/auth/me", { token: adminToken });
  check("returns roles", me.body?.roles?.[0]?.name === "admin", JSON.stringify(me.body?.roles));
  check("returns permissions", Array.isArray(me.body?.permissions));

  console.log("\n== permission gating ==");
  const plannerUsers = await call("GET", "/users", { token: plannerToken });
  check("planner blocked from /users (no user:view)", plannerUsers.status === 403,
    `got ${plannerUsers.status}`);
  const adminUsers = await call("GET", "/users", { token: adminToken });
  check("admin allowed on /users", adminUsers.status === 200, `got ${adminUsers.status}`);
  check("user list carries role arrays", Array.isArray(adminUsers.body?.users?.[0]?.roles));

  const noToken = await call("GET", "/users");
  check("missing token rejected", noToken.status === 401);

  console.log("\n== escalation guard ==");
  // admin holds role:create but NOT setting:manage or role:delete.
  const escalate = await call("POST", "/roles", {
    token: adminToken,
    body: { name: "sneaky", description: "attempted privilege escalation",
            permissions: ["setting:manage"] },
  });
  check("admin cannot grant setting:manage (not held)", escalate.status === 403,
    `got ${escalate.status}: ${escalate.body?.message}`);

  const legit = await call("POST", "/roles", {
    token: adminToken,
    body: { name: "reviewer", description: "can view and approve plans",
            permissions: ["plan:view", "plan:approve"] },
  });
  check("admin can create a role within its own permissions", legit.status === 201,
    `got ${legit.status}: ${legit.body?.message}`);
  const reviewerId = legit.body?.role?.id;

  const badKey = await call("POST", "/roles", {
    token: suToken,
    body: { name: "bogus", permissions: ["not:a:real:permission"] },
  });
  check("unknown permission key rejected", badKey.status === 400,
    `got ${badKey.status}`);

  console.log("\n== system role protection ==");
  const roles = await call("GET", "/roles", { token: suToken });
  const superRole = roles.body?.roles?.find((r) => r.name === "super_admin");
  const defaultRole = roles.body?.roles?.find((r) => r.isDefault);
  check("super_admin marked as system", superRole?.isSystem === true);
  check("a default role exists", !!defaultRole, JSON.stringify(defaultRole));

  const editSystem = await call("PATCH", `/roles/${superRole.id}`, {
    token: suToken,
    body: { description: "tampering" },
  });
  check("super_admin role cannot be edited, even by super admin", editSystem.status === 403,
    `got ${editSystem.status}`);

  const delDefault = await call("DELETE", `/roles/${defaultRole.id}`, { token: suToken });
  check("default role cannot be deleted", delDefault.status === 400, `got ${delDefault.status}`);

  console.log("\n== assigning roles + live revocation ==");
  const targetId = adminUsers.body.users.find((u) => u.email === "user2@example.com").id;

  const grant = await call("PUT", `/users/${targetId}/roles`, {
    token: suToken,
    body: { roleIds: [reviewerId] },
  });
  check("super admin grants the reviewer role", grant.status === 200,
    `got ${grant.status}: ${grant.body?.message}`);

  const u2 = await login("user2@example.com", "User123!");
  check("user2 now holds plan:approve", u2.body?.permissions?.includes("plan:approve"),
    JSON.stringify(u2.body?.permissions));
  const u2Token = u2.body.accessToken;

  // Revoke while user2's access token is still valid — permissions are
  // re-resolved per request, so it should stop working without re-login.
  await call("PUT", `/users/${targetId}/roles`, { token: suToken, body: { roleIds: [] } });
  const afterRevoke = await call("GET", "/auth/me", { token: u2Token });
  check("same token still authenticates after revocation", afterRevoke.status === 200);
  check("but permissions are now empty", afterRevoke.body?.permissions?.length === 0,
    JSON.stringify(afterRevoke.body?.permissions));

  console.log("\n== self-lockout guards ==");
  const suId = adminUsers.body.users.find((u) => u.email === "superadmin1@example.com").id;
  const self = await call("PUT", `/users/${suId}/roles`, {
    token: suToken, body: { roleIds: [] },
  });
  check("cannot change your own roles", self.status === 400, `got ${self.status}`);

  const otherSuId = adminUsers.body.users.find((u) => u.email === "superadmin2@example.com").id;
  const su3 = adminUsers.body.users.find((u) => u.email === "superadmin@example.com");
  // Strip the other two super admins, leaving one, then try to strip the last.
  await call("PUT", `/users/${otherSuId}/roles`, { token: suToken, body: { roleIds: [] } });
  if (su3) await call("PUT", `/users/${su3.id}/roles`, { token: suToken, body: { roleIds: [] } });
  const lastSuper = await call("PUT", `/users/${suId}/roles`, {
    token: (await login("superadmin2@example.com", "SuperAdmin123!")).body?.accessToken,
    body: { roleIds: [] },
  });
  check("demoted super admin can no longer manage roles", lastSuper.status === 403,
    `got ${lastSuper.status}`);

  console.log("\n== refresh token rotation ==");
  const r1 = await call("POST", "/auth/refresh", {
    body: { refreshToken: admin.body.refreshToken },
  });
  check("refresh returns a new pair", r1.status === 200 && !!r1.body?.accessToken);
  check("refresh token is rotated", r1.body?.refreshToken !== admin.body.refreshToken);

  const reuse = await call("POST", "/auth/refresh", {
    body: { refreshToken: admin.body.refreshToken },
  });
  check("the old refresh token is dead after rotation", reuse.status === 401,
    `got ${reuse.status}`);

  const loggedOut = await call("POST", "/auth/logout", {
    body: { refreshToken: r1.body.refreshToken },
  });
  check("logout succeeds", loggedOut.status === 200);
  const afterLogout = await call("POST", "/auth/refresh", {
    body: { refreshToken: r1.body.refreshToken },
  });
  check("refresh fails after logout", afterLogout.status === 401, `got ${afterLogout.status}`);

  console.log("\n== catalogue metadata ==");
  const meta = await call("GET", "/meta/permissions");
  check("catalogue is public metadata", meta.status === 200 && meta.body?.permissions?.length === CATALOGUE,
    `${meta.status} ${meta.body?.permissions?.length}`);
  const grantable = await call("GET", "/roles/permissions", { token: adminToken });
  const setting = grantable.body?.permissions?.find((p) => p.key === "setting:manage");
  check("catalogue marks un-grantable permissions for the caller", setting?.grantable === false,
    JSON.stringify(setting));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
