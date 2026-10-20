/**
 * The parts of the app that can be switched off: one per tab in the menu.
 *
 * Settings is not here and never can be. The switches live under Settings, and
 * a switch applies to the super admin too, so Settings is the one way back from
 * a switch turned off by mistake.
 *
 * The frontend mirrors these keys on its menu entries (components/layout/nav.js);
 * a test keeps the two lists the same.
 */
const FEATURES = Object.freeze([
  { key: "home", label: "Home", group: "Travel", path: "/dashboard" },
  { key: "book", label: "Book a Ticket", group: "Travel", path: "/dashboard/book" },
  { key: "bookings", label: "My Bookings", group: "Travel", path: "/dashboard/bookings" },
  { key: "wallet", label: "Wallet", group: "Travel", path: "/dashboard/wallet" },
  { key: "refunds", label: "My Returns", group: "Travel", path: "/dashboard/refunds" },
  { key: "requests", label: "Requests", group: "Travel", path: "/dashboard/requests" },
  { key: "subscriptions", label: "Subscriptions", group: "Travel", path: "/dashboard/subscriptions" },
  { key: "notifications", label: "Notifications", group: "Travel", path: "/dashboard/notifications" },
  { key: "profile", label: "My Profile", group: "Travel", path: "/dashboard/profile" },
  { key: "checker", label: "Check Tickets", group: "Operations", path: "/dashboard/checker" },
  { key: "departures", label: "Departures", group: "Operations", path: "/dashboard/departures" },
  { key: "inventory", label: "Seat Inventory", group: "Operations", path: "/dashboard/inventory" },
  { key: "reports", label: "Reported Tickets", group: "Operations", path: "/dashboard/reports" },
  { key: "network", label: "Network", group: "Operations", path: "/dashboard/network" },
  { key: "plans", label: "Seat Plans", group: "Operations", path: "/dashboard/plans" },
  { key: "approvals", label: "Approvals", group: "Operations", path: "/dashboard/approvals" },
  { key: "users", label: "Users", group: "Administration", path: "/dashboard/users" },
  { key: "roles", label: "Roles", group: "Administration", path: "/dashboard/roles" },
  { key: "reference", label: "Reference Data", group: "Administration", path: "/dashboard/reference" },
  { key: "audit", label: "Audit Log", group: "Administration", path: "/dashboard/audit" },
  { key: "jobs", label: "Background Jobs", group: "Administration", path: "/dashboard/jobs" },
  { key: "railway-data", label: "Railway Data", group: "Administration", path: "/dashboard/railway-data" },
  { key: "demo-data", label: "Demo Data", group: "Administration", path: "/dashboard/demo-data" },
]);

const FEATURE_KEYS = Object.freeze(FEATURES.map((f) => f.key));

/** off_some: off for the users and roles chosen, on for everyone else. */
const SWITCH_STATES = Object.freeze({ ON: "on", OFF_ALL: "off_all", OFF_SOME: "off_some" });

/**
 * Which features each API endpoint serves.
 *
 * A request is refused only when *every* feature it serves is off for the
 * caller. Many endpoints serve more than one tab — the station list, a
 * background job's progress — and switching one tab off must not break another
 * that is still on. So an endpoint lists every tab whose screens call it.
 *
 * The lists were drawn up by following each tab's page through its components
 * to the API calls they make. An endpoint no tab calls belongs to the tab whose
 * data it is.
 *
 * First match wins, so the narrow patterns come before the wide ones. Patterns:
 * `:x` is one path segment, a trailing `/**` is anything below (or nothing),
 * and the method is `*`, one method, or several separated by commas.
 *
 * Signed-in routes left out on purpose are never refused (see ALWAYS_OPEN):
 * signing in and out, /auth/me, Settings, the switches themselves, and the
 * profile and restriction of a person, which a name anywhere in the app opens.
 */
