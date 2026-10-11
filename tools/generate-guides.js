// Builds docs/FEATURES.md and docs/LEARNING-GOALS.md.
//
// Every code link is resolved here against the files as they are: a link names
// a file and a piece of text on the line to open at, and the line number is
// looked up. Anything not found stops the build, so no link in the documents
// points at a line that is not there.
const fs = require("fs");
const path = require("path");

const ROOT = require("path").resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs");

const texts = {};
function lineOf(file, find) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) throw new Error(`missing file: ${file}`);
  texts[file] ??= fs.readFileSync(full, "utf8").split(/\r?\n/);
  const i = texts[file].findIndex((l) => l.includes(find));
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

let linkCount = 0;
const code = (...links) => {
  linkCount += links.length;
  return links.join(" · ");
};

/** One entry: topic, what the app does, where the code is (and optionally how to show it). */
function item(n, title, { topic, app, links, demo, status, goalTopics }) {
  return [
    `### ${n}. ${status ? `${status} ` : ""}${title}`,
    "",
    `**Topic.** ${topic}`,
    "",
    `**In Seat Planner.** ${app}`,
    "",
    `**Code.** ${links}`,
    ...(goalTopics !== undefined ? ["", `**Goal topics covered.** ${goalTopics}`] : []),
    ...(demo ? ["", `**Show it.** ${demo}`] : []),
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
        app: "The passenger search lists each departure whose route passes the two stations in order, with times worked out from each stop's day offset, the fare for every coach class, and how many seats are free for exactly that stretch. It is a separate API from the operators' departure board, so buying needs no operator permission.",
        links: code(L("searchService.departures", S("searchService"), "async function departures("), L("searchRoutes.js", `${B}routes/searchRoutes.js`), L("JourneyStep.js", `${F}components/booking/JourneyStep.js`), L("Book a Ticket page", `${F}app/dashboard/book/page.js`)),
        demo: "Sign in as user1@example.com → *Book a Ticket* → Dhaka (Kamalapur) to Dinajpur.",
      }],
      ["Stretch-by-stretch seat inventory", {
        topic: "On a train with many stops one seat can be sold several times on the same run, to people travelling different stretches. Selling whole seats per train wastes most of the capacity.",
        app: "A sale takes one row per seat per leg between consecutive stops (`seat_segment_bookings`). A seat is free for a journey when none of the legs that journey covers are taken, so a train that is \"full end to end\" can still have room on yours.",
        links: code(L("inventoryService.segmentsForJourney", S("inventoryService"), "function segmentsForJourney("), L("inventoryService.reserveSegments", S("inventoryService"), "async function reserveSegments("), L("availabilityService.forJourney", S("availabilityService"), "async function forJourney("), L("SeatSegmentBooking model", `${B}models/SeatSegmentBooking.js`), L("segment migration", "backend/migrations/20260105000000-segment-inventory.js")),
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
        links: code(L("autoSelect", `${B}utils/autoSelect.js`, "function autoSelect("), L("selectionService.selectAndHold", S("selectionService"), "async function selectAndHold("), L("SeatStep.js", `${F}components/booking/SeatStep.js`), L("CoachMap.js", `${F}components/booking/CoachMap.js`), L("autoSelect tests", "backend/tests/autoSelect.test.js")),
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
        links: code(L("ticketToken.sign", `${B}utils/ticketToken.js`, "function sign("), L("ticketToken.verify", `${B}utils/ticketToken.js`, "function verify("), L("ticketDocumentService.bookingPdf", S("ticketDocumentService"), "async function bookingPdf("), L("bookingService.deliver", S("bookingService"), "async function deliver("), L("ticketToken tests", "backend/tests/ticketToken.test.js")),
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
        links: code(L("refundPolicy.deductionPercentFor", `${B}utils/refundPolicy.js`, "function deductionPercentFor("), L("refundService.quote", S("refundService"), "async function quote("), L("refundService.request", S("refundService"), "async function request("), L("refundService.settleResold", S("refundService"), "async function settleResold("), L("ReturnTicketDialog.js", `${F}components/postsale/ReturnTicketDialog.js`), L("refundPolicy tests", "backend/tests/refundPolicy.test.js")),
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
        links: code(L("standing.roomFor", `${B}utils/standing.js`, "function roomFor("), L("standing.fareFor", `${B}utils/standing.js`, "function fareFor("), L("standingService.options", S("standingService"), "async function options("), L("standingService.purchase", S("standingService"), "async function purchase("), L("AddStandingDialog.js", `${F}components/postsale/AddStandingDialog.js`), L("standing tests", "backend/tests/standing.test.js")),
      }],
      ["Waitlist", {
        topic: "Queueing for a stretch that is sold out, so a seat that frees up goes to whoever asked first.",
        app: "Joining records the passengers' details up front. When a seat frees (a return, an abandoned checkout), the next person is offered it with a longer hold and an email; confirming is one click from the wallet.",
        links: code(L("waitlistService.join", S("waitlistService"), "async function join("), L("waitlistService.sweep", S("waitlistService"), "async function sweep("), L("waitlistService.offerTo", S("waitlistService"), "async function offerTo("), L("waitlistService.confirm", S("waitlistService"), "async function confirm("), L("JoinWaitlistDialog.js", `${F}components/booking/JoinWaitlistDialog.js`)),
      }],
      ["Accounts and travel profile", {
        topic: "Signing up, proving the email address is real, recovering a lost password, and recording the identity a ticket is issued to.",
        app: "Registration sends a 6-digit code; password reset signs out every other session. A name, National ID and date of birth are asked for once, before the first booking, and pre-fill every checkout after. Every sign-in, failure and reset is written to the audit log — never a password or a code.",
        links: code(L("authService.register", S("authService"), "async function register("), L("authService.login", S("authService"), "async function login("), L("authService.resetPassword", S("authService"), "async function resetPassword("), L("authService.updateProfile", S("authService"), "async function updateProfile("), L("Register page", `${F}app/register/page.js`), L("Profile page", `${F}app/dashboard/profile/page.js`)),
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
        app: "A grid editor for coach layouts with per-seat attributes (window, charging port, fan). Plans are submitted and approved or rejected; only approved plans can put seats into service.",
        links: code(L("PlanEditor.js", `${F}components/plans/PlanEditor.js`), L("SeatGrid.js", `${F}components/plans/SeatGrid.js`), L("normalizeLayout", `${B}utils/normalizeLayout.js`, "function normalizeLayout("), L("seatPlanService.approvePlan", S("seatPlanService"), "async function approvePlan(")),
        demo: "planner1@example.com → *Seat Plans*.",
      }],
      ["Compositions, schedules and the rolling horizon", {
        topic: "Turning \"this train runs Monday to Saturday with these coaches\" into concrete departures with sellable seats.",
        app: "Each train has a default coach list and a weekly schedule. A daily job keeps a configurable number of days of departures generated, copying the composition onto each one and materialising its seats from the approved layouts. It is idempotent — safe on a timer, on boot and by hand.",
        links: code(L("compositionService.set", S("compositionService"), "async function set("), L("scheduleService.set", S("scheduleService"), "async function set("), L("tripService.generateHorizon", S("tripService"), "async function generateHorizon("), L("materializeSeats", `${B}utils/seatMaterializer.js`, "function materializeSeats("), L("trip.horizon job", `${B}jobs/index.js`, 'register("trip.horizon"')),
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
    ],
  },
  {
    section: "For administrators",
    items: [
      ["Roles and permissions as data", {
        topic: "Deciding who may do what, without hard-coding roles into the program.",
        app: "A catalogue of 49 permissions is synced to the database on every start. Roles are ordinary rows built from them, a user can hold several, and an escalation guard stops anyone granting a permission they do not hold. The super admin implicitly holds everything. Menus hide what a person cannot use; the API is the real guard.",
        links: code(L("permission catalogue", `${B}constants/permissions.js`, "const PERMISSION_CATALOGUE"), L("roleService.assertCanGrantPermissions", S("roleService"), "function assertCanGrantPermissions("), L("permissionService.getAccess", S("permissionService"), "async function getAccess("), L("requirePermission", `${B}middleware/authorize.js`, "function requirePermission("), L("Roles page", `${F}app/dashboard/roles/page.js`)),
      }],
      ["Settings", {
        topic: "Every rule that might need tuning — timeouts, deductions, thresholds — changeable without a new release.",
        app: "34 typed settings with limits and descriptions, held in memory and changed at runtime from a settings screen.",
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
    ],
  },
  {
    section: "Platform",
    items: [
      ["Sign-in sessions", {
        topic: "Keeping people signed in safely: short-lived credentials that can be revoked.",
        app: "A short-lived JWT access token plus a refresh token that is rotated on every use and stored only as a hash. The browser refreshes automatically, sharing one refresh between simultaneous requests. A password reset signs out every session.",
        links: code(L("tokenService.issueRefreshToken", S("tokenService"), "async function issueRefreshToken("), L("tokenService.rotateRefreshToken", S("tokenService"), "async function rotateRefreshToken("), L("auth middleware", `${B}middleware/auth.js`), L("api.js (refresh)", `${F}lib/api.js`, "One refresh is attempted per failed")),
      }],
      ["Email", {
        topic: "Getting codes and tickets to people reliably, even where the host blocks ordinary mail ports.",
        app: "Mail goes through the Gmail API or Brevo over HTTPS in production, SMTP locally, or the console when nothing is configured. Every send has a time limit, a failure asks the person to try again, and reserved test domains are never actually mailed.",
        links: code(L("emailService.sendMail", S("emailService"), "async function sendMail("), L("sendWithGmail", S("emailService"), "async function sendWithGmail("), L("isUnroutable", S("emailService"), "const isUnroutable"), L("email tests", "backend/tests/emailGmail.test.js")),
      }],
      ["API documentation", {
        topic: "A machine-readable description of every endpoint, its permissions and its responses.",
        app: "An OpenAPI 3 spec of 113 paths, served at `/api/v1/openapi.json`.",
        links: code(L("openapi.js", `${B}docs/openapi.js`), L("served here", `${B}routes/index.js`, 'router.get("/openapi.json"')),
      }],
      ["Deployment", {
        topic: "Running the system somewhere other people can use it.",
        app: "Docker images for both halves; Docker Compose for self-hosting, with Caddy in front (it serves HTTPS automatically when given a domain); live on Vercel (web), Render (API), Aiven (MySQL) and MongoDB Atlas. Database migrations run on every start.",
        links: code(L("backend/Dockerfile", "backend/Dockerfile"), L("frontend/Dockerfile", "frontend/Dockerfile"), L("docker-compose.yml", "docker-compose.yml"), L("Caddyfile", "Caddyfile"), L("next.config.mjs (API proxy)", "frontend/next.config.mjs", "async rewrites()")),
      }],
      ["Responsive design system", {
        topic: "One interface that works as well on a checker's phone as on an operator's laptop.",
        app: "Design tokens and component styling in one theme; tables turn into cards on phones; every icon-only button has hover text; checked at laptop and phone width on every page.",
        links: code(L("theme.css", `${F}app/theme.css`), L("mobile.css", `${F}app/mobile.css`), L("DataTable.js", `${F}components/ui/DataTable.js`), L("tip.js", `${F}components/ui/tip.js`), L("DashboardShell.js", `${F}components/layout/DashboardShell.js`)),
      }],
    ],
  },
];

/* ======================================================================
 * LEARNING GOALS
 * ==================================================================== */

const DONE = "✅";
const PART = "🟡";
const PLAN = "⏳";

const goals = [
  {
    section: "Database — SQL",
    items: [
      [DONE, "Transactions and row locking", {
        topic: "A transaction makes several statements succeed or fail together; a row lock stops another transaction changing a row until this one finishes.",
        app: "A purchase writes the booking, tickets, seat segments, wallet debit and payment in one transaction, re-reading the hold with `SELECT … FOR UPDATE` in case it expired meanwhile. Wallet rows are locked the same way, so five simultaneous purchases on one wallet cannot overspend it.",
        links: code(L("booking transaction", S("bookingService"), "const booking = await sequelize.transaction(async (transaction) => {"), L("hold locked FOR UPDATE", S("bookingService"), "lock: transaction.LOCK.UPDATE"), L("wallet row lock", S("walletService"), "lock: transaction.LOCK.UPDATE")),
      }],
      [DONE, "Constraints and referential integrity", {
        topic: "Foreign keys with the right delete rule (restrict, cascade, set null) and unique keys keep the data consistent whatever the code does.",
        app: "A booking can never lose its departure (RESTRICT); a departure's coaches and seats go with it (CASCADE); a train cannot run twice on one date, nor have two coaches in one position (UNIQUE). Above all, a seat can be sold only once per leg: the unique key on (seat, segment) is the last guard against double-selling, even when two purchases race.",
        links: code(L("foreign-key helper", "backend/migrations/20260104000000-composition-and-trips.js", "const fk = (table, onDelete"), L("one departure per train per date", "backend/migrations/20260104000000-composition-and-trips.js", "trips_train_departure_date_unique"), L("one coach per position", "backend/migrations/20260104000000-composition-and-trips.js", 'type: "unique"'), L("one sale per seat per leg", "backend/migrations/20260105000000-segment-inventory.js", "seat_segment_bookings_seat_segment_unique"), L("booking tables", "backend/migrations/20260106000000-booking-and-payment.js")),
      }],
      [DONE, "Indexing", {
        topic: "Indexes shaped like the queries that use them.",
        app: "The job worker asks \"what is due?\" every few seconds, so the jobs table is indexed on exactly (status, run_after) and (status, lease_expires_at).",
        links: code(L("jobs indexes", "backend/migrations/20260117000000-jobs.js", 'addIndex("jobs", ["status", "run_after"])')),
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
        app: "In development every statement Sequelize runs is printed to the console; production turns it off.",
        links: code(L("logging option", `${B}config/database.js`, "logging:")),
      }],
      [DONE, "Data seeding", {
        topic: "Loading reference and sample data repeatably.",
        app: "Command-line seeders build users, seat plans, the network and departures, idempotently. The in-app Demo Data button builds the same data through the normal services.",
        links: code(L("importSeatPlans.js", `${B}seeders/importSeatPlans.js`), L("seedNetwork.js", `${B}seeders/seedNetwork.js`), L("seedDepartures.js", `${B}seeders/seedDepartures.js`), L("demoService.populate", S("demoService"), "async function populate(")),
      }],
      [DONE, "Migrations, and debugging a migration", {
        topic: "Versioned schema changes, and getting a risky one right against real data.",
        app: "19 migrations run on every deploy. One converted the first release's single `users.role` column into roles-as-data on the live database; it was rehearsed against a copy of the old schema before it ran.",
        links: code(L("role-column migration", "backend/migrations/20260101000001-rbac-from-role-column.js"), L("migration folder", "backend/migrations")),
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
        app: "Seeding uses `findOrCreate` so it can run twice; a unique-constraint violation anywhere is answered with a clear 409 instead of a crash.",
        links: code(L("findOrCreate", S("demoService"), "findOrCreate({ where: { name }"), L("unique violation → 409", `${B}middleware/errorHandler.js`, "SequelizeUniqueConstraintError")),
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
        links: code(L("email route logged at start", S("emailService"), 'console.info("[email] sending through the Gmail API")'), L("job worker errors", S("jobService"), "[jobs] worker loop error")),
      }],
      [PART, "Retention", {
        topic: "Keeping records only as long as they are useful.",
        app: "Partly: finished job records are pruned after a configurable number of days. Log rotation is Phase 9.",
        links: code(L("jobService.prune", S("jobService"), "async function prune(")),
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
        app: "205 unit tests cover money arithmetic, refund percentages, segment overlap, seat auto-selection, standing capacity, ticket signing and job retry timing.",
        links: code(L("refundPolicy tests", "backend/tests/refundPolicy.test.js"), L("autoSelect tests", "backend/tests/autoSelect.test.js"), L("money tests", "backend/tests/money.test.js"), L("availability tests", "backend/tests/availability.test.js")),
      }],
      [DONE, "Testing asynchronous code", {
        topic: "Testing code that waits on the network: timeouts, retries, failures.",
        app: "Email delivery is tested against local HTTP servers standing in for Google and Brevo — including a server that never answers (the send gives up in time) and a rejected token (refreshed and retried once).",
        links: code(L("Gmail tests", "backend/tests/emailGmail.test.js"), L("Brevo tests", "backend/tests/emailBrevo.test.js")),
      }],
      [PLAN, "Code coverage and CI", {
        topic: "Measuring how much code the tests exercise, and running them automatically on every change.",
        app: "Phase 9, step 1: move the 39 integration suites into the repository, measure coverage, and run everything on GitHub Actions against a MySQL service on every push.",
        links: code(L("build plan, Phase 9", "REQUIREMENTS.md")),
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
        app: "TLS to the database; a CORS allow-list; secrets only in environment variables; mail sent over HTTPS because the host blocks SMTP.",
        links: code(L("database TLS", `${B}config/database.js`, "ssl:"), L("CORS allow-list", `${B}app.js`, "function isAllowedOrigin("), L("email over HTTPS", S("emailService"), "async function sendWithGmail(")),
      }],
      [PART, "CI/CD", {
        topic: "Building, testing and deploying automatically from the repository.",
        app: "Partly: Vercel deploys the web app on every push; the API deploy is started by hand. An automated test gate is Phase 9.",
        links: code(L("README: Deployment", "README.md")),
      }],
      [PART, "Rollback and disaster recovery", {
        topic: "Undoing a bad release, and recovering lost data.",
        app: "Partly: every migration has a `down` step. Scheduled database backups are still to do.",
        links: code(L("a down() step", "backend/migrations/20260117000000-jobs.js", "async down(")),
      }],
      [PLAN, "Monitoring", {
        topic: "Knowing the system is healthy before users say otherwise.",
        app: "Phase 9, step 5: a metrics endpoint, uptime checks, and alerts when background jobs fail.",
        links: code(L("build plan, Phase 9", "REQUIREMENTS.md")),
      }],
    ],
  },
  {
    section: "Also exercised",
    items: [
      [DONE, "Concurrency and isolation", {
        topic: "Many people acting on the same seats and money at the same moment.",
        app: "Seat holds claim segments atomically — the unique key on (seat, segment) makes the loser of a race fail cleanly — wallet rows are locked, background jobs use leases with heartbeats, and de-duplication keys stop two clicks queueing two mass refunds.",
        links: code(L("holdService.create", S("holdService"), "async function create("), L("seat-segment unique key", "backend/migrations/20260105000000-segment-inventory.js", "seat_segment_bookings_seat_segment_unique"), L("job de-duplication", S("jobService"), "if (dedupeKey)"), L("lease heartbeat", S("jobService"), "const heartbeat = () =>")),
      }],
      [DONE, "Authentication and authorization", {
        topic: "Proving who someone is, and deciding what they may do.",
        app: "Hashed passwords, short-lived JWTs with rotating refresh tokens, and permissions as data with an escalation guard.",
        links: code(L("tokenService.rotateRefreshToken", S("tokenService"), "async function rotateRefreshToken("), L("escalation guard", S("roleService"), "function assertCanGrantPermissions(")),
      }],
    ],
  },
];

/* ======================================================================
 * Which learning-goal topics each feature exercises
 * ==================================================================== */

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
  "Roles and permissions as data": ["Authentication and authorization", "Caching", "Complex mappings and constraints", "Migrations, and debugging a migration"],
  "Settings": ["Caching"],
  "Audit log": ["A document store beside the relational database", "Logging objects and structured records", "Correlating entries to one request"],
  "Demo data": ["Object tracking and hooks", "Data seeding", "Transactions: commit and rollback", "Complex querying: subqueries, grouping, filtered includes", "Duplicate entries", "Constraints and referential integrity"],
  "Sign-in sessions": ["Authentication and authorization"],
  "Email": ["Testing asynchronous code", "Security in deployment", "Caching", "Basic logging and log levels"],
  "API documentation": [],
  "Deployment": ["Dockerfile basics and dockerizing Node.js", "Docker Compose, environment, volumes and networking", "Cloud deployment", "Security in deployment", "Schema deployment strategy", "CI/CD", "Rollback and disaster recovery"],
  "Responsive design system": [],
};

