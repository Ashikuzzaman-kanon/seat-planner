// Builds docs/FEATURES.md and docs/LEARNING-GOALS.md.
//
//   node tools/generate-guides.js
//
// Every code link is resolved here against the files as they are: a link names
// a file and a piece of text on the line to open at, and the line number is
// looked up. Anything not found stops the build, so no link in the documents
// points at a line that is not there — run this again after the code moves and
// the links follow it.
//
// The numbers the guides quote (permissions, settings, API paths, migrations,
// tests) are counted from the code as well, for the same reason.
const fs = require("fs");
const path = require("path");

const ROOT = require("path").resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs");

const texts = {};
function linesOf(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) throw new Error(`missing file: ${file}`);
  texts[file] ??= fs.readFileSync(full, "utf8").split(/\r?\n/);
  return texts[file];
}
function lineOf(file, find) {
  const i = linesOf(file).findIndex((l) => l.includes(find));
  if (i < 0) throw new Error(`${file}: "${find}" not found`);
  return i + 1;
}

/** A link from docs/ to a file, optionally opened at the line containing `find`. */
function L(label, file, find) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) throw new Error(`missing: ${file}`);
  const anchor = find ? `#L${lineOf(file, find)}` : "";
  return `[${label}](../${file}${anchor})`;
}

const B = "backend/src/";
const S = (name) => `${B}services/${name}.js`;
const F = "frontend/src/";
const M = (name) => `backend/migrations/${name}.js`;
const T = (name) => `backend/tests/unit/${name}.test.js`;
const SUITE = (name) => `backend/tests/integration/suites/${name}.js`;
const KOTLIN = (name) => `android/app/src/main/java/com/seatplanner/app/${name}.kt`;
const CI = ".github/workflows/ci.yml";
const ANDROID_CI = ".github/workflows/android.yml";
const RUNNER = "backend/tests/integration/run.js";

const code = (...links) => links.join(" · ");

/* ----------------------------------------------------------------------
 * What the guides count, counted
 * -------------------------------------------------------------------- */

const filesIn = (dir) => fs.readdirSync(path.join(ROOT, dir));
const openapi = require(path.join(ROOT, B, "docs/openapi.js"));
const COUNT = {
  permissions: linesOf(`${B}constants/permissions.js`).filter((l) => /^\s+key: PERMISSIONS\./.test(l)).length,
  settings: require(path.join(ROOT, B, "constants/settingDefinitions.js")).SETTING_DEFINITIONS.length,
  apiPaths: Object.keys((openapi.spec || openapi.default || openapi).paths).length,
  migrations: filesIn("backend/migrations").length,
  unitTests: filesIn("backend/tests/unit").reduce((n, f) => n + linesOf(`backend/tests/unit/${f}`).filter((l) => l.startsWith("test(")).length, 0),
  suites: filesIn("backend/tests/integration/suites").length,
};

/** One entry of either guide. Only the parts an entry has are written. */
function item(heading, e) {
  const part = (label, text) => (text ? ["", `**${label}.** ${text}`] : []);
  const where = part("Code", e.links);
  const talk = [...part("Explain", e.say), ...part("Nearest thing here", e.near)];
  return [
    `### ${heading}`,
    ...part("Topic", e.topic),
    ...part("In Seat Planner", e.app),
    ...part("Do", e.live),
    // A topic that is only explained leads with the talk; one with code leads with the code.
    ...(e.app || e.live ? [...where, ...talk] : [...talk, ...where]),
    ...part("Goal topics covered", e.goalTopics),
    ...part("Show it", e.demo),
    "",
  ].join("\n");
}

/**
 * The anchor GitHub gives a heading (the github-slugger rules, which VS Code's
 * preview follows too): lower-case, drop everything but letters, marks,
 * numbers, underscores, spaces and hyphens, then spaces become hyphens.
 */
const slug = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");

/* ======================================================================
 * FEATURES
 * ==================================================================== */

