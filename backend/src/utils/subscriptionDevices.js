/**
 * Device limits on a subscription, as pure functions.
 *
 * A subscription allows so many devices of each platform. Devices are not
 * registered by anybody: the first time one checks in with the right password
 * and there is room, it takes a place on the account. Places are kept in the
 * order devices arrived, and that order is the whole rule — a subscription
 * allowing two Windows devices is valid on the account's first two.
 *
 * Whatever goes wrong here, the caller of the check API is told only
 * `valid: false`. The reason is for staff, and these are the reasons.
 */

/** The most devices of one platform a subscription can allow. */
const MAX_DEVICES = 10;

const REASON = Object.freeze({
  /** The call carried no deviceId. */
  NO_DEVICE: "no_device",
  /** It carried one that cannot be an id: wrong characters, or too short or long. */
  BAD_DEVICE: "bad_device",
  /** No platform, or one that does not exist. */
  UNKNOWN_PLATFORM: "unknown_platform",
  /** The platform exists but has been switched off. */
  PLATFORM_OFF: "platform_off",
  /** Staff blocked this device. */
  BLOCKED: "blocked",
  /** A new device, and every place on that platform is taken. */
  LIMIT_REACHED: "limit_reached",
  /** A device with a place, but beyond what the subscription allows now. */
  BEYOND_LIMIT: "beyond_limit",
});

const PLATFORM_VALUE = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$/;

/**
 * A platform value as callers send it: lowercase letters and digits, with
 * single `-`, `_` or `.` between them, up to 40 characters. Null if it is not.
 */
function cleanPlatformValue(input) {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  return value.length <= 40 && PLATFORM_VALUE.test(value) ? value : null;
}

/**
 * A device id: 4 to 128 letters, digits and `. _ : -`, as sent (case kept).
 * Returns `{ id }`, or `{ reason }` saying why it is not one.
 */
function cleanDeviceId(input) {
  if (input === undefined || input === null) return { reason: REASON.NO_DEVICE };
  const id = String(input).trim();
  if (!id) return { reason: REASON.NO_DEVICE };
  return DEVICE_ID.test(id) ? { id } : { reason: REASON.BAD_DEVICE };
}

/** Whatever was sent, cut to what the refusals table can hold. */
const asSent = (input, max) =>
  input === undefined || input === null ? "" : String(input).replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Check the device counts somebody asked for, and key them by platform id.
 *
 * `input` is `{ "<platform value>": count }`. A platform left out is 0;
 * `input` left out altogether is one of each — what the form starts on.
 * `platforms` are the ones that may be asked for (the active ones).
 *
 * Returns `{ limits }` as `{ "<platform id>": count }`, or `{ error }`.
 */
function cleanLimits(input, platforms) {
  if (input === undefined || input === null) {
    if (!platforms.length) return { error: "There are no platforms to subscribe on yet" };
    return { limits: Object.fromEntries(platforms.map((p) => [String(p.id), 1])) };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return { error: "devices must list a count for each platform" };
  }

  const byValue = new Map(platforms.map((p) => [p.value, p]));
  const limits = Object.fromEntries(platforms.map((p) => [String(p.id), 0]));

  for (const [key, raw] of Object.entries(input)) {
    const platform = byValue.get(String(key).trim().toLowerCase());
    if (!platform) return { error: `There is no platform called "${key}"` };
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 0 || count > MAX_DEVICES) {
      return { error: `${platform.name}: choose 0 to ${MAX_DEVICES} devices` };
    }
    limits[String(platform.id)] = count;
  }

  if (!Object.values(limits).some((count) => count > 0)) return { error: "Ask for at least one device" };
  return { limits };
}

/** How many devices of a platform a subscription's limits allow; 0 when it says nothing. */
function limitFor(limits, platformId) {
  const count = Number(limits?.[String(platformId)]);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

/**
 * New limits laid over old ones. `next` only speaks for the platforms that
 * could be asked for; whatever `current` allows on any other platform — one
 * switched off for now — is kept, so switching it back on restores it.
 */
function overlayLimits(current, next, platforms) {
  const merged = { ...next };
  for (const platform of platforms) {
    const key = String(platform.id);
    if (!(key in merged) && limitFor(current, platform.id) > 0) merged[key] = limitFor(current, platform.id);
  }
  return merged;
}

/**
 * The place a device holds among an account's devices of one platform:
 * 1 for the first to arrive, 0 when it has none. `devices` are in arrival
 * order; blocked ones hold no place, so the next one moves up.
 */
function placeOf(devices, deviceId) {
  const wanted = String(deviceId).toLowerCase();
  let place = 0;
  for (const device of devices) {
    if (device.isBlocked) continue;
    place++;
    if (String(device.deviceId).toLowerCase() === wanted) return place;
  }
  return 0;
}

/** "2 Windows, 1 Android" — the platforms a subscription allows, for messages. */
function describeLimits(limits, platforms) {
  const parts = platforms
    .map((p) => [limitFor(limits, p.id), p.name])
    .filter(([count]) => count > 0)
    .map(([count, name]) => `${count} ${name}`);
  return parts.length ? parts.join(", ") : "no devices";
}

module.exports = {
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
};
