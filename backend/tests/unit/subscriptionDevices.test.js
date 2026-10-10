const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_DEVICES,
  REASON,
  cleanPlatformValue,
  cleanDeviceId,
  asSent,
  cleanLimits,
  limitFor,
  overlayLimits,
  placeOf,
  describeLimits,
} = require("../../src/utils/subscriptionDevices");

/**
 * Device limits on a subscription: what is a platform value and a device id,
 * what counts somebody may ask for, and which place a device holds.
 */

const WINDOWS = { id: 1, value: "windows", name: "Windows" };
const ANDROID = { id: 2, value: "android", name: "Android" };
const PLATFORMS = [WINDOWS, ANDROID];

test("a platform value is lowercase words joined by single separators", () => {
  assert.equal(cleanPlatformValue("windows"), "windows");
  assert.equal(cleanPlatformValue("  Windows "), "windows");
  assert.equal(cleanPlatformValue("smart-tv"), "smart-tv");
  assert.equal(cleanPlatformValue("ios_17.2"), "ios_17.2");
  assert.equal(cleanPlatformValue("a".repeat(40)), "a".repeat(40));
});

test("anything else is not a platform value", () => {
  for (const bad of ["", "  ", "win dows", "win--dows", "-windows", "windows-", "windows!", "a".repeat(41), undefined, null, 7, {}]) {
    assert.equal(cleanPlatformValue(bad), null, JSON.stringify(bad));
  }
});

test("a device id is kept as sent", () => {
  assert.deepEqual(cleanDeviceId("458c70e0bd45dc3676dc6d83c5ccec4e"), { id: "458c70e0bd45dc3676dc6d83c5ccec4e" });
  assert.deepEqual(cleanDeviceId("  AB:CD:EF-01_x.y "), { id: "AB:CD:EF-01_x.y" });
  assert.deepEqual(cleanDeviceId("abcd"), { id: "abcd" });
  assert.deepEqual(cleanDeviceId(12345678), { id: "12345678" });
  assert.deepEqual(cleanDeviceId("a".repeat(128)), { id: "a".repeat(128) });
});

test("a missing device id says so, and a malformed one says that", () => {
  assert.equal(cleanDeviceId(undefined).reason, REASON.NO_DEVICE);
  assert.equal(cleanDeviceId(null).reason, REASON.NO_DEVICE);
  assert.equal(cleanDeviceId("   ").reason, REASON.NO_DEVICE);
  assert.equal(cleanDeviceId("abc").reason, REASON.BAD_DEVICE);
  assert.equal(cleanDeviceId("a".repeat(129)).reason, REASON.BAD_DEVICE);
  assert.equal(cleanDeviceId("has space").reason, REASON.BAD_DEVICE);
  assert.equal(cleanDeviceId("-starts-with-dash").reason, REASON.BAD_DEVICE);
  assert.equal(cleanDeviceId("<script>").reason, REASON.BAD_DEVICE);
  assert.equal(cleanDeviceId({ id: 1 }).reason, REASON.BAD_DEVICE);
});

test("what was sent is cut to fit for the record", () => {
  assert.equal(asSent(undefined, 40), "");
  assert.equal(asSent(null, 40), "");
  assert.equal(asSent("  a\n b  ", 40), "a b");
  assert.equal(asSent("x".repeat(300), 128).length, 128);
  assert.equal(asSent(42, 40), "42");
});

test("asking with no counts means one of each", () => {
  assert.deepEqual(cleanLimits(undefined, PLATFORMS), { limits: { 1: 1, 2: 1 } });
  assert.match(cleanLimits(undefined, []).error, /no platforms/);
});

test("counts are given by platform value and kept by platform id", () => {
  assert.deepEqual(cleanLimits({ windows: 2, android: 0 }, PLATFORMS), { limits: { 1: 2, 2: 0 } });
  assert.deepEqual(cleanLimits({ WINDOWS: "3" }, PLATFORMS), { limits: { 1: 3, 2: 0 } });
  assert.deepEqual(cleanLimits({ android: MAX_DEVICES }, PLATFORMS), { limits: { 1: 0, 2: MAX_DEVICES } });
});