const features = [
  {
    section: "For passengers",
    items: [
      ["Search trains between any two stations", {
        topic: "Finding every train that calls at both stations, in that order, on a given day — including overnight services whose later stops fall on the next calendar day.",
        app: "The passenger search lists each departure whose route passes the two stations in order, with times worked out from each stop's day offset, the fare for every coach class, and how many seats are free for exactly that stretch. It is a separate API from the operators' departure board, so buying needs no operator permission. A train that has already left the station you board at is no longer offered, though someone boarding further along its route can still buy.",
        links: code(L("searchService.departures", S("searchService"), "async function departures("), L("searchRoutes.js", `${B}routes/searchRoutes.js`), L("JourneyStep.js", `${F}components/booking/JourneyStep.js`), L("Book a Ticket page", `${F}app/dashboard/book/page.js`), L("already-left rule", S("searchService"), "if (leaves && leaves <= now) continue;"), L("departed suite", SUITE("departed"))),
        demo: "Sign in as user1@example.com → *Book a Ticket* → Dhaka (Kamalapur) to Dinajpur.",
      }],
      ["Stretch-by-stretch seat inventory", {
        topic: "On a train with many stops one seat can be sold several times on the same run, to people travelling different stretches. Selling whole seats per train wastes most of the capacity.",
        app: "A sale takes one row per seat per leg between consecutive stops (`seat_segment_bookings`). A seat is free for a journey when none of the legs that journey covers are taken, so a train that is \"full end to end\" can still have room on yours.",
        links: code(L("inventoryService.segmentsForJourney", S("inventoryService"), "function segmentsForJourney("), L("inventoryService.reserveSegments", S("inventoryService"), "async function reserveSegments("), L("availabilityService.forJourney", S("availabilityService"), "async function forJourney("), L("SeatSegmentBooking model", `${B}models/SeatSegmentBooking.js`), L("segment migration", M("20260105000000-segment-inventory"))),
      }],
      ["\"Where is there room?\" matrix", {
        topic: "A grid of free seats for every from/to station pair on one departure — the quickest way to see where a busy train still has space.",
        app: "Computed from the same segment data as a single search, shown as a colour-scaled matrix to passengers and operators.",
        links: code(L("availabilityService.matrix", S("availabilityService"), "async function matrix("), L("AvailabilityMatrix.js", `${F}components/booking/AvailabilityMatrix.js`), L("PairMatrix.js", `${F}components/ui/PairMatrix.js`)),
        demo: "On a search result, open *Where is there room?*.",
      }],
      ["Seat map and automatic seat choice", {
        topic: "Choosing seats either by pointing at a coach map or by stating preferences and letting the system pick.",
        app: "Coach maps are drawn from each coach's approved layout. Auto-select honours criteria (window, charging port, fan), can keep a group together (side by side, then same row, nearby, same coach), and in strict mode refuses rather than compromise. Coach class and fare are shown wherever seats are compared.",
        links: code(L("autoSelect", `${B}utils/autoSelect.js`, "function autoSelect("), L("selectionService.selectAndHold", S("selectionService"), "async function selectAndHold("), L("SeatStep.js", `${F}components/booking/SeatStep.js`), L("CoachMap.js", `${F}components/booking/CoachMap.js`), L("autoSelect tests", T("autoSelect"))),
      }],
      ["Timed checkout hold, resumable anywhere", {
        topic: "Seats must be reserved briefly while someone pays, or two people can buy the same seat — but a reservation nobody finishes must not keep seats off sale.",
        app: "A hold takes the seat segments for a configurable number of minutes; a background job returns expired holds to sale. The hold reference lives in the URL, so a checkout resumes after a closed tab or on another device, and open checkouts are listed with a countdown.",
        links: code(L("holdService.create", S("holdService"), "async function create("), L("holdService.expireDue", S("holdService"), "async function expireDue("), L("hold.expire job", `${B}jobs/index.js`, 'register("hold.expire"'), L("OpenCheckouts.js", `${F}components/booking/OpenCheckouts.js`), L("HoldTimer.js", `${F}components/booking/HoldTimer.js`)),
      }],
      ["Paying: wallet, card or mobile banking, or a split", {
        topic: "Turning a held set of seats into tickets and taking the money for them, without ever charging twice or selling a seat twice.",
        app: "Pay from the wallet, by a simulated card or mobile-banking gateway, or a split of both. The booking, its tickets, the seat segments, the wallet debit and the payment record are written in one transaction, with the hold re-read under a row lock in case it expired while paying.",
        links: code(L("bookingService.create", S("bookingService"), "async function create("), L("paymentService.collect", S("paymentService"), "async function collect("), L("walletService.charge", S("walletService"), "async function charge("), L("PaymentStep.js", `${F}components/booking/PaymentStep.js`), L("FakeGatewayDialog.js", `${F}components/payment/FakeGatewayDialog.js`)),
      }],
      ["Tickets: signed QR code, PDF and email", {
        topic: "Proof of purchase that a checker can trust without trusting the person holding it.",
        app: "Each ticket's QR code carries an HMAC-signed token, so a forged or altered ticket fails verification even offline. Tickets come as a PDF (one page each) and by email with the PDF attached; the email is sent after the sale completes, so the passenger never waits on it.",
        links: code(L("ticketToken.sign", `${B}utils/ticketToken.js`, "function sign("), L("ticketToken.verify", `${B}utils/ticketToken.js`, "function verify("), L("ticketDocumentService.bookingPdf", S("ticketDocumentService"), "async function bookingPdf("), L("bookingService.deliver", S("bookingService"), "async function deliver("), L("ticketToken tests", T("ticketToken"))),
      }],
      ["Wallet", {
        topic: "A stored balance for one-click payment and for refunds to land in.",
        app: "An append-only ledger with a cached balance, updated under a row lock so simultaneous purchases cannot overspend it. Top-ups are simulated; withdrawals go to an approval queue; a balance cap applies; the ledger can be re-added to prove the balance.",
        links: code(L("walletService.post", S("walletService"), "async function post("), L("walletService.verify", S("walletService"), "async function verify("), L("Wallet page", `${F}app/dashboard/wallet/page.js`)),
        demo: "user1@example.com → *Wallet*.",
      }],
      ["Returning a ticket", {
        topic: "Giving a ticket back for money, under rules that are fair to the passenger and to the railway.",
        app: "Two policies. *Convenient*: refunded at once, less a deduction that grows as departure approaches (time slabs, with a floor and a cap). *Demand*: refunded segment by segment as the seat is resold — no resale, no refund. Each departure can switch either policy off.",
        links: code(L("refundPolicy.deductionPercentFor", `${B}utils/refundPolicy.js`, "function deductionPercentFor("), L("refundService.quote", S("refundService"), "async function quote("), L("refundService.request", S("refundService"), "async function request("), L("refundService.settleResold", S("refundService"), "async function settleResold("), L("ReturnTicketDialog.js", `${F}components/postsale/ReturnTicketDialog.js`), L("refundPolicy tests", T("refundPolicy"))),
        demo: "user1@example.com → *My Returns* shows one settled and one waiting on resale.",
      }],
      ["Transferring a ticket to someone else", {
        topic: "A ticket is valid only for the named passenger, so passing it on needs someone to approve the change.",
        app: "The holder asks for a transfer to a new name and National ID; it waits in an approval queue; approving reissues the ticket, re-checking inside the deciding transaction that it is still valid.",
        links: code(L("postSaleService.requestTransfer", S("postSaleService"), "async function requestTransfer("), L("approvalService.decide", S("approvalService"), "async function decide("), L("TransferTicketDialog.js", `${F}components/postsale/TransferTicketDialog.js`), L("Requests page", `${F}app/dashboard/requests/page.js`)),
        demo: "admin1@example.com → *Requests* has a transfer waiting.",
      }],
      ["Connecting standing ticket", {
        topic: "Letting a passenger travel beyond the stretch they have a seat for, standing, when no seat is free for the rest.",
        app: "A standing leg can join a seated ticket end to end. Standing capacity is set per coach class and enforced per segment; the fare is a share of the seated fare; standing follows its seat through a refund.",
        links: code(L("standing.roomFor", `${B}utils/standing.js`, "function roomFor("), L("standing.fareFor", `${B}utils/standing.js`, "function fareFor("), L("standingService.options", S("standingService"), "async function options("), L("standingService.purchase", S("standingService"), "async function purchase("), L("AddStandingDialog.js", `${F}components/postsale/AddStandingDialog.js`), L("standing tests", T("standing"))),
      }],
      ["Waitlist", {
        topic: "Queueing for a stretch that is sold out, so a seat that frees up goes to whoever asked first.",
        app: "Joining records the passengers' details up front. When a seat frees (a return, an abandoned checkout), the next person is offered it with a longer hold and an email; confirming is one click from the wallet.",
        links: code(L("waitlistService.join", S("waitlistService"), "async function join("), L("waitlistService.sweep", S("waitlistService"), "async function sweep("), L("waitlistService.offerTo", S("waitlistService"), "async function offerTo("), L("waitlistService.confirm", S("waitlistService"), "async function confirm("), L("JoinWaitlistDialog.js", `${F}components/booking/JoinWaitlistDialog.js`)),
      }],
      ["Accounts and travel profile", {
        topic: "Signing up, proving the email address is real, recovering a lost password, and recording the identity a ticket is issued to.",
        app: "Registration sends a 6-digit code; password reset signs out every other session. A name, National ID and date of birth are asked for once, before the first booking, and pre-fill every checkout after. After five wrong passwords in a row the account takes no password at all for fifteen minutes (both numbers are settings), so a password cannot be guessed at speed; resetting it ends the pause, and anyone already signed in stays signed in. Every sign-in, failure and reset is written to the audit log — never a password or a code.",
        links: code(L("authService.register", S("authService"), "async function register("), L("authService.login", S("authService"), "async function login("), L("authService.noteWrongPassword", S("authService"), "async function noteWrongPassword("), L("authService.resetPassword", S("authService"), "async function resetPassword("), L("authService.updateProfile", S("authService"), "async function updateProfile("), L("Register page", `${F}app/register/page.js`), L("Profile page", `${F}app/dashboard/profile/page.js`)),
      }],
      ["Notifications in the app", {
        topic: "Telling people what happened to their booking, their money or their request — somewhere that is still there after the email is lost.",
        app: "A bell in the top bar shows how many are unread, a panel shows the newest, and an inbox page lists everything, filtered by kind: a booking, a return paying out, a cancelled train, a seat offered from the waitlist, a request decided, a change of roles — and for staff, work waiting on them and background jobs finishing or failing. Each is written whether or not its email arrives. A key per event sits under a unique index, so a job that is retried cannot tell someone twice. An open tab asks for news every 30 seconds and shows a toast for anything new; old notifications are pruned after a number of days that is a setting.",
        links: code(L("inboxService.add", S("inboxService"), "async function add("), L("inboxService.toHolders", S("inboxService"), "async function toHolders("), L("one per event", M("20260120000000-notifications"), 'addIndex("notifications", ["user_id", "dedupe_key"]'), L("NotificationsContext.js", `${F}contexts/NotificationsContext.js`, "const POLL_MS"), L("NotificationBell.js", `${F}components/notifications/NotificationBell.js`), L("Notifications page", `${F}app/dashboard/notifications/page.js`)),
        demo: "user1@example.com → the bell in the top bar → *See all notifications*.",
      }],
      ["Subscriptions", {
        topic: "Access granted for a period rather than bought per journey: someone asks, someone else approves, and it ends by itself.",
        app: "Anyone signed in can ask for a subscription, saying on how many devices of each platform they will use it. It waits for a reviewer, then runs through the end of its last day in Dhaka. Whether it is valid is read from the clock every time it is looked at, never only from a status that a job sets; an hourly job marks the ended ones and warns the subscriber a few days before. The subscriber can withdraw a request or cancel at any time, sees their devices and how many places are used (to look at, not to change), and can ask again afterwards. A unique key allows one live request per person per subscription, so two clicks cannot make two.",
        links: code(L("subscriptionService.request", S("subscriptionService"), "async function request("), L("subscriptionService.cancel", S("subscriptionService"), "async function cancel("), L("UserSubscription.isValid", `${B}models/UserSubscription.js`, "isValid(now"), L("subscriptionPeriod.resolvePeriod", `${B}utils/subscriptionPeriod.js`, "function resolvePeriod("), L("subscription.sweep job", `${B}jobs/index.js`, 'register("subscription.sweep"'), L("one live request each", M("20260122000000-subscriptions"), 'addIndex("user_subscriptions", ["live_key"]'), L("SubscriptionList.js", `${F}components/subscriptions/SubscriptionList.js`), L("period tests", T("subscriptionPeriod"))),
        demo: "Super admin → *Subscriptions* → *New subscription*; then user1@example.com → *Subscriptions* → *Subscribe*.",
      }],
    ],
  },
  {
    section: "For staff on the train",
    items: [
      ["Checking tickets", {
        topic: "Deciding at the door whether a ticket is genuine, still valid, and for this train.",
        app: "Scan the QR with a phone camera or type the ticket number. Eight distinct verdicts, each with its own message (already used, refunded, transferred, wrong service…). *Scan* admits the passenger and marks the ticket used under a row lock; *check* only looks. Every attempt is logged, forgeries included.",
        links: code(L("verificationService.judge", S("verificationService"), "async function judge("), L("verificationService.resolve", S("verificationService"), "async function resolve("), L("QrScanner.js", `${F}components/checking/QrScanner.js`), L("Check Tickets page", `${F}app/dashboard/checker/page.js`)),
        demo: "checker1@example.com → *Check Tickets*; type a ticket number from user1's bookings.",
      }],
      ["Checking with no signal", {
        topic: "Trains lose signal; checking must carry on and reconcile later.",
        app: "A manifest downloaded before departure says which tickets have since been refunded, cancelled or used. Scans made offline are uploaded later; each carries the device's own reference, so a retried upload never counts a scan twice.",
        links: code(L("verificationService.manifest", S("verificationService"), "async function manifest("), L("verificationService.sync", S("verificationService"), "async function sync(")),
      }],
      ["Reporting, abuse score and account holds", {
        topic: "Catching people who misuse tickets, without punishing anyone on an accusation alone.",
        app: "A checker reports a ticket; a reviewer upholds or dismisses it. A score adds up upheld reports, duplicate scans and buy-and-return churn — every weight a setting. A hold stops an account buying and nothing else, is always reversible with a reason, and automatic holds are off by default.",
        links: code(L("abuseService.report", S("abuseService"), "async function report("), L("abuseService.review", S("abuseService"), "async function review("), L("abuseService.scoreFor", S("abuseService"), "async function scoreFor("), L("abuseService.hold", S("abuseService"), "async function hold("), L("Reported Tickets page", `${F}app/dashboard/reports/page.js`)),
        demo: "admin1@example.com → *Reported Tickets* has checker1's report.",
      }],
    ],
  },
  {
    section: "For operators",
    items: [
      ["Stations, trains and routes", {
        topic: "The network: which trains call where, when, and how far apart.",
        app: "A route builder records arrival and departure times, distances, and a day offset per stop — so an overnight train's stops after midnight fall on the right date everywhere downstream.",
        links: code(L("trainService.setRoute", S("trainService"), "async function setRoute("), L("RouteBuilder.js", `${F}components/network/RouteBuilder.js`), L("StationManager.js", `${F}components/network/StationManager.js`)),
        demo: "admin1@example.com → *Network* → Ekota Express (its later stops are on day +1).",
      }],
      ["Fares", {
        topic: "Pricing every station pair in every class without writing a price for each one.",
        app: "A chain of rules by priority: a published price table for particular pairs beats a per-kilometre fallback with a minimum fare. Rules can be scoped to a train and a class; a matrix previews the result.",
        links: code(L("fareService.resolveFare", S("fareService"), "async function resolveFare("), L("fareService.fareMatrix", S("fareService"), "async function fareMatrix("), L("FareManager.js", `${F}components/network/FareManager.js`)),
      }],
      ["Seat plan designer and approval", {
        topic: "Describing each coach's seat layout, and making sure nobody sells seats from a layout still being drawn.",
        app: "A grid editor for coach layouts with per-seat attributes (window, charging port, fan). A draft can be saved with nothing filled in — train, coach type, class and coach number are asked for only when it is submitted. Plans are submitted and approved or rejected; only approved plans can put seats into service.",
        links: code(L("PlanEditor.js", `${F}components/plans/PlanEditor.js`), L("SeatGrid.js", `${F}components/plans/SeatGrid.js`), L("normalizeLayout", `${B}utils/normalizeLayout.js`, "function normalizeLayout("), L("seatPlanService.missingForSubmit", S("seatPlanService"), "function missingForSubmit("), L("seatPlanService.approvePlan", S("seatPlanService"), "async function approvePlan(")),
        demo: "planner1@example.com → *Seat Plans*.",
      }],
      ["Compositions, schedules and the rolling horizon", {
        topic: "Turning \"this train runs Monday to Saturday with these coaches\" into concrete departures with sellable seats.",
        app: "Each train has a default coach list and a weekly schedule. A daily job keeps a configurable number of days of departures generated, copying the composition onto each one and materialising its seats from the approved layouts. It is idempotent — safe on a timer, on boot and by hand. The timer can be switched off in Settings, and *Departures → Generate…* builds departures for chosen trains and days instead.",
        links: code(L("compositionService.set", S("compositionService"), "async function set("), L("scheduleService.set", S("scheduleService"), "async function set("), L("tripService.generateHorizon", S("tripService"), "async function generateHorizon("), L("materializeSeats", `${B}utils/seatMaterializer.js`, "function materializeSeats("), L("trip.horizon job", `${B}jobs/index.js`, 'register("trip.horizon"'), L("GenerateDialog.js", `${F}components/departures/GenerateDialog.js`)),
      }],
      ["Running departures: cancel, reinstate, coaches", {
        topic: "What happens when a service or one coach cannot run — everyone aboard must get their money back and be told.",
        app: "Cancelling a departure or a single coach refunds every ticket in full through a background job, one email per passenger. Coaches can be added from approved plans, removed only if no ticket has ever used them, cancelled and reinstated; reinstating is refused while refunds are still being issued.",
        links: code(L("tripService.cancel", S("tripService"), "async function cancel("), L("coachService.cancel", S("coachService"), "async function cancel("), L("coachService.add", S("coachService"), "async function add("), L("TripCoachesDialog.js", `${F}components/departures/TripCoachesDialog.js`), L("RefundJobBanner.js", `${F}components/departures/RefundJobBanner.js`)),
        demo: "admin1@example.com → *Departures* → a departure → *Cancel*.",
      }],
      ["Seat inventory, quotas and blocks", {
        topic: "Seeing who holds each seat for which stretch, and keeping some seats back for particular journeys.",
        app: "A per-seat occupancy map shows every holder by stretch. Quota rules keep seats for a station pair and release them automatically a set time before departure; individual seats can be blocked.",
        links: code(L("availabilityService.occupancy", S("availabilityService"), "async function occupancy("), L("quotaService.materialiseForTrip", S("quotaService"), "async function materialiseForTrip("), L("quotaService.releaseDue", S("quotaService"), "async function releaseDue("), L("inventoryService.blockSeat", S("inventoryService"), "async function blockSeat("), L("SeatOccupancy.js", `${F}components/inventory/SeatOccupancy.js`)),
      }],
      ["Background jobs", {
        topic: "Work too big or too slow for one web request — a mass refund must survive a restart halfway through.",
        app: "Jobs are rows in a table, claimed under a renewable lease, retried with growing waits, de-duplicated per subject, and reported with progress. A screen shows what is running and what failed, and sends a failed job round again.",
        links: code(L("jobService.enqueue", S("jobService"), "async function enqueue("), L("jobService.claimNext", S("jobService"), "async function claimNext("), L("jobService.run", S("jobService"), "async function run("), L("job handlers", `${B}jobs/handlers.js`, 'jobs.define("refund.trip_cancellation"'), L("Background Jobs page", `${F}app/dashboard/jobs/page.js`)),
      }],
      ["Clearing out trains long gone", {
        topic: "Every seat of every departure is a row. Once a train has left, the seats nobody bought are most of what a small database holds, and nobody will ask about them again.",
        app: "A daily job clears the unsold seats of departures more than 90 days in the past (a setting) — one departure per transaction, oldest first, within a time budget, so a backlog is worked off over several runs rather than in one long lock. A seat that a ticket or a return points at always stays, and so does every booking, payment and refund. Each departure records when it was cleared and how many seats went, so a second pass skips it and what ran is still on record.",
        links: code(L("seatRetentionService.clearDeparted", S("seatRetentionService"), "async function clearDeparted("), L("seatRetentionService.clearTrip", S("seatRetentionService"), "async function clearTrip("), L("trip.clear_unsold_seats job", `${B}jobs/index.js`, 'register("trip.clear_unsold_seats"'), L("the 90 days", `${B}constants/settingDefinitions.js`, 'key: "trip.keep_unsold_seats_days"'), L("seats-cleared migration", M("20260121000000-trip-seats-cleared"))),
      }],
    ],
  },
  {
    section: "For administrators",
    items: [
      ["Roles and permissions as data", {
        topic: "Deciding who may do what, without hard-coding roles into the program.",
        app: `A catalogue of ${COUNT.permissions} permissions is synced to the database on every start. Roles are ordinary rows built from them, a user can hold several, and an escalation guard stops anyone granting a permission they do not hold. The super admin implicitly holds everything. Menus hide what a person cannot use; the API is the real guard. Someone whose roles change is told, by email and in the app, what changed, who changed it and what the account can do now.`,
        links: code(L("permission catalogue", `${B}constants/permissions.js`, "const PERMISSION_CATALOGUE"), L("roleService.assertCanGrantPermissions", S("roleService"), "function assertCanGrantPermissions("), L("permissionService.getAccess", S("permissionService"), "async function getAccess("), L("requirePermission", `${B}middleware/authorize.js`, "function requirePermission("), L("notificationService.rolesChanged", S("notificationService"), "async function rolesChanged("), L("Roles page", `${F}app/dashboard/roles/page.js`)),
      }],
      ["Settings", {
        topic: "Every rule that might need tuning — timeouts, deductions, thresholds — changeable without a new release.",
        app: `${COUNT.settings} typed settings with limits and descriptions, held in memory and changed at runtime from a settings screen.`,
        links: code(L("settingDefinitions.js", `${B}constants/settingDefinitions.js`), L("settingService.get", S("settingService"), "function get("), L("settingService.set", S("settingService"), "async function set("), L("Settings page", `${F}app/dashboard/settings/page.js`)),
      }],
      ["Audit log", {
        topic: "A trustworthy record of who did what, from where — the first place to look when something goes wrong.",
        app: "Every privileged action and every sign-in attempt is written to MongoDB with the actor, IP address, browser, and before/after values, and can be filtered on screen.",
        links: code(L("auditService.record", S("auditService"), "async function record("), L("requestContext", `${B}utils/requestContext.js`, "function runWithContext("), L("AuditEvent model", `${B}models/mongo/AuditEvent.js`), L("Audit Log page", `${F}app/dashboard/audit/page.js`)),
      }],
      ["Demo data", {
        topic: "Filling a system with realistic data to show it — and taking it away again without touching anything real.",
        app: "One button builds demo accounts, seat plans, a network, departures and sample bookings through the normal services; another deletes exactly what the demo created. Existing data is adopted, never modified; the delete refuses while someone outside the demo holds a valid ticket on a demo departure.",
        links: code(L("demoService.populate", S("demoService"), "async function populate("), L("demoService.clear", S("demoService"), "async function clear("), L("demoService.blockers", S("demoService"), "async function blockers("), L("demoCapture.install", `${B}utils/demoCapture.js`, "function install("), L("Demo Data page", `${F}app/dashboard/demo-data/page.js`)),
        demo: "Super admin → *Administration → Demo Data*.",
      }],
      ["The real railway", {
        topic: "Starting from a published timetable instead of typing in 149 trains.",
        app: "*Railway Data* loads Bangladesh Railway's timetable — 149 trains, their stations and routes — from a snapshot kept in the repository, with the seat plans transcribed from coach diagrams. Loading adds what is missing and never changes what is there, so it can be run again. The 50 trains whose plans are known get coaches, running days and per-kilometre fares, ready for departures; diagrams that name no train become draft plans. Distances are estimated from running times, since the timetable publishes none. It runs as a background job, never generates departures itself, and refuses while demo data exists, because the demo's stations share names with the real ones.",
        links: code(L("railwayService.load", S("railwayService"), "async function load("), L("timetable.timeline", `${B}utils/timetable.js`, "function timeline("), L("timetable.estimateDistances", `${B}utils/timetable.js`, "function estimateDistances("), L("timetable.json", `${B}data/railway/timetable.json`), L("seatPlans.js", `${B}data/railway/seatPlans.js`), L("Railway Data page", `${F}app/dashboard/railway-data/page.js`), L("timetable tests", T("timetable"))),
        demo: "Super admin → *Administration → Railway Data* → *Load*, on a database with no demo data.",
      }],
      ["Approving subscriptions, and the devices they are used on", {
        topic: "Deciding who gets a subscription, for how long and on how many devices — and seeing what actually uses it.",
        app: "Two permissions. One creates subscriptions and the platforms they are used on (Windows and Android to begin with; more are rows, not code). The other works the queue: approving sets the period — days from today, or a last day — and starts on the device counts that were asked for, which the reviewer may change then or later while it runs. Every decision locks the row first, so two reviewers cannot both act on one request. From *Subscribers* a reviewer opens an account's devices: what has signed in, a note of their own on each, block or remove, and every check that was turned away, with the reason the caller was never given.",
        links: code(L("subscriptionService.approve", S("subscriptionService"), "async function approve("), L("decision under a row lock", S("subscriptionService"), "const row = await UserSubscription.findByPk(id, { transaction, lock"), L("subscriptionService.amend", S("subscriptionService"), "async function amend("), L("deviceService.devicesOf", S("deviceService"), "async function devicesOf("), L("deviceService.createPlatform", S("deviceService"), "async function createPlatform("), L("RequestsQueue.js", `${F}components/subscriptions/RequestsQueue.js`), L("DevicesDialog.js", `${F}components/subscriptions/DevicesDialog.js`), L("Platforms.js", `${F}components/subscriptions/Platforms.js`)),
        demo: "Super admin → *Subscriptions* → *Requests* → *Approve*; then *Subscribers* → the devices icon on a row.",
      }],
    ],
  },
  {
    section: "Platform",
    items: [
      ["Sign-in sessions", {
        topic: "Keeping people signed in safely: short-lived credentials that can be revoked.",
        app: "A short-lived JWT access token plus a refresh token that is rotated on every use and stored only as a hash. The browser refreshes automatically, sharing one refresh between simultaneous requests. A password reset signs out every session.",
        links: code(L("tokenService.issueRefreshToken", S("tokenService"), "async function issueRefreshToken("), L("tokenService.rotateRefreshToken", S("tokenService"), "async function rotateRefreshToken("), L("auth middleware", `${B}middleware/auth.js`), L("api.js (refresh)", `${F}lib/api.js`, "async function refreshSession(")),
      }],
      ["Email", {
        topic: "Getting codes and tickets to people reliably, even where the host blocks ordinary mail ports.",
        app: "Mail goes through the Gmail API or Brevo over HTTPS in production, SMTP locally, or the console when nothing is configured. Every email shares one layout, and a tool renders each of them with sample data to look at after changing a template. Every send has a time limit, a failure asks the person to try again, and reserved test domains are never actually mailed.",
        links: code(L("emailService.sendMail", S("emailService"), "async function sendMail("), L("sendWithGmail", S("emailService"), "async function sendWithGmail("), L("isUnroutable", S("emailService"), "const isUnroutable"), L("the shared layout", `${B}emails/layout.js`), L("preview-emails.js", "tools/preview-emails.js"), L("email tests", T("emailGmail")), L("layout tests", T("emailLayout"))),
      }],
      ["API documentation", {
        topic: "A machine-readable description of every endpoint, its permissions and its responses.",
        app: `An OpenAPI 3 spec of ${COUNT.apiPaths} paths, served at \`/api/v1/openapi.json\`.`,
        links: code(L("openapi.js", `${B}docs/openapi.js`), L("served here", `${B}routes/index.js`, 'router.get("/openapi.json"')),
      }],
      ["Deployment", {
        topic: "Running the system somewhere other people can use it.",
        app: "Docker images for both halves; Docker Compose for self-hosting, with Caddy in front (it serves HTTPS automatically when given a domain); live on Vercel (web), Render (API), Aiven (MySQL) and MongoDB Atlas. Database migrations run on every start. Every branch and pull request also gets a preview address for the web app; previews call the same API, which admits them by a pattern in its CORS allow-list.",
        links: code(L("backend/Dockerfile", "backend/Dockerfile"), L("frontend/Dockerfile", "frontend/Dockerfile"), L("docker-compose.yml", "docker-compose.yml"), L("Caddyfile", "Caddyfile"), L("next.config.mjs (API proxy)", "frontend/next.config.mjs", "async rewrites()"), L("allowedOrigin.originPolicy", `${B}utils/allowedOrigin.js`, "function originPolicy(")),
      }],
      ["Responsive design system", {
        topic: "One interface that works as well on a checker's phone as on an operator's laptop.",
        app: "Design tokens and component styling in one theme; tables turn into cards on phones; every icon-only button has hover text; checked at laptop and phone width on every page.",
        links: code(L("theme.css", `${F}app/theme.css`), L("mobile.css", `${F}app/mobile.css`), L("DataTable.js", `${F}components/ui/DataTable.js`), L("tip.js", `${F}components/ui/tip.js`), L("DashboardShell.js", `${F}components/layout/DashboardShell.js`)),
      }],
      ["Subscription check for callers outside the app", {
        topic: "Letting another program ask \"does this person hold a valid subscription on this device?\" — without giving it a session, a reason, or a way to guess passwords quickly.",
        app: "One endpoint takes an email, a password, a device id and a platform, and answers with the account's name and a yes or no for every subscription: no dates, no tokens. It alone answers any origin; the rest of the API keeps its allow-list. The password is checked by the same function as sign-in and shares its pause, so there is no second, softer door to guess at. A subscription allows so many devices per platform: the first time a device checks in and a place is free it takes one, in the order devices arrived, with the account row locked so that two new devices cannot both take the last place. A device that is not let in — limit reached, blocked, unknown platform, missing id — is told only `valid: false`; the reason is kept for staff and never returned.",
        links: code(L("subscriptionController.check", `${B}controllers/subscriptionController.js`, "const check = asyncHandler("), L("one route open to any origin", `${B}app.js`, "const OPEN_TO_ANY_ORIGIN"), L("authService.checkCredentials", S("authService"), "function checkCredentials("), L("deviceService.admit", S("deviceService"), "async function admit("), L("subscriptionDevices.placeOf", `${B}utils/subscriptionDevices.js`, "function placeOf("), L("device-limit tests", T("subscriptionDevices")), L("device suite", SUITE("subscription-devices")), L("README: Subscriptions and the check API", "README.md")),
        demo: "The `curl` call under *Subscriptions and the check API* in the README.",
      }],
      ["Android app", {
        topic: "A phone app that needs no update when the site changes — and a way to point it at a developer's own computer without shipping that switch to everyone as a menu.",
        app: "The app is the live site in a full-screen WebView: the back button, pull to refresh, the camera for checking tickets, the tickets PDF in the phone's viewer. A hidden switch moves it to another server: scan a QR code on the *Open on phone* page of a site running locally (the same page installs the app from that computer), or hold three fingers on the screen for three seconds. It only ever switches to `localhost` or a private address, so a code from someone else cannot point it at another website. Android opens the switch link in the app because the site publishes a file naming the app's package and signing key. A tag builds, tests, signs and publishes the APK on GitHub Actions, with the key held in repository secrets.",
        links: code(L("MainActivity.kt", KOTLIN("MainActivity")), L("Servers.kt", KOTLIN("Servers")), L("ServerActivity.kt", KOTLIN("ServerActivity")), L("ThreeFingerHold.kt", KOTLIN("ThreeFingerHold")), L("Open on phone page", `${F}app/dev/phone/PhonePage.js`), L("assetlinks.json", "frontend/public/.well-known/assetlinks.json"), L("android.yml", ANDROID_CI), L("android/README.md", "android/README.md")),
        demo: "With `npm run dev` running: the account menu → *Open on phone*.",
      }],
      ["Waking a sleeping server", {
        topic: "A free-tier server sleeps when nobody is using it. The first visitor afterwards should see that it is starting — not an error, and not the sign-in page.",
        app: "A request that reaches the sleeping API through the web host's proxy is refused rather than waking it, so the browser wakes it itself with one direct request and shows that the server is starting. Every request refused meanwhile waits for that same wake-up and is then sent once more — only requests that provably never reached the API, so nothing can be bought twice. Reloading while it wakes no longer signs anyone out, and errors that come from the hosting platform are explained in words rather than as a status code.",
        links: code(L("api.js (wakeServer)", `${F}lib/api.js`, "function wakeServer()"), L("api.js (errors in words)", `${F}lib/api.js`, "function normalizeError("), L("ServerWaking.js", `${F}components/common/ServerWaking.js`), L("the wake address", "frontend/next.config.mjs", "NEXT_PUBLIC_WAKE_URL"), L("AuthContext.js", `${F}contexts/AuthContext.js`), L("wake check", "e2e/test-wake.js")),
      }],
      ["Tests and continuous integration", {
        topic: "Knowing that a change did not break something else, before it is merged.",
        app: `${COUNT.unitTests} unit tests cover the pure logic, and ${COUNT.suites} integration suites exercise the API over HTTP. The suites build a database of their own — its name must end in \`_test\` — snapshot it, and restore it before every suite, so each starts from the same data whatever ran before. Coverage is measured across both runs, and the build fails below 90% of lines and functions or 70% of branches. GitHub Actions runs all of it against MySQL and MongoDB on every pull request and every push to \`master\`, with a production build of the web app. Browser checks drive the running site at laptop and phone widths.`,
        links: code(L("ci.yml", CI), L("integration runner", RUNNER), L("snapshot and restore", RUNNER, "async function snapshot()"), L("coverage floors", "backend/package.json", '"coverage":'), L("unit tests", "backend/tests/unit"), L("integration suites", "backend/tests/integration/suites"), L("browser checks", "e2e/README.md")),
      }],
    ],
  },
];

