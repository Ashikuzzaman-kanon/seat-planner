/**
 * The settings catalogue.
 *
 * Every value a privileged role may tune is declared here once — type, bounds,
 * default and explanation — and the admin UI renders itself from the
 * declaration. Adding a tunable later costs one entry, not a migration, an
 * endpoint and a form.
 *
 * Only settings with a live consumer belong here. A setting nothing reads is
 * just a control that does nothing.
 */

const SETTING_TYPES = Object.freeze({
  INTEGER: "integer",
  DECIMAL: "decimal",
  BOOLEAN: "boolean",
  STRING: "string",
  // For a value that is a shape rather than a scalar. Refund slabs are the
  // first: the spec makes the boundaries configurable, not just the
  // percentages, and four integer keys would hardcode the very thing meant to
  // be adjustable. A definition using this type supplies its own `validate`.
  JSON: "json",
});

/**
 * Scopes exist so a value can later be overridden per train or per class
 * (§15 of the spec). Only `global` is used today; the column is present so
 * adding narrower scopes stays additive.
 */
const SETTING_SCOPES = Object.freeze({ GLOBAL: "global" });

const SETTING_DEFINITIONS = Object.freeze([
  {
    key: "auth.access_token_ttl_minutes",
    group: "Authentication",
    label: "Access token lifetime (minutes)",
    description:
      "How long an access token stays valid. Shorter means a revoked role stops working sooner, at the cost of more refreshes.",
    type: SETTING_TYPES.INTEGER,
    default: 15,
    min: 1,
    max: 1440,
  },
  {
    key: "auth.refresh_token_ttl_days",
    group: "Authentication",
    label: "Refresh token lifetime (days)",
    description: "How long a session can be renewed without logging in again.",
    type: SETTING_TYPES.INTEGER,
    default: 30,
    min: 1,
    max: 365,
  },
  {
    key: "auth.verification_code_ttl_minutes",
    group: "Authentication",
    label: "Verification code lifetime (minutes)",
    description:
      "How long an emailed verification or password-reset code remains usable.",
    type: SETTING_TYPES.INTEGER,
    default: 15,
    min: 1,
    max: 1440,
  },
  {
    key: "trip.horizon_days",
    group: "Departures",
    label: "Rolling horizon (days)",
    description:
      "How many days of upcoming departures are kept generated. Raising it creates more departures on the next run; lowering it leaves existing ones alone.",
    type: SETTING_TYPES.INTEGER,
    default: 10,
    min: 1,
    max: 120,
  },
  {
    key: "trip.generation_enabled",
    group: "Departures",
    label: "Generate departures automatically",
    description:
      "When off, the horizon is only extended by someone pressing Generate. Useful while a timetable is being reworked.",
    type: SETTING_TYPES.BOOLEAN,
    default: true,
  },
  {
    key: "abuse.auto_hold_enabled",
    group: "Abuse",
    label: "Hold an account automatically at the threshold",
    description:
      "When off, a score that crosses the threshold still shows in the review queue but places " +
      "no hold. Off is the safe setting for a new deployment: watch what the numbers do before " +
      "letting them lock anybody out.",
    type: SETTING_TYPES.BOOLEAN,
    default: false,
  },
  {
    key: "abuse.hold_threshold",
    group: "Abuse",
    label: "Score at which an account is held automatically",
    description:
      "Deliberately high. Below this the signals go to a person; a number should only act on " +
      "its own when waiting for a human would plainly be worse.",
    type: SETTING_TYPES.INTEGER,
    default: 100,
    min: 10,
    max: 10000,
  },
  {
    key: "abuse.window_days",
    group: "Abuse",
    label: "How far back signals are counted (days)",
    description:
      "Signals age out. Somebody who was reported twice two years ago is not the same risk as " +
      "somebody reported twice last week, and a score with no window never forgives anything.",
    type: SETTING_TYPES.INTEGER,
    default: 180,
    min: 7,
    max: 3650,
  },
  {
    key: "abuse.weight_upheld_report",
    group: "Abuse",
    label: "Points for an upheld report",
    description:
      "Only reports a reviewer agreed with. An open report counts nothing, and a dismissed one " +
      "is withdrawn rather than discounted.",
    type: SETTING_TYPES.INTEGER,
    default: 25,
    min: 0,
    max: 1000,
  },
  {
    key: "abuse.weight_upheld_forgery",
    group: "Abuse",
    label: "Points for an upheld forgery report",
    description:
      "Presenting a code the railway did not issue is a different act from a name that did not " +
      "match, and the score should not pretend otherwise.",
    type: SETTING_TYPES.INTEGER,
    default: 60,
    min: 0,
    max: 1000,
  },
  {
    key: "abuse.weight_duplicate_scan",
    group: "Abuse",
    label: "Points for a ticket presented after it was used",
    description:
      "Weak on purpose. A shared screenshot looks exactly like a checker walking the train " +
      "twice, so one is worth very little and several are worth noticing.",
    type: SETTING_TYPES.INTEGER,
    default: 8,
    min: 0,
    max: 1000,
  },
  {
    key: "abuse.weight_churn",
    group: "Abuse",
    label: "Points for buying in quantity and returning nearly all of it",
    description:
      "Scaled by the proportion returned, and only counted past the ticket floor below.",
    type: SETTING_TYPES.INTEGER,
    default: 40,
    min: 0,
    max: 1000,
  },
  {
    key: "abuse.churn_minimum_tickets",
    group: "Abuse",
    label: "Tickets before churn is counted at all",
    description:
      "Four of four proves nothing — somebody may simply have had a bad month. The signal is " +
      "volume plus return rate, not either alone.",
    type: SETTING_TYPES.INTEGER,
    default: 10,
    min: 1,
    max: 1000,
  },
  {
    key: "abuse.churn_ratio_percent",
    group: "Abuse",
    label: "Return rate at which churn starts counting (%)",
    description:
      "Returning tickets is a service the railway sells. Somebody who buys forty and returns " +
      "four is a good customer; this is about returning nearly everything, repeatedly.",
    type: SETTING_TYPES.INTEGER,
    default: 70,
    min: 1,
    max: 100,
  },
  {
    key: "waitlist.enabled",
    group: "Booking",
    label: "Offer a waitlist when a journey is full",
    description:
      "When a stretch has no seats left, let passengers queue for one. A return or an " +
      "abandoned checkout is then offered straight to whoever is next, which is what makes a " +
      "demand-based return likely to pay out rather than merely possible.",
    type: SETTING_TYPES.BOOLEAN,
    default: true,
  },
  {
    key: "waitlist.offer_minutes",
    group: "Booking",
    label: "How long a waitlist offer stays open (minutes)",
    description:
      "A seat offered to the queue is held in that passenger's name for this long. Longer than " +
      "an ordinary checkout, because the passenger is not sitting at the screen waiting — but " +
      "every minute of it is a minute the seat is out of sale for everyone else.",
    type: SETTING_TYPES.INTEGER,
    default: 60,
    min: 5,
    max: 1440,
  },
  {
    key: "waitlist.max_open_offers_missed",
    group: "Booking",
    label: "Offers a passenger may let lapse before leaving the queue",
    description:
      "Each unanswered offer takes a seat out of sale for the whole offer window. After this " +
      "many, the entry is closed and the place goes to someone who will answer.",
    type: SETTING_TYPES.INTEGER,
    default: 2,
    min: 1,
    max: 10,
  },
  {
    key: "waitlist.max_entries_per_trip",
    group: "Booking",
    label: "Queue places one passenger may hold on a departure",
    description:
      "Stops one person queueing for every stretch of the same train and collecting seats they " +
      "will not use.",
    type: SETTING_TYPES.INTEGER,
    default: 2,
    min: 1,
    max: 10,
  },
  {
    key: "booking.hold_timeout_minutes",
    group: "Booking",
    label: "Seat hold timeout (minutes)",
    description:
      "How long selected seats stay reserved while a passenger pays. Too short and people lose seats mid-payment; too long and abandoned checkouts starve the inventory.",
    type: SETTING_TYPES.INTEGER,
    default: 10,
    min: 1,
    max: 120,
  },
  {
    key: "booking.max_tickets_per_booking",
    group: "Booking",
    label: "Maximum tickets per booking",
    description: "How many passengers may travel on one booking reference.",
    type: SETTING_TYPES.INTEGER,
    default: 4,
    min: 1,
    max: 10,
  },
  {
    key: "standing.fare_percent",
    group: "Booking",
    label: "Standing fare (% of the seated fare)",
    description:
      "What a connecting standing ticket costs, as a share of what a seat over the same stretch " +
      "would. A percentage rather than a flat rate because the seated fare already encodes " +
      "distance and class — a flat standing fare would badly misprice a 30km leg against a 300km " +
      "one. Capacity itself is set per coach class, on the class.",
    type: SETTING_TYPES.INTEGER,
    default: 50,
    min: 0,
    max: 100,
  },
  {
    key: "wallet.max_balance",
    group: "Booking",
    label: "Maximum wallet balance",
    description:
      "A cap on stored credit, both as an anti-abuse measure and because unbounded stored value attracts regulation.",
    type: SETTING_TYPES.INTEGER,
    default: 50000,
    min: 0,
    max: 10000000,
  },
  {
    key: "refund.convenient_slabs",
    group: "Refunds",
    label: "Convenient return deduction slabs",
    description:
      "How much is kept when a ticket is returned, by how long remains before departure. " +
      "Read as \"with at least this many hours to go, deduct this percent\". The lowest " +
      "slab should reach 0 hours, or tickets close to departure fall under the tightest rule.",
    type: SETTING_TYPES.JSON,
    default: [
      { hoursBefore: 96, deductionPercent: 10 },
      { hoursBefore: 48, deductionPercent: 25 },
      { hoursBefore: 24, deductionPercent: 50 },
      { hoursBefore: 12, deductionPercent: 75 },
      { hoursBefore: 0, deductionPercent: 100 },
    ],
    validate: validateSlabs,
  },
  {
    key: "refund.convenient_charge_min",
    group: "Refunds",
    label: "Minimum convenient-return charge (taka)",
    description:
      "A floor under the deduction, because a percentage of a very cheap ticket does not " +
      "cover the cost of handling the return. Zero means no floor.",
    type: SETTING_TYPES.INTEGER,
    default: 0,
    min: 0,
    max: 100000,
  },
  {
    key: "refund.convenient_charge_max",
    group: "Refunds",
    label: "Maximum convenient-return charge (taka)",
    description:
      "A cap on the deduction, so a long-distance fare is not penalised out of proportion. " +
      "Zero means no cap.",
    type: SETTING_TYPES.INTEGER,
    default: 0,
    min: 0,
    max: 100000,
  },
  {
    key: "refund.demand_charge_percent",
    group: "Refunds",
    label: "Demand-based return processing charge (%)",
    description:
      "Kept when a returned segment resells. Deliberately flat and not time-based: the seat " +
      "was sold again, so the railway lost nothing but the cost of handling it. Either the " +
      "passenger gets their fare back less this charge, or — if nobody buys the seat — they " +
      "get nothing. That is the whole bargain, and making it vary by time would blur it.",
    type: SETTING_TYPES.INTEGER,
    default: 10,
    min: 0,
    max: 100,
  },
  {
    key: "refund.demand_charge_min",
    group: "Refunds",
    label: "Minimum demand-return charge (taka)",
    description: "A floor under the processing charge. Zero means no floor.",
    type: SETTING_TYPES.INTEGER,
    default: 0,
    min: 0,
    max: 100000,
  },
  {
    key: "refund.demand_charge_max",
    group: "Refunds",
    label: "Maximum demand-return charge (taka)",
    description: "A cap on the processing charge. Zero means no cap.",
    type: SETTING_TYPES.INTEGER,
    default: 0,
    min: 0,
    max: 100000,
  },
  {
    key: "refund.sale_open_hours_before",
    group: "Refunds",
    label: "Returned seats go back on sale this long before departure",
    description:
      "A seat returned later than this is too close to departure to be worth re-listing, " +
      "so a demand-based return is refused rather than accepted and left to pay nothing.",
    type: SETTING_TYPES.INTEGER,
    default: 1,
    min: 0,
    max: 168,
  },
  {
    key: "wallet.min_topup",
    group: "Booking",
    label: "Minimum top-up",
    description: "The smallest amount that can be added to a wallet in one go.",
    type: SETTING_TYPES.INTEGER,
    default: 100,
    min: 1,
    max: 100000,
  },
  {
    key: "jobs.max_attempts",
    group: "Background jobs",
    label: "Attempts before a job is marked failed",
    description:
      "A job that fails is tried again, waiting longer each time. After this many attempts it " +
      "stops and waits for a person on the Background Jobs screen. Changes apply to jobs " +
      "queued from now on.",
    type: SETTING_TYPES.INTEGER,
    default: 5,
    min: 1,
    max: 20,
  },
  {
    key: "jobs.retry_base_seconds",
    group: "Background jobs",
    label: "First retry delay (seconds)",
    description:
      "How long a failed job waits before its second attempt. Each later attempt waits twice " +
      "as long as the one before, up to half an hour.",
    type: SETTING_TYPES.INTEGER,
    default: 30,
    min: 5,
    max: 3600,
  },
  {
    key: "jobs.inline_wait_seconds",
    group: "Background jobs",
    label: "How long a cancellation waits for its refunds (seconds)",
    description:
      "Cancelling a departure or a coach queues its refunds and waits this long for them, so " +
      "an ordinary cancellation still reports what it refunded. A bigger one answers " +
      "\"in progress\" and carries on in the background. 0 never waits.",
    type: SETTING_TYPES.INTEGER,
    default: 10,
    min: 0,
    max: 60,
  },
  {
    key: "jobs.keep_days",
    group: "Background jobs",
    label: "Days finished jobs are kept",
    description:
      "Jobs that succeeded are deleted after this many days. Failed jobs are kept until " +
      "somebody deals with them, however old.",
    type: SETTING_TYPES.INTEGER,
    default: 30,
    min: 1,
    max: 365,
  },
]);