const FEATURE_ROUTES = Object.freeze([
  // Reporting a ticket happens at the checker; reviewing is Reported Tickets.
  // An account's standing is also shown, and changed, from Users.
  ["*", "/abuse/accounts/:x/standing", ["reports", "users"]],
  ["*", "/abuse/accounts/:x/hold", ["reports", "users"]],
  ["*", "/abuse/accounts/:x/release", ["reports", "users"]],
  ["POST", "/abuse/reports", ["checker"]],
  ["*", "/abuse/**", ["reports"]],

  ["*", "/approvals/**", ["requests"]],
  ["*", "/audit/**", ["audit"]],

  // The passenger's details: kept on My Profile, filled in at checkout.
  ["*", "/auth/profile", ["profile", "book"]],

  ["POST", "/bookings", ["book"]],
  ["POST", "/bookings/quote", ["book"]],
  ["GET", "/bookings", ["bookings"]],
  ["*", "/bookings/**", ["bookings", "book"]],

  ["POST", "/holds", ["book"]],
  ["POST", "/holds/auto", ["book"]],
  ["POST", "/holds/preview", ["book"]],
  ["*", "/holds/**", ["book", "bookings"]],

  ["POST", "/waitlist", ["book"]],
  ["*", "/waitlist/**", ["book", "bookings"]],

  ["*", "/wallet/verify", ["wallet", "book"]],
  ["*", "/wallet/**", ["wallet"]],

  ["*", "/demo-data/**", ["demo-data"]],
  ["*", "/railway-data/**", ["railway-data"]],

  // Following a job's progress is how several tabs show long work finishing.
  ["GET", "/jobs/:x", ["jobs", "departures", "railway-data", "demo-data"]],
  ["*", "/jobs/**", ["jobs"]],

  ["*", "/notifications/**", ["notifications"]],

  ["*", "/refunds/**", ["refunds"]],
  // Returning, transferring and standing tickets start from My Bookings.
  ["*", "/tickets/**", ["bookings"]],

  // Trips: Departures manages them; Seat Inventory reads them and owns the seats.
  ["GET", "/trips/jobs", ["departures"]],
  ["GET", "/trips", ["departures", "inventory"]],
  ["GET", "/trips/:x", ["departures", "inventory"]],
  ["GET", "/trips/:x/seats", ["departures", "inventory"]],
  ["*", "/trips/:x/availability/**", ["inventory"]],
  ["*", "/trips/:x/occupancy", ["inventory"]],
  ["*", "/trips/:x/quota/**", ["inventory"]],
  ["*", "/trips/:x/seats/:x/**", ["inventory"]],
  ["*", "/trips/**", ["departures"]],
  ["*", "/quota/**", ["inventory"]],

  // A train's line-up and running days are edited in Network, used by Departures.
  ["*", "/trains/:x/composition", ["network", "departures"]],
  ["*", "/trains/:x/schedule", ["network", "departures"]],
  ["GET", "/trains", ["network", "departures"]],
  ["GET", "/trains/:x", ["network", "departures"]],
  ["*", "/trains/**", ["network"]],
  ["*", "/stations/**", ["network"]],
  ["*", "/fares/**", ["network"]],
  ["GET", "/seat-attributes/**", ["network", "plans"]],
  ["*", "/seat-attributes/**", ["network"]],

  // Coach classes and types fill the dropdowns in fares and seat plans.
  ["GET", "/reference/**", ["reference", "network", "plans"]],
  ["*", "/reference/**", ["reference"]],

  ["GET", "/roles", ["roles", "users"]],
  ["*", "/roles/**", ["roles"]],

  ["GET", "/search/stations", ["book", "checker"]],
  ["*", "/search/**", ["book"]],

  // Seat plans are listed wherever coaches are chosen.
  ["GET", "/plans", ["plans", "approvals", "departures", "network"]],
  ["GET", "/plans/:x", ["plans", "approvals"]],
  ["POST", "/plans/:x/approve", ["approvals"]],
  ["POST", "/plans/:x/reject", ["approvals"]],
  ["*", "/plans/**", ["plans"]],

  ["*", "/subscriptions/**", ["subscriptions"]],

  ["*", "/users/:x/profile", null],
  ["*", "/users/:x/restrict", null],
  ["*", "/users/:x/lift-restriction", null],
  ["*", "/users/**", ["users"]],

  ["*", "/verify/**", ["checker"]],
]);

/**
 * Signed-in routes no switch ever refuses. Listed so a test can tell a route
 * left open on purpose from one somebody forgot to place.
 */
const ALWAYS_OPEN = Object.freeze([
  ["*", "/auth/**"],
  ["*", "/settings/**"],
  ["*", "/features/**"],
  ["*", "/meta/**"],
]);

/** "/trips/:x/seats/**" → a RegExp over the path below /api/v1. */
function compilePath(pattern) {
  const wide = pattern.endsWith("/**");
  const body = (wide ? pattern.slice(0, -3) : pattern)
    .split("/")
    .map((part) => (part === ":x" ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${body}${wide ? "(?:/.*)?" : ""}/?$`);
}

const compile = (method, pattern) => ({
  methods: method === "*" ? null : new Set(method.split(",").map((m) => m.trim().toUpperCase())),
  regex: compilePath(pattern),
  pattern: `${method} ${pattern}`,
});

const ROUTE_RULES = FEATURE_ROUTES.map(([method, pattern, features]) => ({ ...compile(method, pattern), features }));
const OPEN_RULES = ALWAYS_OPEN.map(([method, pattern]) => compile(method, pattern));

const matches = (rule, method, path) => (!rule.methods || rule.methods.has(method)) && rule.regex.test(path);

/**
 * The features a request serves, or null when no switch applies to it.
 * `path` is below the API's base: "/wallet/transactions", not "/api/v1/…".
 */
function featuresFor(method, path) {
  const m = String(method).toUpperCase();
  const clean = String(path).split("?")[0].replace(/\/+$/, "") || "/";
  const rule = ROUTE_RULES.find((r) => matches(r, m, clean));
  return rule ? rule.features : null;
}

/** Whether a route is one of those left open on purpose. */
function isAlwaysOpen(method, path) {
  const m = String(method).toUpperCase();
  const clean = String(path).split("?")[0].replace(/\/+$/, "") || "/";
  return OPEN_RULES.some((r) => matches(r, m, clean)) || ROUTE_RULES.some((r) => r.features === null && matches(r, m, clean));
}

module.exports = {
  FEATURES,
  FEATURE_KEYS,
  SWITCH_STATES,
  FEATURE_ROUTES,
  ALWAYS_OPEN,
  featuresFor,
  isAlwaysOpen,
  compilePath,
};