/* ======================================================================
 * LEARNING GOALS
 *
 * Topics 1 to 27 are frozen: they have been presented, or prepared for
 * presenting, from exactly this wording. Do not edit, reorder or renumber
 * them, and add nothing in front of them — new topics go at the end. Their
 * code links still follow the code, which is the one thing about them that
 * may change. `npm`-style counts inside them are written out, not counted,
 * for the same reason.
 *
 * Topics 36 onward were added so that every sub-goal on the goal sheet has a
 * topic. SHEET, further down, is the goal sheet itself, mapped onto topics.
 * ==================================================================== */

const DONE = "✅";
const PART = "🟡";
const PLAN = "⏳";
const LIVE = "🎬";
const TALK = "💬";

/**
 * How many topics, from the first, must come out exactly as they were — and
 * the fingerprint of their text (line numbers in links aside, since those
 * follow the code). The build stops if the wording has drifted.
 */
const FROZEN = 27;
const FROZEN_FINGERPRINT = "5d550a814084ddd4";

const goals = [
  {
    section: "Database — SQL",
    items: [
      [DONE, "Transactions and row locking", {
        topic: "A transaction makes several statements succeed or fail together; a row lock stops another transaction changing a row until this one finishes.",
        app: "A purchase writes the booking, tickets, seat segments, wallet debit and payment in one transaction, re-reading the hold with `SELECT … FOR UPDATE` in case it expired meanwhile. Wallet rows are locked the same way, so five simultaneous purchases on one wallet cannot overspend it. Deciding a subscription request locks its row first too, so two reviewers cannot both act on it.",
        links: code(L("booking transaction", S("bookingService"), "const booking = await sequelize.transaction(async (transaction) => {"), L("hold locked FOR UPDATE", S("bookingService"), "lock: transaction.LOCK.UPDATE"), L("wallet row lock", S("walletService"), "lock: transaction.LOCK.UPDATE"), L("subscription decision lock", S("subscriptionService"), "const row = await UserSubscription.findByPk(id, { transaction, lock")),
      }],
      [DONE, "Constraints and referential integrity", {
        topic: "Foreign keys with the right delete rule (restrict, cascade, set null) and unique keys keep the data consistent whatever the code does.",
        app: "A booking can never lose its departure (RESTRICT); a departure's coaches and seats go with it (CASCADE); a train cannot run twice on one date, nor have two coaches in one position (UNIQUE). Above all, a seat can be sold only once per leg: the unique key on (seat, segment) is the last guard against double-selling, even when two purchases race. The same idea stops a person holding two live requests for one subscription: a key that is unique while the request is live and NULL once it has ended.",
        links: code(L("foreign-key helper", M("20260104000000-composition-and-trips"), "const fk = (table, onDelete"), L("one departure per train per date", M("20260104000000-composition-and-trips"), "trips_train_departure_date_unique"), L("one coach per position", M("20260104000000-composition-and-trips"), 'type: "unique"'), L("one sale per seat per leg", M("20260105000000-segment-inventory"), "seat_segment_bookings_seat_segment_unique"), L("booking tables", M("20260106000000-booking-and-payment")), L("one live request each", M("20260122000000-subscriptions"), 'addIndex("user_subscriptions", ["live_key"]')),
      }],
      [DONE, "Indexing", {
        topic: "Indexes shaped like the queries that use them.",
        app: "The job worker asks \"what is due?\" every few seconds, so the jobs table is indexed on exactly (status, run_after) and (status, lease_expires_at).",
        links: code(L("jobs indexes", M("20260117000000-jobs"), 'addIndex("jobs", ["status", "run_after"])')),
      }],
      [DONE, "Concurrency without holding locks", {
        topic: "Optimistic claiming: several workers race for the same row, and a conditional UPDATE decides the winner without anyone waiting on a lock.",
        app: "Workers read due jobs without locks, then claim one with `UPDATE … WHERE status = 'queued'`; whoever's update matches first owns it. A lease that is not renewed lets another worker take over a job whose worker died.",
        links: code(L("jobService.claimNext", S("jobService"), "async function claimNext("), L("lease heartbeat", S("jobService"), "const heartbeat = () =>")),
      }],
      [PLAN, "Partitioning", {
        topic: "Splitting a large table into parts by range (e.g. by date), so queries and clean-up touch only the parts they need.",
        app: "Planned for Phase 9. One design constraint shapes it: MySQL cannot partition a table that has foreign keys, so the likely candidate is an FK-free archive of past departures' seat rows, partitioned by departure date.",
        links: code(L("build plan, Phase 9", "REQUIREMENTS.md")),
      }],
    ],
  },
  {
    section: "ORM — Sequelize",
    items: [
      [DONE, "Complex querying: subqueries, grouping, filtered includes", {
        topic: "Expressing subqueries, GROUP BY and conditional joins through the ORM rather than raw SQL.",
        app: "Demo-data status counts rows through an `IN (subquery)`; what a run created is counted with `GROUP BY model`; valid tickets are found through a filtered include of their booking and its owner; availability aggregates over every station pair.",
        links: code(L("subquery", S("demoService"), "const trackedWhere"), L("GROUP BY", S("demoService"), "async function notedSince("), L("filtered include", S("demoService"), "async function liveBookings("), L("availabilityService.matrix", S("availabilityService"), "async function matrix(")),
      }],
      [DONE, "Transactions: commit and rollback", {
        topic: "Managed transactions commit when the callback finishes and roll back when it throws; hooks can run after a commit.",
        app: "Deleting demo data is one managed transaction — any refusal rolls every delete back. A job queued inside a transaction is only started after that transaction commits (`afterCommit`), so a job never runs for a change that was rolled back.",
        links: code(L("afterCommit", S("jobService"), "transaction.afterCommit"), L("all-or-nothing delete", S("demoService"), "await sequelize.transaction(async (transaction) => {"), L("tripService.cancel", S("tripService"), "async function cancel(")),
      }],
      [DONE, "Understanding the generated SQL", {
        topic: "Seeing the SQL the ORM actually sends, to catch inefficient or surprising queries.",
        app: "In development every statement Sequelize runs is printed to the console; production and the test run turn it off.",
        links: code(L("logging option", `${B}config/database.js`, "logging:")),
      }],
      [DONE, "Data seeding", {
        topic: "Loading reference and sample data repeatably.",
        app: "Command-line seeders build users, seat plans, the network and departures, idempotently. The in-app Demo Data button builds the same data through the normal services, and *Railway Data* loads the real railway's published timetable from a snapshot in the repository — adding what is missing, never changing what is there, so it too can run twice.",
        links: code(L("importSeatPlans.js", `${B}seeders/importSeatPlans.js`), L("seedNetwork.js", `${B}seeders/seedNetwork.js`), L("seedDepartures.js", `${B}seeders/seedDepartures.js`), L("demoService.populate", S("demoService"), "async function populate("), L("railwayService.load", S("railwayService"), "async function load("), L("the timetable snapshot", `${B}data/railway/timetable.json`)),
      }],
      [DONE, "Migrations, and debugging a migration", {
        topic: "Versioned schema changes, and getting a risky one right against real data.",
        app: "25 migrations run on every deploy. One converted the first release's single `users.role` column into roles-as-data on the live database; it was rehearsed against a copy of the old schema before it ran.",
        links: code(L("role-column migration", M("20260101000001-rbac-from-role-column")), L("migration folder", "backend/migrations")),
      }],
      [DONE, "Complex mappings and constraints", {
        topic: "Associations beyond one-to-many: many-to-many through a join table, several foreign keys to the same table, aliases.",
        app: "Roles and permissions are many-to-many through `role_permissions`; a booking has two station associations (`fromStation`, `toStation`) on one table.",
        links: code(L("Booking associations", `${B}models/Booking.js`, "Booking.associate"), L("Role belongsToMany", `${B}models/Role.js`, "Role.belongsToMany(Permission")),
      }],
      [DONE, "Lazy and eager loading", {
        topic: "Loading related rows in the same query (eager) or when first touched (lazy) — and the bugs a missing include causes.",
        app: "Departure generation eager-loads each train's coaches, their plans and schedules in one query. A missing include once made station names read \"undefined\" in the standing dialog; the fix was to eager-load `Station` in the route index.",
        links: code(L("inventoryService.routeIndex", S("inventoryService"), "async function routeIndex("), L("tripService.generateHorizon", S("tripService"), "async function generateHorizon(")),
      }],
      [DONE, "Object tracking and hooks", {
        topic: "Reacting to the ORM's lifecycle — every instance created, updated or destroyed.",
        app: "Global `afterCreate` / `afterBulkCreate` hooks note every row created while demo data is being built, in the same transaction as the row, so the demo can later be removed exactly.",
        links: code(L("demoCapture.install", `${B}utils/demoCapture.js`, "function install("), L("registered here", `${B}models/index.js`, "demoCapture.install")),
      }],
      [DONE, "Duplicate entries", {
        topic: "Avoiding, and reporting well, rows that already exist.",
        app: "Seeding uses `findOrCreate` so it can run twice; a unique-constraint violation anywhere is answered with a clear 409 instead of a crash. A notification carries a key per event under a unique index, so a job that is retried cannot tell someone twice; a device turned away again and again is one row whose count goes up (`INSERT … ON DUPLICATE KEY UPDATE`), not a row per attempt.",
        links: code(L("findOrCreate", S("demoService"), "findOrCreate({ where: { name }"), L("unique violation → 409", `${B}middleware/errorHandler.js`, "SequelizeUniqueConstraintError"), L("a notification told once", S("inboxService"), "async function add("), L("one row per refusal, counted", S("deviceService"), "ON DUPLICATE KEY UPDATE")),
      }],
      [DONE, "Caching", {
        topic: "Keeping frequently read, rarely changed data in memory — and knowing when to throw it away.",
        app: "Settings are loaded into memory at start and read synchronously. Each user's permissions are cached for 60 seconds and dropped the moment their roles change. The Gmail access token is reused until shortly before it expires. (Caching hot availability reads is Phase 9.)",
        links: code(L("settingService.get", S("settingService"), "function get("), L("permissionService.getAccess", S("permissionService"), "async function getAccess("), L("invalidateUser", S("permissionService"), "function invalidateUser("), L("gmailAccessToken", S("emailService"), "async function gmailAccessToken(")),
      }],
      [PART, "Repository pattern", {
        topic: "Hiding data access behind repository objects so business code does not depend on the ORM.",
        app: "Partly: a service layer owns all data access and controllers never touch models, but the services use Sequelize models directly rather than through repository interfaces.",
        links: code(L("services/", `${B}services`), L("a thin controller", `${B}controllers/jobController.js`)),
      }],
      [DONE, "Schema deployment strategy", {
        topic: "Getting schema changes onto a running system safely.",
        app: "The API's container runs pending migrations before it starts, so code and schema always arrive together.",
        links: code(L("Dockerfile CMD", "backend/Dockerfile", "CMD")),
      }],
    ],
  },
  {
    section: "NoSQL — MongoDB",
    items: [
      [DONE, "A document store beside the relational database", {
        topic: "Using a document database where records vary in shape and are written far more than they are changed.",
        app: "The audit log lives in MongoDB: each event stores different before/after snapshots, and the screen queries it by action, actor and entity.",
        links: code(L("AuditEvent model", `${B}models/mongo/AuditEvent.js`), L("auditService.query", S("auditService"), "async function query("), L("connection", `${B}config/mongo.js`)),
      }],
    ],
  },
  {
    section: "Logging",
    items: [
      [DONE, "Logging objects and structured records", {
        topic: "Writing log entries as structured data rather than sentences, so they can be searched and filtered.",
        app: "Audit events are structured documents: action, outcome, actor, entity, before, after, and the request's context.",
        links: code(L("auditService.record", S("auditService"), "async function record(")),
      }],
      [DONE, "Correlating entries to one request", {
        topic: "Tying every entry from one request together with an ID.",
        app: "Each request gets a request ID and the caller's identity in AsyncLocalStorage; every audit entry written during that request carries them, without passing them through every function.",
        links: code(L("runWithContext", `${B}utils/requestContext.js`, "function runWithContext("), L("request context middleware", `${B}middleware/requestContext.js`)),
      }],
      [PART, "Basic logging and log levels", {
        topic: "Info, warning and error levels, used consistently.",
        app: "Partly: the server uses `console.info` / `warn` / `error` with a prefix per area (`[email]`, `[jobs]`). A real logger with levels and JSON output is Phase 9.",
        links: code(L("email route logged at start", S("emailService"), 'say("[email] sending through the Gmail API")'), L("job worker errors", S("jobService"), "[jobs] worker loop error")),
      }],
      [PART, "Retention", {
        topic: "Keeping records only as long as they are useful.",
        app: "Partly: finished job records and old notifications are pruned after a configurable number of days, the record of subscription checks that were turned away is capped per account and dropped after ninety, and the unsold seats of trains long gone are cleared daily while everything with money or a journey behind it is kept. Log rotation is Phase 9.",
        links: code(L("jobService.prune", S("jobService"), "async function prune("), L("inboxService.prune", S("inboxService"), "async function prune("), L("deviceService.pruneRefusals", S("deviceService"), "async function pruneRefusals("), L("seatRetentionService.clearDeparted", S("seatRetentionService"), "async function clearDeparted(")),
      }],
      [PLAN, "Asynchronous logging, frameworks, rotation, distributed logging", {
        topic: "A logging library writing JSON asynchronously, rotated, and gathered from several processes.",
        app: "Phase 9, step 2: structured JSON logs (levels, request ID on every line, secrets redacted), searchable in Render.",
        links: code(L("build plan, Phase 9", "REQUIREMENTS.md")),
      }],
    ],
  },
  {
    section: "Unit testing",
    items: [
      [DONE, "Test-driven style on pure logic", {
        topic: "Writing tests for business rules as small pure functions, independent of the database.",
        app: "265 unit tests cover money arithmetic, refund percentages, segment overlap, seat auto-selection, standing capacity, ticket signing, job retry timing, timetable arithmetic, subscription periods and device limits.",
        links: code(L("refundPolicy tests", T("refundPolicy")), L("autoSelect tests", T("autoSelect")), L("money tests", T("money")), L("availability tests", T("availability")), L("timetable tests", T("timetable")), L("device-limit tests", T("subscriptionDevices"))),
      }],
      [DONE, "Testing asynchronous code", {
        topic: "Testing code that waits on the network: timeouts, retries, failures.",
        app: "Email delivery is tested against local HTTP servers standing in for Google and Brevo — including a server that never answers (the send gives up in time) and a rejected token (refreshed and retried once).",
        links: code(L("Gmail tests", T("emailGmail")), L("Brevo tests", T("emailBrevo"))),
      }],
      [DONE, "Code coverage and CI", {
        topic: "Measuring how much code the tests exercise, and running them automatically on every change.",
        app: "44 integration suites live in the repository beside the unit tests. They build a database of their own, snapshot it and restore it before every suite, and talk to the API over HTTP. Coverage is measured across the unit and integration runs together, and the build fails below 90% of lines and functions or 70% of branches. GitHub Actions runs all of it on every pull request and every push to `master`, against MySQL and MongoDB services, with a production build of the web app.",
        links: code(L("ci.yml", CI), L("integration runner", RUNNER), L("snapshot and restore", RUNNER, "async function snapshot()"), L("coverage floors", "backend/package.json", '"coverage":'), L("what is measured", "backend/.c8rc.json")),
      }],
    ],
  },
  {
    section: "Application deployment — Docker",
    items: [
      [DONE, "Dockerfile basics and dockerizing Node.js", {
        topic: "Building small, safe images for Node applications.",
        app: "The API image installs production dependencies only and runs as a non-root user; the web image is a two-stage build (build, then a slim runtime).",
        links: code(L("backend/Dockerfile", "backend/Dockerfile"), L("frontend/Dockerfile", "frontend/Dockerfile", "FROM node:20-alpine AS builder")),
      }],
      /* ---- everything above this line is frozen (topics 1 to 27) ---- */
      [DONE, "Docker Compose, environment, volumes and networking", {
        topic: "Running several containers together, configured from the environment, with data that outlives them.",
        app: "Compose runs MySQL, MongoDB, the API, the web app and Caddy. The API waits for the database's health check; data lives in named volumes; containers reach each other by service name; Caddy routes `/api` to the API and everything else to the web app, serving HTTPS when given a domain.",
        links: code(L("docker-compose.yml", "docker-compose.yml"), L("health check", "docker-compose.yml", "healthcheck"), L("Caddyfile", "Caddyfile"), L(".env.example", "backend/.env.example"), L("config/env.js", `${B}config/env.js`)),
      }],
    ],
  },
  {
    section: "Application deployment — cloud",
    items: [
      [DONE, "Cloud deployment", {
        topic: "Running across managed services.",
        app: "Web on Vercel, API on Render (Docker), MySQL on Aiven, audit log on MongoDB Atlas. The web app proxies `/api` to the API, so the browser only ever talks to one origin.",
        links: code(L("API proxy", "frontend/next.config.mjs", "async rewrites()"), L("README: Deployment", "README.md")),
      }],
      [DONE, "Security in deployment", {
        topic: "Keeping secrets and traffic safe once the system is public.",
        app: "TLS to the database; a CORS allow-list that admits the project's own preview deployments by pattern, with one endpoint deliberately open to any origin because nothing of the browser's own goes with a call to it; secrets only in environment variables, and the Android app's signing key only in repository secrets; mail sent over HTTPS because the host blocks SMTP.",
        links: code(L("database TLS", `${B}config/database.js`, "ssl:"), L("CORS allow-list", `${B}utils/allowedOrigin.js`, "function originPolicy("), L("the one open route", `${B}app.js`, "const OPEN_TO_ANY_ORIGIN"), L("email over HTTPS", S("emailService"), "async function sendWithGmail(")),
      }],
      [PART, "CI/CD", {
        topic: "Building, testing and deploying automatically from the repository.",
        app: "Partly: GitHub Actions runs the tests, the coverage floors and a production build of the web app on every pull request and every push to `master`, and a tag builds, tests, signs and publishes the Android app. Vercel deploys the web app on every push; the API deploy is started by hand. Nothing yet makes a deploy wait for the checks to pass.",
        links: code(L("ci.yml", CI), L("android.yml", ANDROID_CI), L("README: Deployment", "README.md")),
      }],
      [PART, "Rollback and disaster recovery", {
        topic: "Undoing a bad release, and recovering lost data.",
        app: "Partly: every migration has a `down` step. Scheduled database backups are still to do.",
        links: code(L("a down() step", M("20260117000000-jobs"), "async down(")),
      }],
      [PART, "Monitoring", {
        topic: "Knowing the system is healthy before users say otherwise.",
        app: "Partly: a health endpoint answers whether the API is up, and the web app calls it to wake a sleeping server and to know when it is back. Background work is watched from inside the app — a screen lists what is running and what failed, and a job that gives up notifies the staff who can send it round again. A script signs in on the live site after the API has slept and records what happened.",
        links: code(L("health endpoint", `${B}routes/index.js`, 'router.get("/health"'), L("a failed job tells staff", S("jobService"), "Background job failed"), L("Background Jobs page", `${F}app/dashboard/jobs/page.js`), L("prod-wake-check.js", "tools/prod-wake-check.js")),
        say: "There are no metrics, no uptime check and no alert outside the app — those are Phase 9, step 5. Say what is missing: the four golden signals (latency, traffic, errors, saturation), a metrics endpoint that something like Prometheus scrapes, an outside check of the health endpoint, and alerts that reach a person. The logging half of this sub-goal is the Logging topics.",
      }],
    ],
  },
  {
    section: "Also exercised",
    items: [
      [DONE, "Concurrency and isolation", {
        topic: "Many people acting on the same seats and money at the same moment.",
        app: "Seat holds claim segments atomically — the unique key on (seat, segment) makes the loser of a race fail cleanly — wallet rows are locked, background jobs use leases with heartbeats, and de-duplication keys stop two clicks queueing two mass refunds. A device takes a place on a subscription with the account's row locked, so of six new devices arriving together exactly one gets the last place; password checks for one email run one at a time, so a burst of guesses is counted in order.",
        links: code(L("holdService.create", S("holdService"), "async function create("), L("seat-segment unique key", M("20260105000000-segment-inventory"), "seat_segment_bookings_seat_segment_unique"), L("job de-duplication", S("jobService"), "if (dedupeKey)"), L("lease heartbeat", S("jobService"), "const heartbeat = () =>"), L("a place taken under a lock", S("deviceService"), 'await User.findByPk(user.id, { attributes: ["id"], transaction, lock'), L("one password check at a time", S("authService"), "function oneAtATime(")),
      }],
      [DONE, "Authentication and authorization", {
        topic: "Proving who someone is, and deciding what they may do.",
        app: "Hashed passwords, short-lived JWTs with rotating refresh tokens, and permissions as data with an escalation guard. Sign-in pauses for an account after a run of wrong passwords. A caller outside the app can check a subscription with an email and password — through the same check as sign-in, pause included — and is given no session.",
        links: code(L("tokenService.rotateRefreshToken", S("tokenService"), "async function rotateRefreshToken("), L("escalation guard", S("roleService"), "function assertCanGrantPermissions("), L("the pause after wrong passwords", S("authService"), "async function noteWrongPassword("), L("one check for sign-in and outside callers", S("authService"), "function checkCredentials(")),
      }],
    ],
  },

  /* --------------------------------------------------------------------
   * From here on: added so that every sub-goal on the goal sheet has a topic.
   * In an entry's text, {{A topic's title}} becomes a link to that topic.
   * ------------------------------------------------------------------ */
  {
    section: "Application deployment — the rest of the goal sheet",
    items: [
      [PART, "Deployment Strategies", {
        topic: "How a new version takes over from the old one: all at once (recreate), instance by instance (rolling), a second copy that traffic is switched to (blue-green), or a small share of traffic first (canary).",
        app: "Partly. The web app is released blue-green style by its host: every push is built as its own immutable deployment, the public address moves to it only once it is ready, and earlier deployments stay available to switch back to. Every branch and pull request gets a preview address before anything reaches production. The API is replaced by a container built from the new commit, which applies pending migrations before it serves — the schema side is topic {{Schema deployment strategy}}.",
        links: code(L("README: Deployment", "README.md"), L("migrations, then start", "backend/Dockerfile", "CMD"), L("previews admitted by pattern", `${B}utils/allowedOrigin.js`, "function originPolicy(")),
        say: "Rolling and canary releases need several instances behind a load balancer, and there is one API instance here. Say what each strategy is, what it costs (two copies running for blue-green, routing rules for canary), and why a schema change has to stay compatible with the old code while both versions run: expand, migrate, contract.",
      }],
      [DONE, "Deployment Tools and Technologies", {
        topic: "The tools that build, ship and run the system, and what each one is for.",
        app: "Docker builds the two images and Docker Compose runs the whole stack; Caddy is the reverse proxy and obtains HTTPS certificates; Vercel hosts the web app, Render the API container and Aiven the MySQL database; GitHub Actions tests every change and builds the Android release; sequelize-cli applies the schema migrations; Gradle builds the Android app.",
        links: code(L("backend/Dockerfile", "backend/Dockerfile"), L("docker-compose.yml", "docker-compose.yml"), L("Caddyfile", "Caddyfile"), L("ci.yml", CI), L("android.yml", ANDROID_CI), L("the migrate command", "backend/package.json", '"migrate":'), L("the Android build", "android/app/build.gradle.kts")),
      }],
      [DONE, "On-Premises Deployment", {
        topic: "Running the whole system on a server you own, with no managed services.",
        app: "The Compose file of topic {{Docker Compose, environment, volumes and networking}} is the on-premises deployment: MySQL, MongoDB, the API, the web app and Caddy on a single machine, from one command. Given a domain name, Caddy serves HTTPS by itself; data lives in named volumes that outlive the containers; everything is configured from one `.env` file.",
        links: code(L("docker-compose.yml", "docker-compose.yml"), L("Caddyfile", "Caddyfile"), L(".env.example", "backend/.env.example"), L("README: Everything in Docker", "README.md")),
        demo: "`docker compose up --build`, then open http://localhost.",
      }],
      [PART, "Containerization and Orchestration", {
        topic: "Packaging each part with what it needs to run (a container), and running many containers as one system: start order, restarts, networking, scaling (orchestration).",
        app: "Partly. The containers are topics {{Dockerfile basics and dockerizing Node.js}} and {{Docker Compose, environment, volumes and networking}}. Compose is orchestration on one machine: the API waits for the database's health check before starting, every service restarts unless stopped, and containers find each other by service name on a private network.",
        links: code(L("start order", "docker-compose.yml", "condition: service_healthy"), L("restart policy", "docker-compose.yml", "restart: unless-stopped")),
        say: "Orchestration across several machines is not here. Say what Kubernetes adds — scheduling onto nodes, replicas and scaling, self-healing, rolling updates, service discovery and ingress — and how this stack would map onto it: each Compose service becomes a Deployment with a Service, Caddy becomes the Ingress, the volumes become persistent volume claims, and the `.env` file becomes ConfigMaps and Secrets.",
      }],
      [DONE, "Best Practices for Application Deployment", {
        topic: "The habits that make a deploy uneventful: the same build everywhere, configuration outside the code, schema and code moving together, and nothing secret in an image.",
        app: "Configuration comes from the environment, with an example file listing every variable. The web image is built with a relative API address, so one image runs behind any domain. Schema changes are versioned migrations applied by the container before it serves — never an automatic sync. The API waits for the database to be healthy. Containers run as a non-root user, and no secret is baked into an image. Changes are seen on a preview address first. The tests start the app through the same boot sequence production uses.",
        links: code(L("config/env.js", `${B}config/env.js`), L(".env.example", "backend/.env.example"), L("a relative API address", "frontend/Dockerfile", "NEXT_PUBLIC_API_BASE_URL=/api"), L("migrations, then start", "backend/Dockerfile", "CMD"), L("never a sync", `${B}boot.js`, "no sync() here"), L("waits for the database", "docker-compose.yml", "condition: service_healthy"), L("one boot sequence", `${B}boot.js`, "Shared by the server and the integration tests")),
        say: "Two it does not follow yet, and worth naming before someone asks: a deploy does not wait for the checks, and backups are not scheduled.",
      }],
      [TALK, "Jenkins - Basics", {
        topic: "Jenkins is a self-hosted automation server: it watches a repository and runs builds, tests and deploys on machines you control.",
        say: "A controller schedules the work and keeps the configuration; agents do the work. A job is a definition and a build is one run of it, with a workspace, a console log and artifacts. A build starts from a webhook, a poll of the repository, a timer, or by hand. Almost everything — Git, Node, Docker, notifications — is a plugin.",
        near: "This project's CI is the hosted equivalent (topic {{Code coverage and CI}}), so each idea has a counterpart to point at: a workflow is a job, a runner is an agent, `on:` is the trigger, repository secrets are credentials, and the coverage report kept by each run is an archived artifact.",
        links: code(L("the triggers", CI, "on:"), L("a job and its runner", CI, "runs-on:"), L("an artifact kept", CI, "Keep the coverage report")),
      }],
      [TALK, "Jenkins - Freestyle Project", {
        topic: "A job configured through Jenkins's web forms rather than a file.",
        say: "Its parts, top to bottom: where the source comes from, what triggers a build, the build environment, the build steps (usually shell commands), and the post-build actions — archive artifacts, publish test results, notify. It is quick to set up, but the configuration lives in Jenkins and not in the repository, so it is neither reviewed nor versioned with the code. That is why pipelines replaced it.",
        near: "The *Frontend build* job is exactly what a freestyle job would be: check out, install with `npm ci`, run `npm run build`.",
        links: code(L("the frontend build job", CI, "name: Frontend build")),
      }],
      [TALK, "Jenkins - Pipeline Project", {
        topic: "The build written as code, in a `Jenkinsfile` kept in the repository.",
        say: "Declarative (`pipeline { agent … stages { stage { steps } } post { } }`) or scripted (plain Groovy). Stages show progress, `parallel` runs them side by side, `environment` and `credentials()` bring in settings and secrets, and `post` runs clean-up and notifications whatever the result. Because it is in the repository, it is reviewed and it changes with the code it builds.",
        near: "`ci.yml` is this project's pipeline as code, and it translates stage by stage: the two jobs become two parallel stages, the MySQL and MongoDB services become sidecar containers, `npm run coverage` is one `sh` step, and the kept coverage report is `archiveArtifacts`.",
        links: code(L("the service containers", CI, "services:"), L("the test step", CI, "run: npm run coverage"), L("the report kept", CI, "Keep the coverage report")),
      }],
      [TALK, "Jenkins - Configuration", {
        topic: "Setting up the Jenkins server itself.",
        say: "Under *Manage Jenkins*: plugins; global tools such as the JDK and Node versions; the credentials store; nodes and agents with their labels; who can sign in and what they may do; and system settings such as the server's address and mail. Kept as a YAML file with Configuration as Code, a server can be rebuilt rather than clicked together again.",
        near: "The same concerns appear in the Android release workflow: the signing key and its passwords come from the repository's secret store and never from the repository, and the JDK version is pinned for the build.",
        links: code(L("secrets, not files", ANDROID_CI, "ANDROID_KEYSTORE_BASE64"), L("a pinned tool version", ANDROID_CI, 'java-version: "17"')),
      }],
      [DONE, "Docker - Security", {
        topic: "Limiting what a container can do, and what an image gives away.",
        app: "Both containers drop root and run as the `node` user. No secret is baked into an image: `.env` files are excluded from the build, and configuration arrives at run time. The database is used through an application account, not root. Only the reverse proxy publishes ports — the API and MySQL are reachable only on the stack's private network, and MongoDB is published on the loopback address alone. The proxy's configuration is mounted read-only.",
        links: code(L("not root", "backend/Dockerfile", "USER node"), L("secrets kept out of the build", "backend/.dockerignore", ".env"), L("an application account", "docker-compose.yml", "MYSQL_USER"), L("loopback only", "docker-compose.yml", "127.0.0.1:27017:27017"), L("mounted read-only", "docker-compose.yml", "Caddyfile:/etc/caddy/Caddyfile:ro")),
        say: "Not here, and worth naming: scanning images for known vulnerabilities, pinning base images by digest, a read-only root filesystem, and dropping Linux capabilities.",
      }],
      [TALK, "Docker - Resource Management", {
        topic: "Stopping one container from taking the whole machine.",
        say: "Limits on memory and CPU (`--memory`, `--cpus`, or `deploy.resources.limits` in Compose); what happens at the limit — the kernel kills the process for memory and throttles it for CPU; reservations against limits; `docker stats` to see real use; restart policies; and why Node's own heap limit (`--max-old-space-size`) has to sit below the container's memory limit.",
        near: "The Compose file sets restart policies and a health check but no limits. The nearest real limit is in the application: the database connection pool is capped by `DB_POOL_MAX`, because the free database allows few connections.",
        links: code(L("restart policy", "docker-compose.yml", "restart: unless-stopped"), L("the pool cap", `${B}config/database.js`, "DB_POOL_MAX")),
      }],
      [TALK, "Docker - Custom Registries", {
        topic: "Where images are stored and pulled from, when it is not the public Docker Hub.",
        say: "A registry holds repositories of tagged images: `docker login`, `tag`, `push`, `pull`. It can be one of your own (`registry:2`) or hosted (GitHub Container Registry, a cloud provider's). Tags move but digests do not, so a deploy should name the digest; and a server needs credentials to pull from a private one.",
        near: "Nothing is pushed here: Compose builds the images where they run, and Render builds the API from its Dockerfile. The same idea does exist for the Android app — the release workflow builds a versioned file once and publishes it for phones to download.",
        links: code(L("built where it runs", "docker-compose.yml", "build: ./backend"), L("a published, versioned build", ANDROID_CI, "gh release create")),
      }],
    ],
  },
  {
    section: "Debugging techniques",
    items: [
      [LIVE, "Conditional Breakpoints and Actions", {
        topic: "Stopping only when a condition holds, or logging a value without stopping at all (a logpoint) — so the tenth interesting call is reached without stepping through nine dull ones.",
        live: "Run the API under the debugger: in VS Code open a *JavaScript Debug Terminal* in `backend/` and run `npm run dev`. Put a breakpoint on the first line inside `holdService.create`, edit it, and give it the condition `seatIds.length > 2` — choosing one seat sails through, choosing three stops. Then add a logpoint in the same function with the message `hold: {seatIds.length} seats for user {userId}`: it prints on every hold and never pauses. A hit count (`>= 3`) stops on the third call only.",
        links: code(L("holdService.create", S("holdService"), "async function create(")),
      }],
      [LIVE, "Attach to Process", {
        topic: "Connecting a debugger to a program that is already running, instead of starting it under one.",
        live: "Start the API with `node --inspect src/server.js` in `backend/`; it prints the port a debugger can connect on. In VS Code run *Debug: Attach to Node Process* and pick it — breakpoints now bind in the running server, and detaching leaves it running. `chrome://inspect` in a browser lists the same process. On a phone, the page inside the Android app can be attached to in the same way while the app is pointed at a development server.",
        links: code(L("how the API starts", "backend/package.json", '"start":'), L("the app allows a debugger in development", KOTLIN("MainActivity"), "setWebContentsDebuggingEnabled")),
      }],
      [LIVE, "Debugging Child Processes", {
        topic: "A program that starts other programs: a debugger attached only to the parent never stops in the child.",
        live: "The integration tests are a parent and its children: the runner keeps the API inside its own process and starts every suite as a separate Node process. In a VS Code *JavaScript Debug Terminal* run `npm run test:integration -- subscription-devices`; the terminal attaches to each child as it starts. A breakpoint in the suite stops in the child, one in `deviceService.admit` stops in the parent, and the call-stack panel shows both. Without that, the child would have to be started with `--inspect-brk` on a port of its own.",
        links: code(L("each suite is a child process", RUNNER, "const child = spawn(process.execPath"), L("the API stays in the parent", RUNNER, "async function startApi()"), L("a suite", SUITE("subscription-devices")), L("deviceService.admit", S("deviceService"), "async function admit(")),
      }],
      [LIVE, "Debugging Mixed Code Bases", {
        topic: "One behaviour that crosses languages and runtimes, so no single debugger sees all of it.",
        live: "The Android app is Kotlin hosting the site's JavaScript, and it runs scripts of its own inside the page. Follow the back button across the boundary: Kotlin asks the page to close an open dialog and acts on the answer. With the app pointed at a development server, open `chrome://inspect` on the computer to debug the page inside the app, and watch the Kotlin side with `adb logcat` or Android Studio. The same crossing exists between the browser and the API: every response carries an `X-Request-Id`, which is the thread to pull from a failing request in the browser's network panel to the server's records.",
        links: code(L("Kotlin calls into the page", KOTLIN("MainActivity"), "PageScripts.CLOSE_LAYER"), L("the scripts it runs there", KOTLIN("PageScripts")), L("debugging the page is allowed in development", KOTLIN("MainActivity"), "setWebContentsDebuggingEnabled"), L("the request ID in every response", `${B}middleware/requestContext.js`, "X-Request-Id")),
      }],
      [TALK, "Debugging in Multi-threaded Applications", {
        topic: "Several threads touching the same state: faults that depend on timing and vanish when stepped through.",
        say: "The threads view and a call stack per thread; freezing the others while stepping one; why a breakpoint changes the timing, so that logs with thread names and timestamps often show more than stepping does; races and deadlocks, and how to tell them apart; handing a result back to a UI thread safely. For Node, say why it is different: JavaScript runs on one thread, so the same faults appear as interleavings between `await`s and between database transactions — found with async stack traces and by reading lock waits in the database.",
        near: "Two real cases. The Android app tests a server address on a background thread and hands the result back to the UI thread, discarding it if a newer test has started meanwhile — the stale-result race, guarded. And the API's own races are in the database (topic {{Concurrency and isolation}}) — two purchases of one seat, six new devices for one place — each pinned down by a test that fires them together.",
        links: code(L("work on a background thread", KOTLIN("ServerActivity"), 'thread(name = "server-test")'), L("a stale result is discarded", KOTLIN("ServerActivity"), "if (run != testRun || isDestroyed)"), L("two purchases of one seat", SUITE("concurrency"))),
      }],
      [TALK, "Core dump analysis", {
        topic: "Reading the memory image a process leaves behind when it crashes, to find out what it was doing.",
        say: "What a dump holds (every thread's stack, the heap, the loaded modules); how one is produced (`ulimit -c unlimited` on Linux, `node --abort-on-uncaught-exception`, a minidump or `procdump` on Windows); how it is read (`lldb` or `gdb`, with `llnode` to see JavaScript frames and objects; WinDbg on Windows); and the lighter tools usually tried first in Node — a diagnostic report and a heap snapshot.",
        near: "No dump has been needed here and nothing in the code produces one. The nearest thing that can be shown in a minute: start the API with `node --report-uncaught-exception --report-on-fatalerror src/server.js`, and when the process dies it writes a JSON report — the JavaScript and native stacks, heap statistics and open handles — which is what a core dump is usually opened to find.",
        links: code(L("how the API starts", "backend/package.json", '"start":')),
      }],
      [DONE, "Different env issue reproduce", {
        topic: "A fault that appears in one environment and not another — and making it appear on your own machine, which is most of fixing it.",
        app: "Four real ones. A timestamp was written in the server's own timezone: invisible on servers set to UTC, six hours out on a developer's machine — fixed by using the database's UTC clock, and a check now fails on any machine where the two differ. Production's host blocks SMTP, so mail that worked locally never left; there it goes over HTTPS. A sleeping production API refuses requests that arrive through the web host's proxy: a browser check simulates that sleeping server locally, and a script records the real one. And a phone refuses its camera to a page that is not served over HTTPS, so a tool serves the local site over HTTPS on the network. Behind all four: the tests start the app through the same boot sequence as production, and Compose runs the production images locally.",
        links: code(L("the database's UTC clock", S("deviceService"), "UTC_TIMESTAMP()"), L("the check for it", SUITE("subscription-devices"), "whatever timezone the server keeps"), L("mail over HTTPS", S("emailService"), "async function sendWithGmail("), L("a simulated sleeping server", "e2e/test-wake.js"), L("the real one, recorded", "tools/prod-wake-check.js"), L("HTTPS on the local network", "tools/lan-https.js"), L("one boot sequence", `${B}boot.js`, "Shared by the server and the integration tests")),
      }],
    ],
  },
  {
    section: "Logging — the rest of the goal sheet",
    items: [
      [DONE, "Introduction to logging", {
        topic: "What a system writes down about itself, and who reads it.",
        app: "Three records, for three readers. The application log is lines on the console for whoever runs the server: what started, what was skipped, what failed. The audit log is data for whoever is accountable: who did what, to which thing, from where. Job history is rows for operators: what background work ran, how far it got and why it stopped.",
        links: code(L("a line at start-up", S("emailService"), 'say("[email] sending through the Gmail API")'), L("auditService.record", S("auditService"), "async function record("), L("a job's run, recorded", S("jobService"), "async function run(")),
      }],
      [DONE, "Different log types", {
        topic: "Logs differ by what they are for: running the system, proving who did what, tracing requests, tuning queries.",
        app: "Five kinds are kept. An application log on the console. An access log — one line per request — in development. An audit and security log in MongoDB: every privileged action, every sign-in, wrong password and pause. A query log of every SQL statement, in development. And job history in the database.",
        links: code(L("access log", `${B}app.js`, 'morgan("dev")'), L("query log", `${B}config/database.js`, "logging:"), L("the audit actions", `${B}constants/auditActions.js`, "const AUDIT_ACTIONS"), L("a failed sign-in, recorded", S("authService"), "AUDIT_ACTIONS.AUTH_LOGIN_FAILED"), L("Background Jobs page", `${F}app/dashboard/jobs/page.js`)),
      }],
      [PART, "Logging frameworks/libraries", {
        topic: "A library that handles levels, formats and destinations, so the code only says what happened.",
        app: "Partly. One small library is used: `morgan` writes the request line in development. Everything else is the built-in console. Adopting a framework proper is the plan in topic {{Asynchronous logging, frameworks, rotation, distributed logging}}.",
        links: code(L("morgan", `${B}app.js`, 'morgan("dev")')),
        say: "Say what a framework adds, and name two: pino (fast, JSON first, child loggers that carry context) and winston (transports and formats). Levels by environment, a child logger per request, redaction, and transports to files or to a log service.",
      }],
      [TALK, "Asynchronous logging", {
        topic: "Writing log entries without making the request wait for the disk or the network.",
        say: "The request hands the entry to a buffer and carries on; a background writer — in pino, a worker thread — sends it. It is faster under load, at a price: entries still in the buffer are lost if the process dies, so a fatal error is flushed synchronously, and a full buffer must either drop entries or push back.",
        near: "Nothing is logged asynchronously here; it is part of the plan in topic {{Asynchronous logging, frameworks, rotation, distributed logging}}. The nearest decision in the code is the opposite one, made on purpose: an audit entry is awaited before the response is sent, so it is not lost — but it can never fail the action either. If the audit store is down, the entry is skipped with a warning.",
        links: code(L("auditing never fails the action", S("auditService"), "Auditing must never be the reason a legitimate action fails")),
      }],
      [PART, "Distributed logging", {
        topic: "One request passes through several programs; their logs have to be joined to tell its story.",
        app: "Partly. The joining is topic {{Correlating entries to one request}}: every request gets an ID that every audit entry it causes carries. The same ID is returned to the caller in a header, so a person reporting a problem can quote it.",
        links: code(L("returned in a header", `${B}middleware/requestContext.js`, "X-Request-Id"), L("runWithContext", `${B}utils/requestContext.js`, "function runWithContext(")),
        say: "Joining is as far as it goes: the web host, the API host and the database each keep their own logs. Say what completes it — one place that collects every service's logs, and an ID passed along with each call so that a trace spans all of them.",
      }],
    ],
  },
  {
    section: "ORM — the rest of the goal sheet",
    items: [
      [DONE, "Unit Test — testing code that uses the ORM", {
        topic: "Testing code that talks to the database through the ORM.",
        app: `Database code is tested against a real MySQL database, not a stand-in: the runner builds one with the same migrations as production, snapshots it, and restores it before every suite, so each of the ${COUNT.suites} suites starts from the same rows. The rules themselves are pulled out of the services into pure functions, so most of the ${COUNT.unitTests} unit tests need no database at all.`,
        links: code(L("snapshot", RUNNER, "async function snapshot()"), L("restore", RUNNER, "async function restore()"), L("a rule kept pure", `${B}utils/subscriptionDevices.js`, "function placeOf("), L("the service that applies it", S("deviceService"), "async function admit(")),
        say: "Say the alternatives and why they were not used: an in-memory SQLite behaves differently from MySQL (locks, JSON, upserts), and mocked models prove only that the mock was called.",
      }],
    ],
  },
  {
    section: "Operating system",
    items: [
      [PART, "Advanced Shell Scripting", {
        topic: "Scripts that make decisions: pulling text apart, conditions, exit codes, values passed from one step to the next.",
        app: "Partly. The Android release is driven by shell. It pulls the version out of the build file with `sed`, compares it with the tag, and stops the release with an error if they differ; decodes the signing key from a secret into a temporary file and hands its path to later steps; strips the tag's prefix with a parameter expansion; and publishes the release from the command line. The API container's start command chains migration and start, so a failed migration stops the start.",
        links: code(L("a version pulled out with sed", ANDROID_CI, "version=$(sed -n"), L("the key, decoded", ANDROID_CI, "base64 --decode"), L("a prefix stripped", ANDROID_CI, "GITHUB_REF_NAME#android-"), L("published from the command line", ANDROID_CI, "gh release create"), L("migrate, then start", "backend/Dockerfile", "CMD")),
        say: "These are short. Say what longer scripts need: `set -euo pipefail`, functions, `trap` for clean-up, arrays, `getopts`, here-documents, and checking with `shellcheck`.",
      }],
      [PART, "Service and System Management", {
        topic: "Keeping long-running programs running: starting them in order, restarting them, scheduling work.",
        app: "Partly. The services are containers managed by Compose: each restarts unless stopped, the API starts only when the database reports healthy, and data survives in volumes. Scheduled work is not cron but timers inside the API — expiring holds every minute, pruning daily — and long work is a durable job that another worker takes over if the first one dies.",
        links: code(L("restart policy", "docker-compose.yml", "restart: unless-stopped"), L("start order", "docker-compose.yml", "condition: service_healthy"), L("how work is scheduled", `${B}jobs/index.js`, "function register("), L("a schedule entry", `${B}jobs/index.js`, 'register("hold.expire"'), L("a job taken over", S("jobService"), "async function claimNext(")),
        say: "Say the operating system's own tools for the same job: a systemd unit (`systemctl enable`, `start`, `status`, and `journalctl` for its log), cron and systemd timers, and Windows services.",
      }],
      [PART, "Security and Troubleshooting", {
        topic: "Giving a program the least access it needs, and finding out why two machines cannot talk.",
        app: "Partly. Containers run as an unprivileged user, the database is used through an application account, and MongoDB listens on the loopback address only. For trouble between a phone and a development computer, the Android app says which kind it is — nothing listening on the port, no answer (a firewall, or another network), an unknown address — and its guide lists the checks: the same Wi-Fi, the firewall's private-network rule, forwarding a port over USB.",
        links: code(L("not root", "backend/Dockerfile", "USER node"), L("loopback only", "docker-compose.yml", "127.0.0.1:27017:27017"), L("what failed, in words", KOTLIN("Reachability"), "nothing is listening on that port"), L("the checks", "android/README.md")),
        say: "Say the general kit: users, groups and file permissions; which process holds a port (`ss`, `netstat`); firewall rules; DNS (`nslookup`); what is using the CPU, memory and disk (`top`, `df`); and reading the system log.",
      }],
    ],
  },
  {
    section: "Unit testing — the rest of the goal sheet",
    items: [
      [PART, "Testing Multi-Threaded Code", {
        topic: "Tests for code that runs at the same moment as other code.",
        app: "Partly. The asynchronous half of this sub-goal is topic {{Testing asynchronous code}}. Things happening at once are tested too: two purchases of the same seat fired together must not both succeed, and of six new devices arriving together exactly one takes the last place.",
        links: code(L("two purchases of one seat", SUITE("concurrency")), L("six devices, one place", SUITE("subscription-devices"), "six new devices arriving together")),
        say: "JavaScript here runs on one thread, so nothing tests threads as such — the simultaneous cases above race in the database, not in memory. Say what thread tests need that these do not: shared memory, locks, and a way to force a particular interleaving.",
      }],
    ],
  },
];