const DEFINITIONS_BY_KEY = Object.freeze(
  Object.fromEntries(SETTING_DEFINITIONS.map((d) => [d.key, d]))
);

function getDefinition(key) {
  return DEFINITIONS_BY_KEY[key] || null;
}

/**
 * Coerce and validate a raw value against its declaration. Returns the typed
 * value, or throws a message suitable for showing the user.
 */
/**
 * Refund slabs, checked the way an administrator would get them wrong.
 *
 * Returns the parsed value or throws a message meant to be read in the settings
 * screen, not in a log.
 */
function validateSlabs(raw, label) {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;

  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a list of at least one slab`);
  }

  const slabs = value.map((slab, i) => {
    const hoursBefore = Number(slab?.hoursBefore);
    const deductionPercent = Number(slab?.deductionPercent);

    if (!Number.isFinite(hoursBefore) || hoursBefore < 0) {
      throw new Error(`Slab ${i + 1}: hoursBefore must be zero or more`);
    }
    if (!Number.isFinite(deductionPercent) || deductionPercent < 0 || deductionPercent > 100) {
      throw new Error(`Slab ${i + 1}: deductionPercent must be between 0 and 100`);
    }
    return { hoursBefore, deductionPercent };
  });

  const hours = slabs.map((s) => s.hoursBefore);
  if (new Set(hours).size !== hours.length) {
    throw new Error(`${label} has two slabs starting at the same hour`);
  }

  // A deduction that falls as departure nears would let someone return a ticket
  // more cheaply the later they left it, which is backwards.
  const ordered = [...slabs].sort((a, b) => b.hoursBefore - a.hoursBefore);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].deductionPercent < ordered[i - 1].deductionPercent) {
      throw new Error(
        `${label}: the deduction must not fall as departure approaches ` +
          `(${ordered[i - 1].hoursBefore}h keeps ${ordered[i - 1].deductionPercent}%, ` +
          `but ${ordered[i].hoursBefore}h keeps only ${ordered[i].deductionPercent}%)`
      );
    }
  }

  return ordered;
}

function coerceValue(definition, rawValue) {
  const { type, min, max, label } = definition;

  if (rawValue === null || rawValue === undefined || rawValue === "") {
    throw new Error(`${label} is required`);
  }

  if (type === SETTING_TYPES.JSON) {
    try {
      return definition.validate ? definition.validate(rawValue, label) : JSON.parse(rawValue);
    } catch (err) {
      throw new Error(err instanceof SyntaxError ? `${label} is not valid JSON` : err.message);
    }
  }

  if (type === SETTING_TYPES.BOOLEAN) {
    if (typeof rawValue === "boolean") return rawValue;
    if (rawValue === "true") return true;
    if (rawValue === "false") return false;
    throw new Error(`${label} must be true or false`);
  }

  if (type === SETTING_TYPES.INTEGER || type === SETTING_TYPES.DECIMAL) {
    const num = Number(rawValue);
    if (!Number.isFinite(num)) throw new Error(`${label} must be a number`);
    if (type === SETTING_TYPES.INTEGER && !Number.isInteger(num)) {
      throw new Error(`${label} must be a whole number`);
    }
    if (min !== undefined && num < min) throw new Error(`${label} must be at least ${min}`);
    if (max !== undefined && num > max) throw new Error(`${label} must be at most ${max}`);
    return num;
  }

  return String(rawValue);
}

module.exports = {
  SETTING_TYPES,
  SETTING_SCOPES,
  SETTING_DEFINITIONS,
  getDefinition,
  coerceValue,
};
