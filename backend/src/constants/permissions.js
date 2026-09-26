/**
 * The permission catalogue — the code-defined source of truth for every
 * capability in the system.
 *
 * Roles are database rows composed freely from this catalogue, but the
 * catalogue itself lives in code: every endpoint declares the key it requires,
 * so an administrator cannot invent a permission that no endpoint honours.
 *
 * Adding a feature means adding keys here; roles then adapt with no code
 * change. `npm run sync:permissions` (also run by the seeders) mirrors this
 * list into the `permissions` table so role assignments can reference it.
 */

const PERMISSIONS = Object.freeze({
  // Seat plans
  PLAN_VIEW: "plan:view",
  PLAN_CREATE: "plan:create",
  PLAN_UPDATE: "plan:update",
  PLAN_DELETE: "plan:delete",
  PLAN_APPROVE: "plan:approve",

  // Reference data
  REFERENCE_MANAGE: "reference:manage",

  // Network: stations, trains, routes, fares
  NETWORK_VIEW: "network:view",
  STATION_MANAGE: "station:manage",
  TRAIN_MANAGE: "train:manage",
  ROUTE_MANAGE: "route:manage",
  FARE_MANAGE: "fare:manage",
  SEAT_ATTRIBUTE_MANAGE: "seat_attribute:manage",

  // Composition, schedules and the departures generated from them
  COMPOSITION_MANAGE: "composition:manage",
  SCHEDULE_MANAGE: "schedule:manage",
  TRIP_VIEW: "trip:view",
  TRIP_MANAGE: "trip:manage",
  TRIP_CANCEL: "trip:cancel",

  // Segment-level seat inventory
  INVENTORY_VIEW: "inventory:view",
  QUOTA_MANAGE: "quota:manage",
  SEAT_BLOCK: "seat:block",

  // Buying, and the money behind it
  BOOKING_CREATE: "booking:create",
  BOOKING_VIEW_ALL: "booking:view_all",
  WALLET_VIEW_ALL: "wallet:view_all",
  WALLET_ADJUST: "wallet:adjust",

  // On the train
  TICKET_VERIFY: "ticket:verify",
  TICKET_SCAN: "ticket:scan",
  TICKET_REPORT: "ticket:report",
  ABUSE_REVIEW: "abuse:review",
  ACCOUNT_HOLD: "account:hold",

  WAITLIST_JOIN: "waitlist:join",
  WAITLIST_VIEW_ALL: "waitlist:view_all",

  // After the sale
  REFUND_REQUEST: "refund:request",
  REFUND_VIEW_ALL: "refund:view_all",
  REFUND_CONFIGURE: "refund:configure",
  APPROVAL_VIEW: "approval:view",
  APPROVAL_DECIDE_TRANSFER: "approval:decide_transfer",
  APPROVAL_DECIDE_WITHDRAWAL: "approval:decide_withdrawal",

  // Users
  USER_VIEW: "user:view",
  USER_MANAGE_ROLES: "user:manage_roles",

  // Roles & permissions
  ROLE_VIEW: "role:view",
  ROLE_CREATE: "role:create",
  ROLE_UPDATE: "role:update",
  ROLE_DELETE: "role:delete",

  // Configuration
  SETTING_VIEW: "setting:view",
  SETTING_MANAGE: "setting:manage",

  // Audit
  AUDIT_VIEW: "audit:view",

  // Background jobs
  JOB_VIEW: "job:view",
  JOB_MANAGE: "job:manage",
});

/**
 * Catalogue entries carry the metadata the admin UI renders. Keeping label and
 * description as data means the role editor stays generic — new permissions
 * appear in it automatically, grouped and explained, with no UI change.
 */