/* ======================================================================
 * The goal sheet: every sub-goal in its own order and wording, with the
 * topics that cover it, how it is covered, and one line saying so.
 * ==================================================================== */

const SHEET = [
  {
    goal: "Application Deployment (Intermediate)",
    items: [
      ["Deployment Strategies", PART, ["Deployment Strategies"], "Immutable deploys switched over when ready, with previews first; rolling and canary are explained."],
      ["Deployment Tools and Technologies", DONE, ["Deployment Tools and Technologies"], "Docker, Compose, Caddy, Vercel, Render, Aiven, GitHub Actions and Gradle — each with its file."],
      ["Cloud Deployment", DONE, ["Cloud deployment"], "Live on Vercel, Render and Aiven, behind one origin."],
      ["On-Premises Deployment", DONE, ["On-Premises Deployment", "Docker Compose, environment, volumes and networking"], "The whole stack on one machine of your own, with Docker Compose and Caddy."],
      ["Continuous Integration and Continuous Deployment (CI/CD)", PART, ["CI/CD"], "CI on every pull request and an automated Android release; deploys are not gated on it."],
      ["Containerization and Orchestration", PART, ["Containerization and Orchestration", "Dockerfile basics and dockerizing Node.js", "Docker Compose, environment, volumes and networking"], "Two images and five containers under Compose; Kubernetes is explained."],
      ["Monitoring and Logging", PART, ["Monitoring"], "A health endpoint and failed-job notices; no metrics or outside alerts."],
      ["Security in Application Deployment", DONE, ["Security in deployment"], "TLS to the database, a CORS allow-list, secrets in the environment."],
      ["Rollback and Disaster Recovery", PART, ["Rollback and disaster recovery"], "Every migration can be undone; there are no backups yet."],
      ["Best Practices for Application Deployment", DONE, ["Best Practices for Application Deployment"], "Configuration from the environment, one image for any domain, migrations before start."],
      ["Jenkins - Basics", TALK, ["Jenkins - Basics"], "Not used — CI here is GitHub Actions. Explained against `ci.yml`."],
      ["Jenkins - Freestyle Project", TALK, ["Jenkins - Freestyle Project"], "Explained; the frontend build job is the nearest thing."],
      ["Jenkins - Pipeline Project", TALK, ["Jenkins - Pipeline Project"], "Explained; `ci.yml` translates into a Jenkinsfile stage by stage."],
      ["Jenkins - Configuration", TALK, ["Jenkins - Configuration"], "Explained; the release workflow's secrets and pinned tools are the nearest thing."],
      ["Docker - Optimizing Images", DONE, ["Dockerfile basics and dockerizing Node.js"], "Production-only install and a two-stage build."],
      ["Docker - Security", DONE, ["Docker - Security"], "Not root, no secrets in images, only the proxy published."],
      ["Docker - Resource Management", TALK, ["Docker - Resource Management"], "No limits are set. Explained; the connection-pool cap is the nearest thing."],
      ["Docker - Custom Registries", TALK, ["Docker - Custom Registries"], "Nothing is pushed to a registry. Explained."],
    ],
  },
  {
    goal: "Debugging Techniques (Advanced)",
    items: [
      ["Conditional Breakpoints and Actions", LIVE, ["Conditional Breakpoints and Actions"], "A breakpoint that stops only for a hold of three seats or more, and a logpoint that never stops."],
      ["Attach to Process", LIVE, ["Attach to Process"], "VS Code attached to the API while it runs; Chrome attached to the page inside the Android app."],
      ["Debugging Child Processes", LIVE, ["Debugging Child Processes"], "The test runner and the suites it starts, both under one debugger."],
      ["Debugging Mixed Code Bases", LIVE, ["Debugging Mixed Code Bases"], "Kotlin and the JavaScript page it hosts, followed across the boundary."],
      ["Debugging in Multi-threaded Applications", TALK, ["Debugging in Multi-threaded Applications"], "Explained; the Android app's background thread and the race tests are the nearest things."],
      ["Core dump analysis", TALK, ["Core dump analysis"], "Explained; a Node diagnostic report can be shown in its place."],
      ["Different env issue reproduce", DONE, ["Different env issue reproduce"], "Four real cases: a timezone, a blocked mail port, a sleeping server, a phone's camera."],
    ],
  },
  {
    goal: "Logging",
    items: [
      ["Introduction to logging", DONE, ["Introduction to logging"], "Three records for three readers: the console, the audit log, job history."],
      ["Basic logging concepts", PART, ["Basic logging and log levels"], "Console lines with a prefix per area; a real logger is planned."],
      ["Different log types", DONE, ["Different log types"], "Application, access, audit and security, query, and job history."],
      ["Log levels", PART, ["Basic logging and log levels"], "Severity by console method; no threshold that can be raised or lowered."],
      ["Logging objects", DONE, ["Logging objects and structured records"], "Audit entries are documents, not sentences."],
      ["Log rotation and retention", PART, ["Retention"], "Retention is shown; rotation is explained — the app writes no log files."],
      ["Structured logging", DONE, ["Logging objects and structured records"], "The audit log is structured end to end."],
      ["Logging frameworks/libraries", PART, ["Logging frameworks/libraries", "Asynchronous logging, frameworks, rotation, distributed logging"], "morgan writes request lines in development; a framework proper is planned and explained."],
      ["Asynchronous logging", TALK, ["Asynchronous logging", "Asynchronous logging, frameworks, rotation, distributed logging"], "Not used. Explained; audit entries are deliberately awaited."],
      ["Distributed logging", PART, ["Distributed logging", "Correlating entries to one request"], "A request ID on every audit entry and in a response header; no central collection."],
    ],
  },
  {
    goal: "ORM (Intermediate)",
    items: [
      ["Complex querying capabilities in ORM (e.g., subqueries, grouping)", DONE, ["Complex querying: subqueries, grouping, filtered includes"], "Subqueries, GROUP BY and filtered includes, through the ORM."],
      ["Transactions, including commit and rollback operations", DONE, ["Transactions: commit and rollback", "Transactions and row locking"], "Managed transactions; work is queued only after the commit."],
      ["Understand generated Query", DONE, ["Understanding the generated SQL"], "Every statement the ORM sends is printed in development."],
      ["Understand object tracking", DONE, ["Object tracking and hooks"], "Hooks record every row created while demo data is built."],
      ["Lazy Loading & Eager Loading", DONE, ["Lazy and eager loading"], "Eager loading, in a place where a missing include once caused a bug."],
      ["Data Seeding", DONE, ["Data seeding"], "Seeders, the demo-data button and the railway loader — all safe to run twice."],
      ["Debug Migration", DONE, ["Migrations, and debugging a migration"], "A migration over live data, rehearsed against a copy of the old schema."],
      ["Repository Pattern", PART, ["Repository pattern"], "A service layer owns all data access, without repository interfaces."],
      ["Handle Complex Mapping/Constraints", DONE, ["Complex mappings and constraints", "Constraints and referential integrity"], "Many-to-many, two links to one table, and constraints that carry business rules."],
      ["Caching", DONE, ["Caching"], "Settings, permissions and a mail token, each cached in a different way."],
      ["Unit Test", DONE, ["Unit Test — testing code that uses the ORM"], "Database code is tested against a real test database, snapshotted and restored."],
      ["Deployment strategies", DONE, ["Schema deployment strategy"], "Migrations run before the API starts, so code and schema arrive together."],
    ],
  },
  {
    goal: "Operating System (Advanced)",
    items: [
      ["Advanced Shell Scripting", PART, ["Advanced Shell Scripting"], "The shell that drives the Android release; longer scripts are explained."],
      ["Service and System Management", PART, ["Service and System Management"], "Containers kept running by Compose and timers inside the API; systemd is explained."],
      ["Security and Troubleshooting", PART, ["Security and Troubleshooting"], "Least privilege in the containers; a connection test that says what failed."],
    ],
  },
  {
    goal: "Unit Testing (Advanced)",
    items: [
      ["Test-Driven Development (TDD)", DONE, ["Test-driven style on pure logic"], "Rules written as small pure functions, with their tests."],
      ["Code Coverage and Metrics", DONE, ["Code coverage and CI"], "Measured across both test runs, with floors the build enforces."],
      ["Testing Asynchronous and Multi-Threaded Code", PART, ["Testing asynchronous code", "Testing Multi-Threaded Code"], "Timeouts and retries, and races fired together; threads themselves are explained."],
      ["Continuous Integration and Test Automation", DONE, ["Code coverage and CI", "CI/CD"], "Every test runs on every pull request, without anyone starting it."],
    ],
  },
];