test("counts outside 0 to the maximum are refused, naming the platform", () => {
  assert.match(cleanLimits({ windows: MAX_DEVICES + 1 }, PLATFORMS).error, /^Windows: choose 0 to 10/);
  assert.match(cleanLimits({ android: -1 }, PLATFORMS).error, /^Android/);
  assert.match(cleanLimits({ android: 1.5 }, PLATFORMS).error, /^Android/);
  assert.match(cleanLimits({ android: "lots" }, PLATFORMS).error, /^Android/);
});

test("a platform that is not offered cannot be asked for", () => {
  assert.match(cleanLimits({ ios: 1 }, PLATFORMS).error, /no platform called "ios"/);
});

test("at least one device must be asked for", () => {
  assert.match(cleanLimits({ windows: 0, android: 0 }, PLATFORMS).error, /at least one/);
  assert.match(cleanLimits({}, PLATFORMS).error, /at least one/);
});

test("counts must be an object", () => {
  assert.match(cleanLimits([1, 2], PLATFORMS).error, /count for each platform/);
  assert.match(cleanLimits("2", PLATFORMS).error, /count for each platform/);
});

test("a limit nobody set is no devices", () => {
  assert.equal(limitFor({ 1: 2 }, 1), 2);
  assert.equal(limitFor({ 1: 2 }, 2), 0);
  assert.equal(limitFor(null, 1), 0);
  assert.equal(limitFor({ 1: -3 }, 1), 0);
  assert.equal(limitFor({ 1: "x" }, 1), 0);
});

test("places are in the order devices arrived", () => {
  const devices = [{ deviceId: "first" }, { deviceId: "second" }, { deviceId: "third" }];
  assert.equal(placeOf(devices, "first"), 1);
  assert.equal(placeOf(devices, "third"), 3);
  assert.equal(placeOf(devices, "never-seen"), 0);
  assert.equal(placeOf([], "first"), 0);
});

test("a blocked device holds no place, so the next one moves up", () => {
  const devices = [{ deviceId: "first", isBlocked: true }, { deviceId: "second" }, { deviceId: "third" }];
  assert.equal(placeOf(devices, "first"), 0);
  assert.equal(placeOf(devices, "second"), 1);
  assert.equal(placeOf(devices, "third"), 2);
});

test("device ids match whatever their case", () => {
  assert.equal(placeOf([{ deviceId: "ABCDEF" }], "abcdef"), 1);
});

test("limits read as a phrase", () => {
  assert.equal(describeLimits({ 1: 2, 2: 1 }, PLATFORMS), "2 Windows, 1 Android");
  assert.equal(describeLimits({ 1: 0, 2: 3 }, PLATFORMS), "3 Android");
  assert.equal(describeLimits({}, PLATFORMS), "no devices");
});

test("new limits leave alone a platform they could not speak for", () => {
  const IOS = { id: 3, value: "ios", name: "iPhone" };
  // Android was switched off, so the new counts only cover Windows and iPhone.
  assert.deepEqual(overlayLimits({ 1: 1, 2: 2 }, { 1: 3, 3: 1 }, [...PLATFORMS, IOS]), { 1: 3, 2: 2, 3: 1 });
  // A platform they do speak for is theirs to lower, even to none.
  assert.deepEqual(overlayLimits({ 1: 1, 2: 2 }, { 1: 1, 2: 0 }, PLATFORMS), { 1: 1, 2: 0 });
  // And nothing is invented for a platform that allowed nothing.
  assert.deepEqual(overlayLimits({ 1: 1 }, { 1: 2 }, PLATFORMS), { 1: 2 });
  assert.deepEqual(overlayLimits(null, { 1: 2 }, PLATFORMS), { 1: 2 });
});