const PERMISSION_CATALOGUE = Object.freeze([
  {
    key: PERMISSIONS.PLAN_VIEW,
    group: "Seat plans",
    label: "View seat plans",
    description: "See approved coach layouts.",
  },
  {
    key: PERMISSIONS.PLAN_CREATE,
    group: "Seat plans",
    label: "Create seat plans",
    description: "Design new coach layouts and submit them for approval.",
  },
  {
    key: PERMISSIONS.PLAN_UPDATE,
    group: "Seat plans",
    label: "Edit seat plans",
    description: "Modify existing coach layouts.",
  },
  {
    key: PERMISSIONS.PLAN_DELETE,
    group: "Seat plans",
    label: "Delete seat plans",
    description: "Permanently remove coach layouts.",
  },
  {
    key: PERMISSIONS.PLAN_APPROVE,
    group: "Seat plans",
    label: "Approve seat plans",
    description: "Approve or reject layouts awaiting review.",
  },
  {
    key: PERMISSIONS.REFERENCE_MANAGE,
    group: "Reference data",
    label: "Manage reference data",
    description: "Maintain trains, coach types, coach classes and other lookups.",
  },
  {
    key: PERMISSIONS.NETWORK_VIEW,
    group: "Network",
    label: "View the network",
    description: "See stations, trains, routes and fares.",
  },
  {
    key: PERMISSIONS.STATION_MANAGE,
    group: "Network",
    label: "Manage stations",
    description: "Add, rename and retire stations.",
  },
  {
    key: PERMISSIONS.TRAIN_MANAGE,
    group: "Network",
    label: "Manage trains",
    description: "Create trains and maintain their codes and operating notes.",
  },
  {
    key: PERMISSIONS.ROUTE_MANAGE,
    group: "Network",
    label: "Manage routes",
    description:
      "Define the ordered stops of a train, with times, overnight day offsets and distances.",
  },
  {
    key: PERMISSIONS.FARE_MANAGE,
    group: "Network",
    label: "Manage fares",
    description:
      "Maintain the fare rule chain: station-pair price tables and per-kilometre rates.",
  },
  {
    key: PERMISSIONS.SEAT_ATTRIBUTE_MANAGE,
    group: "Network",
    label: "Manage seat attributes",
    description:
      "Maintain the catalogue of seat features planners can set and passengers can filter on.",
  },
  {
    key: PERMISSIONS.COMPOSITION_MANAGE,
    group: "Departures",
    label: "Manage coach composition",
    description: "Set which coaches a train runs with, in which order.",
  },
  {
    key: PERMISSIONS.SCHEDULE_MANAGE,
    group: "Departures",
    label: "Manage schedules",
    description: "Set which days of the week a train runs, and from when.",
  },
  {
    key: PERMISSIONS.TRIP_VIEW,
    group: "Departures",
    label: "View departures",
    description: "See generated departures and their coaches and seats.",
  },
  {
    key: PERMISSIONS.TRIP_MANAGE,
    group: "Departures",
    label: "Manage departures",
    description: "Generate the rolling horizon, rebuild a departure, or cancel one.",
  },
  {
    key: PERMISSIONS.TRIP_CANCEL,
    group: "Departures",
    label: "Cancel a departure or a coach",
    description:
      "Take a whole departure or a single coach out of service, refunding every passenger on " +
      "it in full and telling them. Separate from managing departures because this moves " +
      "money for hundreds of people at once — rebuilding a departure nobody has booked and " +
      "refunding a full train are not the same size of decision.",
  },
  {
    key: PERMISSIONS.INVENTORY_VIEW,
    group: "Inventory",
    label: "View seat availability",
    description: "See which seats are free between any two stations on a departure.",
  },
  {
    key: PERMISSIONS.QUOTA_MANAGE,
    group: "Inventory",
    label: "Distribute seats",
    description:
      "Reserve seats for specific station pairs and set when unsold ones release back to open sale.",
  },
  {
    key: PERMISSIONS.SEAT_BLOCK,
    group: "Inventory",
    label: "Block seats",
    description: "Take individual seats out of sale, for maintenance or an official hold.",
  },
  {
    key: PERMISSIONS.BOOKING_CREATE,
    group: "Booking",
    label: "Buy tickets",
    description: "Hold seats and complete a purchase. Every passenger needs this.",
  },
  {
    key: PERMISSIONS.BOOKING_VIEW_ALL,
    group: "Booking",
    label: "View all bookings",
    description: "See any passenger's bookings, not only your own.",
  },
  {
    key: PERMISSIONS.WALLET_VIEW_ALL,
    group: "Booking",
    label: "View any wallet",
    description: "Inspect a passenger's balance and transaction history.",
  },
  {
    key: PERMISSIONS.TICKET_VERIFY,
    group: "On the train",
    label: "Check a ticket",
    description:
      "Read a ticket by QR or number and see whether it is valid, without changing it. Also " +
      "covers downloading a service's manifest for checking offline.",
  },
  {
    key: PERMISSIONS.TICKET_SCAN,
    group: "On the train",
    label: "Scan a ticket as used",
    description:
      "Admit a passenger, marking their ticket used so it cannot be presented again. Separate " +
      "from checking because this is the half that cannot be undone.",
  },
  {
    key: PERMISSIONS.TICKET_REPORT,
    group: "On the train",
    label: "Report a ticket",
    description:
      "Raise that something is wrong with a ticket that otherwise passes — the person is not " +
      "the one on it, the same ticket is circulating. Higher than scanning because no machine " +
      "check catches this; it takes a judgement, and a judgement can be wrong.",
  },
  {
    key: PERMISSIONS.ABUSE_REVIEW,
    group: "After the sale",
    label: "Review reports and scores",
    description:
      "Work the queue of reported tickets, uphold or dismiss them, and see what the signals " +
      "against an account add up to. Upholding is what turns an accusation into a signal.",
  },
  {
    key: PERMISSIONS.ACCOUNT_HOLD,
    group: "After the sale",
    label: "Hold and release an account",
    description:
      "Stop an account buying, and lift that again. Always reversible, always audited — which " +
      "is what makes it safe to place at all.",
  },
  {
    key: PERMISSIONS.WAITLIST_JOIN,
    group: "Booking",
    label: "Join a waitlist",
    description:
      "Queue for a stretch that is sold out, and take a seat when one is offered. Every " +
      "passenger needs this; it grants nothing over anyone else's place in the queue.",
  },
  {
    key: PERMISSIONS.WAITLIST_VIEW_ALL,
    group: "Booking",
    label: "View every waitlist",
    description:
      "See who is queueing on a departure and how the queue is converting. Read-only: the " +
      "queue is served in join order by the system, not by hand.",
  },
  {
    key: PERMISSIONS.REFUND_REQUEST,
    group: "After the sale",
    label: "Return a ticket",
    description:
      "Ask for a refund on your own booking. Every passenger needs this; it grants nothing " +
      "over anyone else's tickets.",
  },
  {
    key: PERMISSIONS.REFUND_VIEW_ALL,
    group: "After the sale",
    label: "View all refunds",
    description: "See every return and what it has paid out, not only your own.",
  },
  {
    key: PERMISSIONS.REFUND_CONFIGURE,
    group: "After the sale",
    label: "Choose which returns a departure offers",
    description:
      "Turn the convenient or demand-based return on or off for one departure. Both are on " +
      "by default; this is for the exceptions.",
  },
  {
    key: PERMISSIONS.APPROVAL_VIEW,
    group: "After the sale",
    label: "View the approval queue",
    description:
      "See requests waiting on a human decision. Viewing is separate from deciding, so a " +
      "supervisor can watch a queue they may not act on.",
  },
  {
    key: PERMISSIONS.APPROVAL_DECIDE_TRANSFER,
    group: "After the sale",
    label: "Decide ticket transfers",
    description:
      "Approve or reject moving a ticket to a different National ID. Held narrowly: this is " +
      "what stops a ticket becoming a tradeable instrument.",
  },
  {
    key: PERMISSIONS.APPROVAL_DECIDE_WITHDRAWAL,
    group: "After the sale",
    label: "Decide wallet withdrawals",
    description:
      "Approve or reject taking credit out of a wallet. The only exit for money, and so the " +
      "point at which buy-and-refund churn is caught.",
  },
  {
    key: PERMISSIONS.WALLET_ADJUST,
    group: "Booking",
    label: "Adjust a wallet",
    description:
      "Credit or debit a wallet by hand. Appends a correcting entry; never edits history.",
  },
  {
    key: PERMISSIONS.USER_VIEW,
    group: "Users",
    label: "View users",
    description: "List and inspect user accounts.",
  },
  {
    key: PERMISSIONS.USER_MANAGE_ROLES,
    group: "Users",
    label: "Assign roles to users",
    description:
      "Grant and revoke roles. Limited to roles whose permissions the grantor already holds.",
  },
  {
    key: PERMISSIONS.ROLE_VIEW,
    group: "Roles & permissions",
    label: "View roles",
    description: "See roles and the permissions attached to them.",
  },
  {
    key: PERMISSIONS.ROLE_CREATE,
    group: "Roles & permissions",
    label: "Create roles",
    description: "Define new roles. Cannot grant permissions the creator lacks.",
  },
  {
    key: PERMISSIONS.ROLE_UPDATE,
    group: "Roles & permissions",
    label: "Edit roles",
    description: "Change a role's permissions. Cannot grant permissions the editor lacks.",
  },
  {
    key: PERMISSIONS.ROLE_DELETE,
    group: "Roles & permissions",
    label: "Delete roles",
    description: "Remove roles that are no longer needed.",
  },
  {
    key: PERMISSIONS.SETTING_VIEW,
    group: "Configuration",
    label: "View settings",
    description: "Read configurable system values.",
  },
  {
    key: PERMISSIONS.SETTING_MANAGE,
    group: "Configuration",
    label: "Manage settings",
    description: "Change configurable system values such as timeouts and thresholds.",
  },
  {
    key: PERMISSIONS.AUDIT_VIEW,
    group: "Audit",
    label: "View audit log",
    description: "Read the record of privileged actions taken in the system.",
  },
  {
    key: PERMISSIONS.JOB_VIEW,
    group: "Background jobs",
    label: "View background jobs",
    description:
      "See the work running after the request that started it — a cancelled departure's " +
      "refunds, the messages telling its passengers — how far it has got, and what failed.",
  },
  {
    key: PERMISSIONS.JOB_MANAGE,
    group: "Background jobs",
    label: "Retry failed jobs",
    description:
      "Send a job that ran out of attempts round again. Safe for the jobs this system runs: " +
      "each is written so that running it twice does the work once.",
  },
]);

const ALL_PERMISSION_KEYS = Object.freeze(PERMISSION_CATALOGUE.map((p) => p.key));

const PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);

/** True if `key` exists in the catalogue. */
function isValidPermission(key) {
  return PERMISSION_KEY_SET.has(key);
}

/** Returns only the keys that exist in the catalogue, de-duplicated. */
function sanitizePermissionKeys(keys = []) {
  return [...new Set(keys)].filter(isValidPermission);
}

/** Catalogue entries bucketed by group, for rendering the role editor. */
function permissionsByGroup() {
  return PERMISSION_CATALOGUE.reduce((acc, entry) => {
    (acc[entry.group] ||= []).push(entry);
    return acc;
  }, {});
}

module.exports = {
  PERMISSIONS,
  PERMISSION_CATALOGUE,
  ALL_PERMISSION_KEYS,
  isValidPermission,
  sanitizePermissionKeys,
  permissionsByGroup,
};