/** What would turn a talk into something to show, and which topics it would move. */
const COULD_BUILD = [
  ["A `Jenkinsfile` that runs what `ci.yml` runs, with Jenkins in a container beside the stack", ["Jenkins - Basics", "Jenkins - Pipeline Project", "Jenkins - Configuration"]],
  ["A logging library such as pino: JSON lines, a level per environment, the request ID on every line, an asynchronous transport", ["Basic logging and log levels", "Asynchronous logging, frameworks, rotation, distributed logging", "Logging frameworks/libraries", "Asynchronous logging", "Distributed logging"]],
  ["Memory and CPU limits on each service in the Compose file, shown with `docker stats`", ["Docker - Resource Management"]],
  ["A CI step that pushes the API image to a registry, and a Compose file that pulls it", ["Docker - Custom Registries", "CI/CD"]],
  ["A database backup script, and a restore that has been tried", ["Rollback and disaster recovery", "Advanced Shell Scripting"]],
  ["A metrics endpoint, and an outside check of the health endpoint", ["Monitoring"]],
  ["A systemd unit that runs the Compose stack on a server", ["Service and System Management"]],
];

/* ======================================================================
 * Numbering, and the links between topics and between the two guides
 * ==================================================================== */

// Every topic by its title: its number, how it is covered, and where its heading is.
const topics = new Map();
{
  let n = 0;
  for (const s of goals) {
    for (const [status, title, entry] of s.items) {
      n += 1;
      if (topics.has(title)) throw new Error(`two topics are called "${title}"`);
      topics.set(title, { n, status, title, entry, anchor: slug(`${n}. ${status} ${title}`) });
    }
  }
}
const topicNamed = (title, from) => {
  const found = topics.get(title);
  if (!found) throw new Error(`${from}: unknown goal topic "${title}"`);
  return found;
};
/** "{{A topic's title}}" in an entry's text becomes its number, linked. */
const fill = (text, from) =>
  text && text.replace(/\{\{(.+?)\}\}/g, (_, title) => {
    const t = topicNamed(title, from);
    return `[${t.n}](#${t.anchor})`;
  });
