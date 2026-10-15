const test = require("node:test");
const assert = require("node:assert/strict");

const { VERSION_REFUSAL, cleanVersion, sentAVersion, compareVersions, judgeVersion } = require("../../src/utils/appVersion");

/**
 * App versions on the subscription check: what is a version, which is newer,
 * and whether a platform's rules let one through.
 */

test("a version is one to four numbers joined by dots", () => {
  assert.equal(cleanVersion("1.4.2"), "1.4.2");
  assert.equal(cleanVersion("2"), "2");
  assert.equal(cleanVersion("1.4.2.17"), "1.4.2.17");
  assert.equal(cleanVersion(" 1.4 "), "1.4");
  assert.equal(cleanVersion(3), "3");
});

test("a leading v and leading zeros are tidied away", () => {
  assert.equal(cleanVersion("v1.4.2"), "1.4.2");
  assert.equal(cleanVersion("V2.0"), "2.0");
  assert.equal(cleanVersion("1.04.002"), "1.4.2");
});

test("anything else is not a version", () => {
  for (const bad of ["", "1.", ".1", "1..2", "1.2.3.4.5", "1.2-beta", "latest", "1,2", "v", "1.2 3", null, undefined]) {
    assert.equal(cleanVersion(bad), null, String(bad));
  }
  assert.equal(cleanVersion("1234567.1"), null);
});

test("an empty string is the same as sending nothing", () => {
  assert.equal(sentAVersion(""), false);
  assert.equal(sentAVersion("  "), false);
  assert.equal(sentAVersion(null), false);
  assert.equal(sentAVersion(undefined), false);
  assert.equal(sentAVersion("1"), true);
  assert.equal(sentAVersion(0), true);
});

test("versions compare number by number, a missing number counting as 0", () => {
  assert.equal(compareVersions("1.10", "1.9"), 1);
  assert.equal(compareVersions("1.9", "1.10"), -1);
  assert.equal(compareVersions("1.4", "1.4.0"), 0);
  assert.equal(compareVersions("2", "1.99.99"), 1);
  assert.equal(compareVersions("1.4.2", "1.4.2"), 0);
});

test("with no rules, every check goes through, with or without a version", () => {
  assert.deepEqual(judgeVersion(undefined), { version: null });
  assert.deepEqual(judgeVersion("v1.4.2"), { version: "1.4.2" });
});

test("a required version must be sent", () => {
  assert.deepEqual(judgeVersion(undefined, { required: true }), { refusal: VERSION_REFUSAL.REQUIRED });
  assert.deepEqual(judgeVersion("", { required: true }), { refusal: VERSION_REFUSAL.REQUIRED });
  assert.deepEqual(judgeVersion("1.0", { required: true }), { version: "1.0" });
});

test("a version that is sent must be one, required or not", () => {
  assert.deepEqual(judgeVersion("latest"), { refusal: VERSION_REFUSAL.INVALID });
  assert.deepEqual(judgeVersion("latest", { required: true }), { refusal: VERSION_REFUSAL.INVALID });
});

test("below the minimum is turned away; the minimum itself is not", () => {
  const policy = { minVersion: "1.4" };
  assert.deepEqual(judgeVersion("1.3.9", policy), { refusal: VERSION_REFUSAL.TOO_OLD });
  assert.deepEqual(judgeVersion("1.4.0", policy), { version: "1.4.0" });
  assert.deepEqual(judgeVersion("1.10", policy), { version: "1.10" });
});

test("a minimum does not by itself require a version", () => {
  assert.deepEqual(judgeVersion(undefined, { minVersion: "2.0" }), { version: null });
});

test("a blocked version is turned away above the minimum too, however it is written", () => {
  const policy = { minVersion: "1.0", blocked: ["1.4", "2.0.1"] };
  assert.deepEqual(judgeVersion("1.4.0", policy), { refusal: VERSION_REFUSAL.BLOCKED });
  assert.deepEqual(judgeVersion("v2.0.1", policy), { refusal: VERSION_REFUSAL.BLOCKED });
  assert.deepEqual(judgeVersion("1.4.1", policy), { version: "1.4.1" });
});
