const test = require("node:test");
const assert = require("node:assert/strict");

const { backoffSeconds, isPermanent, CAP_SECONDS } = require("../src/utils/jobRetry");
const ApiError = require("../src/utils/ApiError");

/**
 * When a durable job fails (Phase 8B): whether it is tried again, and how long
 * it waits first.
 */

test("the first retry waits the base delay", () => {
  assert.equal(backoffSeconds(1, 30), 30);
});

test("each later retry waits twice as long as the one before", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => backoffSeconds(n, 30)),
    [30, 60, 120, 240, 480]
  );
});

test("the wait is capped at half an hour", () => {
  assert.equal(CAP_SECONDS, 1800);
  assert.equal(backoffSeconds(20, 30), 1800);
  assert.equal(backoffSeconds(3, 3600), 1800);
});

test("a nonsense attempt number is treated as the first", () => {
  assert.equal(backoffSeconds(0, 30), 30);
  assert.equal(backoffSeconds(-4, 30), 30);
  assert.equal(backoffSeconds(undefined, 30), 30);
});

test("a missing base falls back to thirty seconds", () => {
  assert.equal(backoffSeconds(1), 30);
  assert.equal(backoffSeconds(2, 0), 60);
});

test("a refusal is not retried — it would refuse again", () => {
  assert.equal(isPermanent(ApiError.badRequest("no")), true);
  assert.equal(isPermanent(ApiError.notFound("gone")), true);
  assert.equal(isPermanent(ApiError.conflict("clash")), true);
});

test("a handler can say a failure is final", () => {
  assert.equal(isPermanent(Object.assign(new Error("departure deleted"), { retryable: false })), true);
});

test("everything else is worth another attempt", () => {
  assert.equal(isPermanent(new Error("ECONNRESET")), false);
  assert.equal(isPermanent(Object.assign(new Error("server error"), { statusCode: 500 })), false);
  assert.equal(isPermanent(Object.assign(new Error("try later"), { status: 503 })), false);
  assert.equal(isPermanent(undefined), false);
});