for (const t of topics.values()) {
  for (const part of ["app", "say", "near", "live"]) t.entry[part] = fill(t.entry[part], `topic "${t.title}"`);
}

/** Which learning-goal topics each feature exercises. */
const FEATURE_GOALS = {
  "Search trains between any two stations": ["Complex querying: subqueries, grouping, filtered includes", "Lazy and eager loading"],
  "Stretch-by-stretch seat inventory": ["Constraints and referential integrity", "Transactions and row locking", "Concurrency and isolation", "Test-driven style on pure logic"],
  "\"Where is there room?\" matrix": ["Complex querying: subqueries, grouping, filtered includes"],
  "Seat map and automatic seat choice": ["Test-driven style on pure logic"],
  "Timed checkout hold, resumable anywhere": ["Concurrency and isolation", "Constraints and referential integrity", "Transactions and row locking"],
  "Paying: wallet, card or mobile banking, or a split": ["Transactions and row locking", "Transactions: commit and rollback", "Concurrency and isolation"],
  "Tickets: signed QR code, PDF and email": ["Test-driven style on pure logic", "Testing asynchronous code"],
  "Wallet": ["Transactions and row locking", "Concurrency and isolation", "Test-driven style on pure logic"],
  "Returning a ticket": ["Test-driven style on pure logic", "Transactions and row locking", "Transactions: commit and rollback"],
  "Transferring a ticket to someone else": ["Transactions: commit and rollback", "Transactions and row locking"],
  "Connecting standing ticket": ["Test-driven style on pure logic", "Concurrency and isolation"],
  "Waitlist": ["Concurrency and isolation", "Transactions: commit and rollback"],
  "Accounts and travel profile": ["Authentication and authorization", "Logging objects and structured records", "Duplicate entries"],
  "Notifications in the app": ["Duplicate entries", "Constraints and referential integrity", "Retention"],
  "Subscriptions": ["Duplicate entries", "Constraints and referential integrity", "Test-driven style on pure logic"],
  "Checking tickets": ["Transactions and row locking", "Concurrency and isolation"],
  "Checking with no signal": ["Duplicate entries"],
  "Reporting, abuse score and account holds": ["Complex querying: subqueries, grouping, filtered includes", "Logging objects and structured records"],
  "Stations, trains and routes": ["Complex mappings and constraints", "Data seeding"],
  "Fares": ["Complex querying: subqueries, grouping, filtered includes"],
  "Seat plan designer and approval": ["Data seeding"],
  "Compositions, schedules and the rolling horizon": ["Lazy and eager loading", "Constraints and referential integrity", "Duplicate entries"],
  "Running departures: cancel, reinstate, coaches": ["Transactions: commit and rollback", "Concurrency without holding locks", "Concurrency and isolation"],
  "Seat inventory, quotas and blocks": ["Complex querying: subqueries, grouping, filtered includes", "Constraints and referential integrity"],
  "Background jobs": ["Concurrency without holding locks", "Indexing", "Transactions: commit and rollback", "Retention", "Basic logging and log levels"],
  "Clearing out trains long gone": ["Retention", "Transactions: commit and rollback", "Constraints and referential integrity"],
  "Roles and permissions as data": ["Authentication and authorization", "Caching", "Complex mappings and constraints", "Migrations, and debugging a migration"],
  "Settings": ["Caching"],
  "Audit log": ["A document store beside the relational database", "Logging objects and structured records", "Correlating entries to one request"],
  "Demo data": ["Object tracking and hooks", "Data seeding", "Transactions: commit and rollback", "Complex querying: subqueries, grouping, filtered includes", "Duplicate entries", "Constraints and referential integrity"],
  "The real railway": ["Data seeding", "Duplicate entries", "Test-driven style on pure logic"],
  "Approving subscriptions, and the devices they are used on": ["Transactions and row locking", "Authentication and authorization", "Concurrency and isolation"],
  "Sign-in sessions": ["Authentication and authorization"],
  "Email": ["Testing asynchronous code", "Security in deployment", "Caching", "Basic logging and log levels"],
  "API documentation": [],
  "Deployment": ["Dockerfile basics and dockerizing Node.js", "Docker Compose, environment, volumes and networking", "Cloud deployment", "Security in deployment", "Schema deployment strategy", "CI/CD", "Rollback and disaster recovery"],
  "Responsive design system": [],
  "Subscription check for callers outside the app": ["Authentication and authorization", "Security in deployment", "Concurrency and isolation", "Transactions and row locking", "Test-driven style on pure logic"],
  "Android app": ["CI/CD", "Security in deployment"],
  "Waking a sleeping server": ["Cloud deployment"],
  "Tests and continuous integration": ["Code coverage and CI", "Test-driven style on pure logic", "Testing asynchronous code", "CI/CD"],
};

