import { PERMISSIONS } from "@/constants/permissions";

/**
 * Every place in the app, in three groups.
 *
 * It used to be one flat list of twenty links. Grouping it is not decoration:
 * a passenger never needs to scroll past "Reference Data" and "Audit Log" to
 * find their bookings, and somebody running the railway can see at a glance
 * which of their tools are operational and which are administrative.
 *
 * Each entry carries a one-line `blurb` so the home page can describe the
 * tools a person has without a second, drifting copy of this list.
 *
 * `permission` hides an entry from anybody who could not use it anyway — the
 * API is the real guard; this only stops showing people doors they cannot open.
 *
 * `feature` names the switch that can turn the tab off (Settings → Features),
 * mirroring the backend's list in constants/features.js. Settings has none: it
 * is where the switches are, so it is always there for the super admin.
 */
export const NAV_GROUPS = [
  {
    key: "travel",
    label: "Travel",
    items: [
      { href: "/dashboard", feature: "home", label: "Home", icon: "pi pi-home" },
      {
        href: "/dashboard/book",
        feature: "book",
        label: "Book a Ticket",
        icon: "pi pi-ticket",
        permission: PERMISSIONS.BOOKING_CREATE,
        blurb: "Find a train and choose your seats",
      },
      {
        href: "/dashboard/bookings",
        feature: "bookings",
        label: "My Bookings",
        icon: "pi pi-bookmark",
        permission: PERMISSIONS.BOOKING_CREATE,
        blurb: "Tickets, PDFs and QR codes",
      },
      {
        href: "/dashboard/wallet",
        feature: "wallet",
        label: "Wallet",
        icon: "pi pi-wallet",
        permission: PERMISSIONS.BOOKING_CREATE,
        blurb: "Balance and one-click payment",
      },
      {
        href: "/dashboard/refunds",
        feature: "refunds",
        label: "My Returns",
        icon: "pi pi-undo",
        permission: PERMISSIONS.REFUND_REQUEST,
        blurb: "Tickets you gave back",
      },
      {
        // No permission: a passenger sees their own requests, a reviewer the queue.
        href: "/dashboard/requests",
        feature: "requests",
        label: "Requests",
        icon: "pi pi-inbox",
        blurb: "Transfers and withdrawals",
      },
      {
        // No permission: anyone signed in can ask for one; reviewers get the queue too.
        href: "/dashboard/subscriptions",
        feature: "subscriptions",
        label: "Subscriptions",
        icon: "pi pi-id-card",
        blurb: "Ask for one, and see how long yours runs",
      },
      {
        // Everyone has an inbox.
        href: "/dashboard/notifications",
        feature: "notifications",
        label: "Notifications",
        icon: "pi pi-bell",
        blurb: "Everything that happened, and what is waiting on you",
      },
      {
        href: "/dashboard/profile",
        feature: "profile",
        label: "My Profile",
        icon: "pi pi-user",
        blurb: "Name, NID and date of birth",
      },
    ],
  },
  {
    key: "operations",
    label: "Operations",
    items: [
      {
        href: "/dashboard/checker",
        feature: "checker",
        label: "Check Tickets",
        icon: "pi pi-qrcode",
        permission: PERMISSIONS.TICKET_VERIFY,
        blurb: "Scan a QR or type a ticket number",
      },
      {
        href: "/dashboard/departures",
        feature: "departures",
        label: "Departures",
        icon: "pi pi-calendar-clock",
        permission: PERMISSIONS.TRIP_VIEW,
        blurb: "Services, coaches and cancellations",
      },
      {
        href: "/dashboard/inventory",
        feature: "inventory",
        label: "Seat Inventory",
        icon: "pi pi-table",
        permission: PERMISSIONS.INVENTORY_VIEW,
        blurb: "Who holds which seat, stretch by stretch",
      },
      {
        href: "/dashboard/reports",
        feature: "reports",
        label: "Reported Tickets",
        icon: "pi pi-flag",
        permission: PERMISSIONS.ABUSE_REVIEW,
        blurb: "Review queue and account standing",
      },
      {
        href: "/dashboard/network",
        feature: "network",
        label: "Network",
        icon: "pi pi-directions",
        permission: PERMISSIONS.NETWORK_VIEW,
        blurb: "Stations, trains, routes and fares",
      },
      {
        href: "/dashboard/plans",
        feature: "plans",
        label: "Seat Plans",
        icon: "pi pi-th-large",
        blurb: "Coach layouts",
      },
      {
        href: "/dashboard/approvals",
        feature: "approvals",
        label: "Approvals",
        icon: "pi pi-check-square",
        permission: PERMISSIONS.PLAN_APPROVE,
        blurb: "Plans waiting for sign-off",
      },
      {
        href: "/dashboard/allocation",
        feature: "seat-allocation",
        label: "Seat Allocation",
        icon: "pi pi-chart-bar",
        permission: PERMISSIONS.ALLOCATION_VIEW,
        // While Seat Allocation is open to the public, everyone signed in sees it.
        orPublic: "seat-allocation",
        blurb: "Which pairs the railway gives seats to",
      },
    ],
  },
  {
    key: "admin",
    label: "Administration",
    items: [
      {
        href: "/dashboard/users",
        feature: "users",
        label: "Users",
        icon: "pi pi-users",
        permission: PERMISSIONS.USER_VIEW,
        blurb: "Accounts and their roles",
      },
      {
        href: "/dashboard/roles",
        feature: "roles",
        label: "Roles",
        icon: "pi pi-shield",
        permission: PERMISSIONS.ROLE_VIEW,
        blurb: "What each role may do",
      },
      {
        href: "/dashboard/reference",
        feature: "reference",
        label: "Reference Data",
        icon: "pi pi-database",
        permission: PERMISSIONS.REFERENCE_MANAGE,
        blurb: "Trains, coach types and classes",
      },
      {
        href: "/dashboard/settings",
        label: "Settings",
        icon: "pi pi-sliders-h",
        permission: PERMISSIONS.SETTING_VIEW,
        blurb: "Tunable rules and thresholds",
      },
      {
        href: "/dashboard/audit",
        feature: "audit",
        label: "Audit Log",
        icon: "pi pi-history",
        permission: PERMISSIONS.AUDIT_VIEW,
        blurb: "Every privileged action, recorded",
      },
      {
        href: "/dashboard/jobs",
        feature: "jobs",
        label: "Background Jobs",
        icon: "pi pi-server",
        permission: PERMISSIONS.JOB_VIEW,
        blurb: "Refunds and messages still running",
      },
      {
        href: "/dashboard/railway-data",
        feature: "railway-data",
        label: "Railway Data",
        icon: "pi pi-directions",
        permission: PERMISSIONS.RAILWAY_MANAGE,
        blurb: "Load the real timetable and seat plans",
      },
      {
        href: "/dashboard/demo-data",
        feature: "demo-data",
        label: "Demo Data",
        icon: "pi pi-box",
        permission: PERMISSIONS.DEMO_MANAGE,
        blurb: "Fill the system with sample data, or remove it",
      },
    ],
  },
];

/** The groups a person can see, with empty groups dropped. */
export function visibleGroups(hasPermission, isAvailable = () => true, isPublic = () => false) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (!item.permission || hasPermission(item.permission) || (item.orPublic && isPublic(item.orPublic))) &&
        (!item.feature || isAvailable(item.feature))
    ),
  })).filter((group) => group.items.length);
}

/** Where to land when Home is switched off: the first tab still there. */
export function firstVisibleHref(hasPermission, isAvailable, isPublic) {
  return visibleGroups(hasPermission, isAvailable, isPublic)[0]?.items[0]?.href || null;
}

/**
 * Whether a link is the current page.
 *
 * Matched on whole path segments, not characters: a plain startsWith would
 * light up "/dashboard/book" while the reader is on "/dashboard/bookings".
 */
export function isActive(href, pathname) {
  return href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname === href || pathname.startsWith(`${href}/`);
}

/** The group and item for the current page, for the header's breadcrumb. */
export function locate(pathname) {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => isActive(i.href, pathname));
    if (item) return { group, item };
  }
  return { group: null, item: null };
}
