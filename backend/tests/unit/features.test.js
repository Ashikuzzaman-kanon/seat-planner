const test = require("node:test");
const assert = require("node:assert/strict");

const { compilePath, featuresFor, isAlwaysOpen, FEATURES } = require("../../src/constants/features");
const { apiPath } = require("../../src/services/featureService");

test("a pattern matches its own path, one segment per :x, and nothing longer", () => {
  const seat = compilePath("/trips/:x/seats/:x/**");
  assert.ok(seat.test("/trips/12/seats/40/timeline"));
  assert.ok(seat.test("/trips/12/seats/40"));
  assert.ok(!seat.test("/trips/12/seats"));
  const quote = compilePath("/bookings/quote");
  assert.ok(quote.test("/bookings/quote"));
  assert.ok(quote.test("/bookings/quote/"));
  assert.ok(!quote.test("/bookings/quote/extra"));
  assert.ok(!compilePath("/plans/:x").test("/plans/1/approve"));
});

test("a wide pattern covers the bare path and everything below it", () => {
  const wallet = compilePath("/wallet/**");
  assert.ok(wallet.test("/wallet"));
  assert.ok(wallet.test("/wallet/transactions"));
  assert.ok(!wallet.test("/wallets"));
});

test("the narrow rule wins over the wide one", () => {
  assert.deepEqual(featuresFor("POST", "/bookings"), ["book"]);
  assert.deepEqual(featuresFor("GET", "/bookings"), ["bookings"]);
  assert.deepEqual(featuresFor("GET", "/bookings/7/pdf"), ["bookings", "book"]);
  assert.deepEqual(featuresFor("POST", "/plans/3/approve"), ["approvals"]);
  assert.deepEqual(featuresFor("PUT", "/plans/3"), ["plans"]);
  assert.deepEqual(featuresFor("GET", "/trips/jobs"), ["departures"]);
  assert.deepEqual(featuresFor("GET", "/trips/5"), ["departures", "inventory"]);
  assert.deepEqual(featuresFor("POST", "/trips/5/seats/9/block"), ["inventory"]);
});

test("methods count: reading a shared list is not editing it", () => {
  assert.deepEqual(featuresFor("GET", "/trains"), ["network", "departures"]);
  assert.deepEqual(featuresFor("POST", "/trains"), ["network"]);
  assert.deepEqual(featuresFor("GET", "/reference/coach-classes"), ["reference", "network", "plans"]);
  assert.deepEqual(featuresFor("PUT", "/reference/coach-classes/2"), ["reference"]);
});

test("the query string and a trailing slash do not change the answer", () => {
  assert.deepEqual(featuresFor("get", "/wallet/transactions?page=2"), ["wallet"]);
  assert.deepEqual(featuresFor("GET", "/wallet/"), ["wallet"]);
});

test("what no switch reaches", () => {
  assert.equal(featuresFor("GET", "/settings"), null);
  assert.equal(featuresFor("GET", "/auth/me"), null);
  assert.equal(featuresFor("GET", "/features"), null);
  assert.equal(featuresFor("GET", "/users/4/profile"), null);
  assert.ok(isAlwaysOpen("PUT", "/settings/auth.lockout_minutes"));
  assert.ok(isAlwaysOpen("POST", "/users/4/restrict"));
  assert.ok(!isAlwaysOpen("GET", "/users"));
});

test("Settings is not a feature", () => {
  assert.ok(!FEATURES.some((f) => f.key === "settings" || f.path === "/dashboard/settings"));
  assert.equal(new Set(FEATURES.map((f) => f.key)).size, FEATURES.length);
});

test("paths are read below the API's base, versioned or not", () => {
  assert.equal(apiPath("/api/v1/wallet/topup?x=1"), "/wallet/topup");
  assert.equal(apiPath("/api/wallet"), "/wallet");
  assert.equal(apiPath("/api/v1"), "/");
});