for (const s of features) {
  for (const [title, entry] of s.items) {
    const names = FEATURE_GOALS[title];
    if (!names) throw new Error(`no goal topics listed for feature "${title}"`);
    entry.goalTopics = names.length
      ? names
          .map((name) => {
            const t = topicNamed(name, `feature "${title}"`);
            return `${t.status} [${t.title}](LEARNING-GOALS.md#${t.anchor})`;
          })
          .join(" · ")
      : "none of the listed topics — this one is about the product rather than a learning goal";
  }
}
for (const title of Object.keys(FEATURE_GOALS)) {
  if (!features.some((s) => s.items.some(([t]) => t === title))) throw new Error(`goal list for unknown feature "${title}"`);
}

/* ======================================================================
 * Write
 * ==================================================================== */

const BRANCH_NOTE =
  "Code links open the file at the line where the feature lives — on GitHub, or in VS Code's Markdown preview.";

function featuresDoc() {
  let n = 0;
  const toc = features.map((s) => `- [${s.section}](#${s.section.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-")}) — ${s.items.length}`).join("\n");
  const body = features
    .map((s) => [`## ${s.section}`, "", ...s.items.map(([title, entry]) => item(`${++n}. ${title}`, entry))].join("\n"))
    .join("\n");
  return `# Seat Planner — features

What the system does, feature by feature. For each: the problem it addresses (**Topic**), how Seat
Planner handles it (**In Seat Planner**), where the code is (**Code**), which learning-goal topics it
exercises (**Goal topics covered**, linking into [LEARNING-GOALS.md](LEARNING-GOALS.md) — ✅ demonstrated,
🟡 partly), and — where there is a screen to show — how to show it (**Show it**).

${BRANCH_NOTE}

**Demo accounts** (created by *Administration → Demo Data → Populate*):

| Role | Email | Password |
|---|---|---|
| Passenger | user1@example.com | User123! |
| Planner | planner1@example.com | Planner123! |
| Admin | admin1@example.com | Admin123! |
| Ticket checker | checker1@example.com | Checker123! |

The super admin is the account set in the API's \`.env\`.

On a database where a role called \`admin\` (or \`planner\`) already existed, *Populate* uses it as it is
rather than changing it, and lists under *Worth knowing* which permissions it lacks. Grant those on
*Administration → Roles* before showing the operator screens as admin1.

**Sections**

${toc}

${body}`;
}

