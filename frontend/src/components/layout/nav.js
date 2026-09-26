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
 */
export const NAV_GROUPS = [
  {
    key: "travel",
    label: "Travel",
    items: [
      { href: "/dashboard", label: "Home", icon: "pi pi-home" },
      {
        href: "/dashboard/book",
        label: "Book a Ticket",
        icon: "pi pi-ticket",
        permission: PERMISSIONS.BOOKING_CREATE,
        blurb: "Find a train and choose your seats",
      },
      {
        href: "/dashboard/bookings",
        label: "My Bookings",
        icon: "pi pi-bookmark",
        permission: PERMISSIONS.BOOKING_CREATE,
        blurb: "Tickets, PDFs and QR codes",
      },
      {
        href: "/dashboard/wallet",
        label: "Wallet",
        icon: "pi pi-wallet",
        permission: PERMISSIONS.BOOKING_CREATE,
        blurb: "Balance and one-click payment",
      },
      {
        href: "/dashboard/refunds",
        label: "My Returns",
        icon: "pi pi-undo",
        permission: PERMISSIONS.REFUND_REQUEST,
        blurb: "Tickets you gave back",
      },
      {
        // No permission: a passenger sees their own requests, a reviewer the queue.
        href: "/dashboard/requests",
        label: "Requests",
        icon: "pi pi-inbox",
        blurb: "Transfers and withdrawals",
      },
      {
        href: "/dashboard/profile",
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
        label: "Check Tickets",
        icon: "pi pi-qrcode",
        permission: PERMISSIONS.TICKET_VERIFY,
        blurb: "Scan a QR or type a ticket number",
      },
      {
        href: "/dashboard/departures",
        label: "Departures",
        icon: "pi pi-calendar-clock",
        permission: PERMISSIONS.TRIP_VIEW,
        blurb: "Services, coaches and cancellations",
      },
      {
        href: "/dashboard/inventory",
        label: "Seat Inventory",
        icon: "pi pi-table",
        permission: PERMISSIONS.INVENTORY_VIEW,
        blurb: "Who holds which seat, stretch by stretch",
      },
      {
        href: "/dashboard/reports",
        label: "Reported Tickets",
        icon: "pi pi-flag",
        permission: PERMISSIONS.ABUSE_REVIEW,
        blurb: "Review queue and account standing",
      },
      {
        href: "/dashboard/network",
        label: "Network",
        icon: "pi pi-directions",
        permission: PERMISSIONS.NETWORK_VIEW,
        blurb: "Stations, trains, routes and fares",
      },
      {
        href: "/dashboard/plans",
        label: "Seat Plans",
        icon: "pi pi-th-large",
        blurb: "Coach layouts",
      },
      {
        href: "/dashboard/approvals",
        label: "Approvals",
        icon: "pi pi-check-square",
        permission: PERMISSIONS.PLAN_APPROVE,
        blurb: "Plans waiting for sign-off",
      },
    ],
  },
  {
    key: "admin",
    label: "Administration",
    items: [
      {
        href: "/dashboard/users",
        label: "Users",
        icon: "pi pi-users",
        permission: PERMISSIONS.USER_VIEW,
        blurb: "Accounts and their roles",
      },
      {
        href: "/dashboard/roles",
        label: "Roles",
        icon: "pi pi-shield",
        permission: PERMISSIONS.ROLE_VIEW,
        blurb: "What each role may do",
      },
      {
        href: "/dashboard/reference",
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
        label: "Audit Log",
        icon: "pi pi-history",
        permission: PERMISSIONS.AUDIT_VIEW,
        blurb: "Every privileged action, recorded",
      },
      {
        href: "/dashboard/jobs",
        label: "Background Jobs",
        icon: "pi pi-server",
        permission: PERMISSIONS.JOB_VIEW,
        blurb: "Refunds and messages still running",
      },
    ],
  },
];

/** The groups a person can see, with empty groups dropped. */
export function visibleGroups(hasPermission) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || hasPermission(item.permission)),
  })).filter((group) => group.items.length);
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