// Where each goal topic's heading is in LEARNING-GOALS.md, numbered as that document numbers them.
const goalAnchors = new Map();
{
  let n = 0;
  for (const s of goals) {
    for (const [status, title] of s.items) {
      n += 1;
      goalAnchors.set(title, { status, anchor: slug(`${n}. ${status} ${title}`) });
    }
  }
}

for (const s of features) {
  for (const [title, entry] of s.items) {
    const topics = FEATURE_GOALS[title];
    if (!topics) throw new Error(`no goal topics listed for feature "${title}"`);
    entry.goalTopics = topics.length
      ? topics
          .map((goal) => {
            const found = goalAnchors.get(goal);
            if (!found) throw new Error(`feature "${title}": unknown goal topic "${goal}"`);
            return `${found.status} [${goal}](LEARNING-GOALS.md#${found.anchor})`;
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
    .map((s) => [`## ${s.section}`, "", ...s.items.map(([title, entry]) => item(++n, title, entry))].join("\n"))
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
  let n = 0;
  const all = goals.flatMap((s) => s.items);
  const count = (mark) => all.filter(([status]) => status === mark).length;
  const summary = goals
    .map((s) => {
      const c = (mark) => s.items.filter(([st]) => st === mark).length;
      return `| ${s.section} | ${c(DONE)} | ${c(PART)} | ${c(PLAN)} |`;
    })
    .join("\n");
  const body = goals
    .map((s) => [`## ${s.section}`, "", ...s.items.map(([status, title, entry]) => item(++n, title, { ...entry, status }))].join("\n"))
    .join("\n");
  return `# Seat Planner — learning goals

The learning-goal topics this project exercises, topic by topic. For each: what the topic is
(**Topic**), where and how Seat Planner uses it (**In Seat Planner**), and where the code is (**Code**).

${BRANCH_NOTE}

**Status:** ${DONE} demonstrated in the code · ${PART} partly · ${PLAN} planned for Phase 9 (hardening)

| Area | ${DONE} | ${PART} | ${PLAN} |
|---|---|---|---|
${summary}
| **Total** | **${count(DONE)}** | **${count(PART)}** | **${count(PLAN)}** |

Not covered by this codebase: *Debugging Techniques (Advanced)* and *Operating System (Advanced)* —
skills practised while building it, but with no code of their own to point to; and *Jenkins*, as CI
here is planned on GitHub Actions.

${body}`;
}

fs.mkdirSync(OUT, { recursive: true });
const links = (md) => (md.match(/\]\(\.\.\//g) || []).length;
const f = featuresDoc();
const g = goalsDoc();
fs.writeFileSync(path.join(OUT, "FEATURES.md"), f);
fs.writeFileSync(path.join(OUT, "LEARNING-GOALS.md"), g);
console.log(`FEATURES.md: ${features.reduce((n, s) => n + s.items.length, 0)} features, ${links(f)} links`);
console.log(`LEARNING-GOALS.md: ${goals.reduce((n, s) => n + s.items.length, 0)} topics, ${links(g)} links`);