function goalsDoc() {
  const SHEET_MARKS = [DONE, PART, LIVE, TALK];
  const rows = SHEET.flatMap((g) => g.items);
  const tally = (items) => SHEET_MARKS.map((m) => items.filter(([, mark]) => mark === m).length);
  const ref = (title, from) => {
    const t = topicNamed(title, from);
    return `[${t.n}](#${t.anchor})`;
  };
  const refs = (titles, from) => titles.map((title) => ref(title, from)).join(", ");
  const goalAnchor = (g, i) => slug(`Goal ${i + 1} — ${g.goal}`);

  const summary = SHEET.map((g, i) => `| [${i + 1}. ${g.goal}](#${goalAnchor(g, i)}) | ${g.items.length} | ${tally(g.items).join(" | ")} |`).join("\n");

  const sheet = SHEET.map((g, i) =>
    [
      `### Goal ${i + 1} — ${g.goal}`,
      "",
      "| Sub-goal on the sheet | | Topic | In one line |",
      "|---|---|---|---|",
      ...g.items.map(([name, mark, titles, brief]) => `| ${name} | ${mark} | ${refs(titles, `sheet "${name}"`)} | ${brief} |`),
      "",
    ].join("\n")
  ).join("\n");

  // The same sub-goal can be on the sheet under two names; name each topic once.
  const named = (mark) =>
    SHEET.map((g) => g.items.filter(([, m]) => m === mark))
      .filter((items) => items.length)
      .map((items) => items.map(([name, , titles]) => `${name} (${ref(titles[0], name)})`).join(", "))
      .join("; ");

  const onSheet = new Set(rows.flatMap(([, , titles]) => titles));
  const notOnSheet = [...topics.values()].filter((t) => !onSheet.has(t.title));

  let n = 0;
  const body = goals
    .map((s) => [`## ${s.section}`, "", ...s.items.map(([status, title, entry]) => item(`${++n}. ${status} ${title}`, entry))].join("\n"))
    .join("\n");

  const builds = COULD_BUILD.map(([what, titles]) => `| ${what} | ${refs(titles, "COULD_BUILD")} |`).join("\n");

  const [inCode, partly, live, talk] = tally(rows);
  const added = [...topics.values()].filter((t) => t.n > 35);
  return `# Seat Planner — learning goals

The learning-goal topics this project covers, topic by topic. Topics 1 to 35 came first and keep their
numbers; ${added[0].n} to ${added[added.length - 1].n} were added so that every sub-goal on the goal sheet has a topic.
[The goal sheet, sub-goal by sub-goal](#the-goal-sheet-sub-goal-by-sub-goal) maps each line of the sheet to its topic.

For each topic: what it is (**Topic**), where and how Seat Planner uses it (**In Seat Planner**), and
where the code is (**Code**). Where a topic is shown by doing rather than by code there are steps
(**Do**), and where part or all of it has to be explained there are the points to make (**Explain**)
and the nearest thing in the project to point at (**Nearest thing here**).

${BRANCH_NOTE}

**How each topic is covered**

- ${DONE} **In the code** — the project demonstrates it. Open the linked code.
- ${PART} **Partly in the code** — show what is there; the rest is explained.
- ${LIVE} **Live demo** — a technique rather than code: done in front of people, on this project.
- ${TALK} **Explain** — not in this project. A short talk, with the nearest thing here to point at.
- ${PLAN} **Planned** — Phase 9 (hardening); not built.

## The goal sheet, sub-goal by sub-goal

Every sub-goal on the sheet, in the sheet's own order and wording, with the topic that covers it.
Where two topics are named, the first is the one to present from.

| Goal | Sub-goals | ${SHEET_MARKS.join(" | ")} |
|---|---|---|---|---|---|
${summary}
| **Total** | **${rows.length}** | **${inCode}** | **${partly}** | **${live}** | **${talk}** |

${sheet}
**For the theory session** — the ${talk} sub-goals that are explained and nothing else: ${named(TALK)}.

**To do live** — the ${live} that are shown by doing them: ${named(LIVE)}.

**Shown in part, the rest explained** — ${partly}: ${named(PART)}.

*Understand object tracking* is on the sheet twice under ORM; it is one line here.

In this guide but not on the sheet: ${notOnSheet.map((t) => `${t.title} ([${t.n}](#${t.anchor}))`).join(", ")}.

${body}
## Turning a talk into something to show

None of this is built. Each row is a piece of work that would move the topics beside it from being
explained, or planned, to being shown.

| What could be built | Topics it would move |
|---|---|
${builds}
`;
}

fs.mkdirSync(OUT, { recursive: true });
const links = (md) => (md.match(/\]\(\.\.\//g) || []).length;
const f = featuresDoc();
const g = goalsDoc();

// The frozen topics: from the first topic's section heading to the last frozen topic's last line.
{
  const first = [...topics.values()].find((t) => t.n === 1);
  const next = [...topics.values()].find((t) => t.n === FROZEN + 1);
  const from = g.indexOf(`## ${goals[0].section}\n`);
  const to = g.indexOf(`### ${next.n}. ${next.status} ${next.title}\n`);
  if (from < 0 || to < 0 || !g.slice(from, to).includes(`### 1. ${first.status} ${first.title}\n`)) throw new Error("the frozen topics could not be found in the guide");
  const wording = g.slice(from, to).replace(/#L\d+/g, "");
  const fingerprint = require("crypto").createHash("sha256").update(wording).digest("hex").slice(0, 16);
  if (fingerprint !== FROZEN_FINGERPRINT) {
    throw new Error(
      `topics 1 to ${FROZEN} are frozen and their wording has changed (fingerprint ${fingerprint}, expected ${FROZEN_FINGERPRINT}). ` +
        "Put the wording back; new material goes in a new topic at the end."
    );
  }
}

// Every link inside the goals guide must land on a heading that is there.
{
  const anchors = new Set([...g.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1])));
  for (const [, anchor] of g.matchAll(/\]\(#([^)]+)\)/g)) {
    if (!anchors.has(anchor)) throw new Error(`LEARNING-GOALS.md links to #${anchor}, which is not a heading`);
  }
  for (const [, anchor] of f.matchAll(/\]\(LEARNING-GOALS\.md#([^)]+)\)/g)) {
    if (!anchors.has(anchor)) throw new Error(`FEATURES.md links to LEARNING-GOALS.md#${anchor}, which is not a heading`);
  }
}

fs.writeFileSync(path.join(OUT, "FEATURES.md"), f);
fs.writeFileSync(path.join(OUT, "LEARNING-GOALS.md"), g);
console.log(`FEATURES.md: ${features.reduce((n, s) => n + s.items.length, 0)} features, ${links(f)} links`);
console.log(`LEARNING-GOALS.md: ${topics.size} topics (1 to ${FROZEN} frozen), ${SHEET.flatMap((s) => s.items).length} sub-goals on the sheet, ${links(g)} links`);
console.log(`counted: ${Object.entries(COUNT).map(([k, v]) => `${k} ${v}`).join(", ")}`);
