/**
 * Audit action keys.
 *
 * Kept as a catalogue for the same reason permissions are: the admin screen
 * filters on them, and a typo in a string literal would silently create a
 * parallel action that nothing ever surfaces.
 */
const AUDIT_ACTIONS = Object.freeze({
  ROLE_CREATE: "role.create",
  ROLE_UPDATE: "role.update",
  ROLE_DELETE: "role.delete",
  USER_ROLES_UPDATE: "user.roles.update",
  SETTING_UPDATE: "setting.update",

  STATION_CREATE: "station.create",
  STATION_UPDATE: "station.update",
  STATION_DELETE: "station.delete",

  TRAIN_CREATE: "train.create",
  TRAIN_UPDATE: "train.update",
  ROUTE_UPDATE: "route.update",

  FARE_RULE_CREATE: "fare_rule.create",
  FARE_RULE_UPDATE: "fare_rule.update",
  FARE_RULE_DELETE: "fare_rule.delete",

  COMPOSITION_UPDATE: "composition.update",
  SCHEDULE_UPDATE: "schedule.update",
  TRIP_GENERATE: "trip.generate",
  TRIP_REBUILD: "trip.rebuild",
  TRIP_CANCEL: "trip.cancel",
  TRIP_REINSTATE: "trip.reinstate",

  QUOTA_RULE_CREATE: "quota_rule.create",
  QUOTA_RULE_UPDATE: "quota_rule.update",
  QUOTA_RULE_DELETE: "quota_rule.delete",
  QUOTA_SEAT_SET: "quota.seat.set",
  QUOTA_SEAT_CLEAR: "quota.seat.clear",
  QUOTA_MATERIALIZE: "quota.materialize",
  QUOTA_RELEASE: "quota.release",
  SEAT_BLOCK: "seat.block",
  SEAT_UNBLOCK: "seat.unblock",

  PROFILE_UPDATE: "profile.update",

  // Signing in and out of accounts. Failures are recorded as well as
  // successes: a run of failed sign-ins is the first thing to look for when
  // an account is being guessed at.
  AUTH_LOGIN: "auth.login",
  AUTH_LOGIN_FAILED: "auth.login_failed",
  AUTH_REGISTER: "auth.register",
  AUTH_VERIFY_EMAIL: "auth.verify_email",
  AUTH_PASSWORD_RESET_REQUEST: "auth.password_reset_request",
  AUTH_PASSWORD_RESET: "auth.password_reset",
  AUTH_PASSWORD_RESET_FAILED: "auth.password_reset_failed",

  WALLET_TOPUP: "wallet.topup",
  WALLET_ADJUST: "wallet.adjust",
  HOLD_CREATE: "hold.create",
  HOLD_RELEASE: "hold.release",
  HOLD_EXPIRE: "hold.expire",
  BOOKING_CREATE: "booking.create",
  STANDING_PURCHASE: "standing.purchase",
  STANDING_RELEASE: "standing.release",
  STANDING_OPTIONS: "standing.options",

  COACH_ADD: "coach.add",
  COACH_REMOVE: "coach.remove",
  COACH_CANCEL: "coach.cancel",
  COACH_REINSTATE: "coach.reinstate",

  TICKET_SCAN: "ticket.scan",
  TICKET_REPORT: "ticket.report",
  REPORT_UPHELD: "report.upheld",
  REPORT_DISMISSED: "report.dismissed",
  ACCOUNT_HOLD: "account.hold",
  ACCOUNT_RELEASE: "account.release",
  TICKET_SCAN_SYNC: "ticket.scan_sync",

  WAITLIST_JOIN: "waitlist.join",
  WAITLIST_OFFER: "waitlist.offer",
  WAITLIST_CONFIRM: "waitlist.confirm",
  WAITLIST_DECLINE: "waitlist.decline",
  WAITLIST_LAPSE: "waitlist.lapse",
  WAITLIST_WITHDRAW: "waitlist.withdraw",
  WAITLIST_CLOSE: "waitlist.close",

  REFUND_REQUEST: "refund.request",
  REFUND_SETTLE: "refund.settle",
  REFUND_CLOSE: "refund.close",
  REFUND_OPTIONS: "refund.options",
  REFUND_DISRUPTION: "refund.disruption",

  APPROVAL_REQUEST: "approval.request",
  APPROVAL_APPROVE: "approval.approve",
  APPROVAL_REJECT: "approval.reject",
  APPROVAL_CANCEL: "approval.cancel",

  TICKET_TRANSFER: "ticket.transfer",
  WALLET_WITHDRAW: "wallet.withdraw",

  SEAT_ATTRIBUTE_CREATE: "seat_attribute.create",
  SEAT_ATTRIBUTE_UPDATE: "seat_attribute.update",
  SEAT_ATTRIBUTE_DELETE: "seat_attribute.delete",

  JOB_FAILED: "job.failed",
  JOB_RETRY: "job.retry",

  // Demonstration data, filled in and taken away by the super admin.
  DEMO_POPULATE: "demo.populate",
  DEMO_CLEAR: "demo.clear",

  // The real railway timetable and seat plans, loaded by the super admin.
  RAILWAY_LOAD: "railway.load",

  // The daily sweep deleting long-departed trains' unsold seats.
  SEATS_CLEARED: "trip.seats_cleared",

  // Subscriptions: what can be subscribed to, and each person's subscription.
  SUBSCRIPTION_CREATE: "subscription.create",
  SUBSCRIPTION_UPDATE: "subscription.update",
  SUBSCRIPTION_DELETE: "subscription.delete",
  SUBSCRIPTION_REQUEST: "subscription.request",
  SUBSCRIPTION_APPROVE: "subscription.approve",
  SUBSCRIPTION_DECLINE: "subscription.decline",
  SUBSCRIPTION_CANCEL: "subscription.cancel",
  SUBSCRIPTION_EXTEND: "subscription.extend",
  SUBSCRIPTION_EXPIRE: "subscription.expire",

  // Every check from outside the app that got as far as an answer: who, from
  // which device, what came back valid — and when nothing did, the reason the
  // caller was never given. (A check refused at the password is auth.login_failed.)
  SUBSCRIPTION_CHECK: "subscription.check",

  // How many devices a subscription allows, the platforms there are, and the
  // devices seen on each account.
  SUBSCRIPTION_LIMITS: "subscription.limits",
  SUBSCRIPTION_PLATFORM_CREATE: "subscription.platform_create",
  SUBSCRIPTION_PLATFORM_UPDATE: "subscription.platform_update",
  SUBSCRIPTION_PLATFORM_DELETE: "subscription.platform_delete",
  SUBSCRIPTION_DEVICE_ADD: "subscription.device_add",
  SUBSCRIPTION_DEVICE_UPDATE: "subscription.device_update",
  SUBSCRIPTION_DEVICE_DELETE: "subscription.device_delete",

  // Sign-in paused on an account after too many wrong passwords in a row.
  AUTH_LOCKED: "auth.locked",
});

module.exports = { AUDIT_ACTIONS };
