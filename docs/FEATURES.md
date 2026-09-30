# Seat Planner — features

What the system does, feature by feature. For each: the problem it addresses (**Topic**), how Seat
Planner handles it (**In Seat Planner**), where the code is (**Code**), which learning-goal topics it
exercises (**Goal topics covered**, linking into [LEARNING-GOALS.md](LEARNING-GOALS.md) — ✅ demonstrated,
🟡 partly), and — where there is a screen to show — how to show it (**Show it**).

Code links open the file at the line where the feature lives — on GitHub, or in VS Code's Markdown preview.

**Demo accounts** (created by *Administration → Demo Data → Populate*):

| Role | Email | Password |
|---|---|---|
| Passenger | user1@example.com | User123! |
| Planner | planner1@example.com | Planner123! |
| Admin | admin1@example.com | Admin123! |
| Ticket checker | checker1@example.com | Checker123! |

The super admin is the account set in the API's `.env`.

On a database where a role called `admin` (or `planner`) already existed, *Populate* uses it as it is
rather than changing it, and lists under *Worth knowing* which permissions it lacks. Grant those on
*Administration → Roles* before showing the operator screens as admin1.

**Sections**

- [For passengers](#for-passengers) — 13
- [For staff on the train](#for-staff-on-the-train) — 3
- [For operators](#for-operators) — 7
- [For administrators](#for-administrators) — 4
- [Platform](#platform) — 5

## For passengers

### 1. Search trains between any two stations

**Topic.** Finding every train that calls at both stations, in that order, on a given day — including overnight services whose later stops fall on the next calendar day.

**In Seat Planner.** The passenger search lists each departure whose route passes the two stations in order, with times worked out from each stop's day offset, the fare for every coach class, and how many seats are free for exactly that stretch. It is a separate API from the operators' departure board, so buying needs no operator permission.

**Code.** [searchService.departures](../backend/src/services/searchService.js#L52) · [searchRoutes.js](../backend/src/routes/searchRoutes.js) · [JourneyStep.js](../frontend/src/components/booking/JourneyStep.js) · [Book a Ticket page](../frontend/src/app/dashboard/book/page.js)

**Goal topics covered.** ✅ [Complex querying: subqueries, grouping, filtered includes](LEARNING-GOALS.md#6--complex-querying-subqueries-grouping-filtered-includes) · ✅ [Lazy and eager loading](LEARNING-GOALS.md#12--lazy-and-eager-loading)

**Show it.** Sign in as user1@example.com → *Book a Ticket* → Dhaka (Kamalapur) to Dinajpur.

### 2. Stretch-by-stretch seat inventory

**Topic.** On a train with many stops one seat can be sold several times on the same run, to people travelling different stretches. Selling whole seats per train wastes most of the capacity.

**In Seat Planner.** A sale takes one row per seat per leg between consecutive stops (`seat_segment_bookings`). A seat is free for a journey when none of the legs that journey covers are taken, so a train that is "full end to end" can still have room on yours.

**Code.** [inventoryService.segmentsForJourney](../backend/src/services/inventoryService.js#L61) · [inventoryService.reserveSegments](../backend/src/services/inventoryService.js#L84) · [availabilityService.forJourney](../backend/src/services/availabilityService.js#L155) · [SeatSegmentBooking model](../backend/src/models/SeatSegmentBooking.js) · [segment migration](../backend/migrations/20260105000000-segment-inventory.js)

**Goal topics covered.** ✅ [Constraints and referential integrity](LEARNING-GOALS.md#2--constraints-and-referential-integrity) · ✅ [Transactions and row locking](LEARNING-GOALS.md#1--transactions-and-row-locking) · ✅ [Concurrency and isolation](LEARNING-GOALS.md#34--concurrency-and-isolation) · ✅ [Test-driven style on pure logic](LEARNING-GOALS.md#24--test-driven-style-on-pure-logic)

### 3. "Where is there room?" matrix

**Topic.** A grid of free seats for every from/to station pair on one departure — the quickest way to see where a busy train still has space.

**In Seat Planner.** Computed from the same segment data as a single search, shown as a colour-scaled matrix to passengers and operators.

**Code.** [availabilityService.matrix](../backend/src/services/availabilityService.js#L210) · [AvailabilityMatrix.js](../frontend/src/components/booking/AvailabilityMatrix.js) · [PairMatrix.js](../frontend/src/components/ui/PairMatrix.js)

**Goal topics covered.** ✅ [Complex querying: subqueries, grouping, filtered includes](LEARNING-GOALS.md#6--complex-querying-subqueries-grouping-filtered-includes)

**Show it.** On a search result, open *Where is there room?*.

### 4. Seat map and automatic seat choice

**Topic.** Choosing seats either by pointing at a coach map or by stating preferences and letting the system pick.

**In Seat Planner.** Coach maps are drawn from each coach's approved layout. Auto-select honours criteria (window, charging port, fan), can keep a group together (side by side, then same row, nearby, same coach), and in strict mode refuses rather than compromise. Coach class and fare are shown wherever seats are compared.

**Code.** [autoSelect](../backend/src/utils/autoSelect.js#L196) · [selectionService.selectAndHold](../backend/src/services/selectionService.js#L127) · [SeatStep.js](../frontend/src/components/booking/SeatStep.js) · [CoachMap.js](../frontend/src/components/booking/CoachMap.js) · [autoSelect tests](../backend/tests/autoSelect.test.js)

**Goal topics covered.** ✅ [Test-driven style on pure logic](LEARNING-GOALS.md#24--test-driven-style-on-pure-logic)

### 5. Timed checkout hold, resumable anywhere

**Topic.** Seats must be reserved briefly while someone pays, or two people can buy the same seat — but a reservation nobody finishes must not keep seats off sale.

**In Seat Planner.** A hold takes the seat segments for a configurable number of minutes; a background job returns expired holds to sale. The hold reference lives in the URL, so a checkout resumes after a closed tab or on another device, and open checkouts are listed with a countdown.

**Code.** [holdService.create](../backend/src/services/holdService.js#L60) · [holdService.expireDue](../backend/src/services/holdService.js#L185) · [hold.expire job](../backend/src/jobs/index.js#L113) · [OpenCheckouts.js](../frontend/src/components/booking/OpenCheckouts.js) · [HoldTimer.js](../frontend/src/components/booking/HoldTimer.js)

**Goal topics covered.** ✅ [Concurrency and isolation](LEARNING-GOALS.md#34--concurrency-and-isolation) · ✅ [Constraints and referential integrity](LEARNING-GOALS.md#2--constraints-and-referential-integrity) · ✅ [Transactions and row locking](LEARNING-GOALS.md#1--transactions-and-row-locking)

### 6. Paying: wallet, card or mobile banking, or a split

**Topic.** Turning a held set of seats into tickets and taking the money for them, without ever charging twice or selling a seat twice.

**In Seat Planner.** Pay from the wallet, by a simulated card or mobile-banking gateway, or a split of both. The booking, its tickets, the seat segments, the wallet debit and the payment record are written in one transaction, with the hold re-read under a row lock in case it expired while paying.

**Code.** [bookingService.create](../backend/src/services/bookingService.js#L162) · [paymentService.collect](../backend/src/services/paymentService.js#L86) · [walletService.charge](../backend/src/services/walletService.js#L139) · [PaymentStep.js](../frontend/src/components/booking/PaymentStep.js) · [FakeGatewayDialog.js](../frontend/src/components/payment/FakeGatewayDialog.js)

**Goal topics covered.** ✅ [Transactions and row locking](LEARNING-GOALS.md#1--transactions-and-row-locking) · ✅ [Transactions: commit and rollback](LEARNING-GOALS.md#7--transactions-commit-and-rollback) · ✅ [Concurrency and isolation](LEARNING-GOALS.md#34--concurrency-and-isolation)

### 7. Tickets: signed QR code, PDF and email

**Topic.** Proof of purchase that a checker can trust without trusting the person holding it.

**In Seat Planner.** Each ticket's QR code carries an HMAC-signed token, so a forged or altered ticket fails verification even offline. Tickets come as a PDF (one page each) and by email with the PDF attached; the email is sent after the sale completes, so the passenger never waits on it.

**Code.** [ticketToken.sign](../backend/src/utils/ticketToken.js#L37) · [ticketToken.verify](../backend/src/utils/ticketToken.js#L79) · [ticketDocumentService.bookingPdf](../backend/src/services/ticketDocumentService.js#L165) · [bookingService.deliver](../backend/src/services/bookingService.js#L361) · [ticketToken tests](../backend/tests/ticketToken.test.js)

**Goal topics covered.** ✅ [Test-driven style on pure logic](LEARNING-GOALS.md#24--test-driven-style-on-pure-logic) · ✅ [Testing asynchronous code](LEARNING-GOALS.md#25--testing-asynchronous-code)

### 8. Wallet

**Topic.** A stored balance for one-click payment and for refunds to land in.

**In Seat Planner.** An append-only ledger with a cached balance, updated under a row lock so simultaneous purchases cannot overspend it. Top-ups are simulated; withdrawals go to an approval queue; a balance cap applies; the ledger can be re-added to prove the balance.

**Code.** [walletService.post](../backend/src/services/walletService.js#L42) · [walletService.verify](../backend/src/services/walletService.js#L238) · [Wallet page](../frontend/src/app/dashboard/wallet/page.js)

**Goal topics covered.** ✅ [Transactions and row locking](LEARNING-GOALS.md#1--transactions-and-row-locking) · ✅ [Concurrency and isolation](LEARNING-GOALS.md#34--concurrency-and-isolation) · ✅ [Test-driven style on pure logic](LEARNING-GOALS.md#24--test-driven-style-on-pure-logic)

**Show it.** user1@example.com → *Wallet*.

### 9. Returning a ticket

**Topic.** Giving a ticket back for money, under rules that are fair to the passenger and to the railway.

**In Seat Planner.** Two policies. *Convenient*: refunded at once, less a deduction that grows as departure approaches (time slabs, with a floor and a cap). *Demand*: refunded segment by segment as the seat is resold — no resale, no refund. Each departure can switch either policy off.

**Code.** [refundPolicy.deductionPercentFor](../backend/src/utils/refundPolicy.js#L50) · [refundService.quote](../backend/src/services/refundService.js#L115) · [refundService.request](../backend/src/services/refundService.js#L251) · [refundService.settleResold](../backend/src/services/refundService.js#L474) · [ReturnTicketDialog.js](../frontend/src/components/postsale/ReturnTicketDialog.js) · [refundPolicy tests](../backend/tests/refundPolicy.test.js)

**Goal topics covered.** ✅ [Test-driven style on pure logic](LEARNING-GOALS.md#24--test-driven-style-on-pure-logic) · ✅ [Transactions and row locking](LEARNING-GOALS.md#1--transactions-and-row-locking) · ✅ [Transactions: commit and rollback](LEARNING-GOALS.md#7--transactions-commit-and-rollback)

**Show it.** user1@example.com → *My Returns* shows one settled and one waiting on resale.

### 10. Transferring a ticket to someone else

**Topic.** A ticket is valid only for the named passenger, so passing it on needs someone to approve the change.

**In Seat Planner.** The holder asks for a transfer to a new name and National ID; it waits in an approval queue; approving reissues the ticket, re-checking inside the deciding transaction that it is still valid.

**Code.** [postSaleService.requestTransfer](../backend/src/services/postSaleService.js#L40) · [approvalService.decide](../backend/src/services/approvalService.js#L117) · [TransferTicketDialog.js](../frontend/src/components/postsale/TransferTicketDialog.js) · [Requests page](../frontend/src/app/dashboard/requests/page.js)

**Goal topics covered.** ✅ [Transactions: commit and rollback](LEARNING-GOALS.md#7--transactions-commit-and-rollback) · ✅ [Transactions and row locking](LEARNING-GOALS.md#1--transactions-and-row-locking)

**Show it.** admin1@example.com → *Requests* has a transfer waiting.

### 11. Connecting standing ticket

**Topic.** Letting a passenger travel beyond the stretch they have a seat for, standing, when no seat is free for the rest.

**In Seat Planner.** A standing leg can join a seated ticket end to end. Standing capacity is set per coach class and enforced per segment; the fare is a share of the seated fare; standing follows its seat through a refund.

**Code.** [standing.roomFor](../backend/src/utils/standing.js#L81) · [standing.fareFor](../backend/src/utils/standing.js#L129) · [standingService.options](../backend/src/services/standingService.js#L104) · [standingService.purchase](../backend/src/services/standingService.js#L259) · [AddStandingDialog.js](../frontend/src/components/postsale/AddStandingDialog.js) · [standing tests](../backend/tests/standing.test.js)

**Goal topics covered.** ✅ [Test-driven style on pure logic](LEARNING-GOALS.md#24--test-driven-style-on-pure-logic) · ✅ [Concurrency and isolation](LEARNING-GOALS.md#34--concurrency-and-isolation)

### 12. Waitlist

**Topic.** Queueing for a stretch that is sold out, so a seat that frees up goes to whoever asked first.

**In Seat Planner.** Joining records the passengers' details up front. When a seat frees (a return, an abandoned checkout), the next person is offered it with a longer hold and an email; confirming is one click from the wallet.

**Code.** [waitlistService.join](../backend/src/services/waitlistService.js#L214) · [waitlistService.sweep](../backend/src/services/waitlistService.js#L345) · [waitlistService.offerTo](../backend/src/services/waitlistService.js#L409) · [waitlistService.confirm](../backend/src/services/waitlistService.js#L558) · [JoinWaitlistDialog.js](../frontend/src/components/booking/JoinWaitlistDialog.js)

**Goal topics covered.** ✅ [Concurrency and isolation](LEARNING-GOALS.md#34--concurrency-and-isolation) · ✅ [Transactions: commit and rollback](LEARNING-GOALS.md#7--transactions-commit-and-rollback)

### 13. Accounts and travel profile

**Topic.** Signing up, proving the email address is real, recovering a lost password, and recording the identity a ticket is issued to.

**In Seat Planner.** Registration sends a 6-digit code; password reset signs out every other session. A name, National ID and date of birth are asked for once, before the first booking, and pre-fill every checkout after. Every sign-in, failure and reset is written to the audit log — never a password or a code.

**Code.** [authService.register](../backend/src/services/authService.js#L77) · [authService.login](../backend/src/services/authService.js#L172) · [authService.resetPassword](../backend/src/services/authService.js#L273) · [authService.updateProfile](../backend/src/services/authService.js#L337) · [Register page](../frontend/src/app/register/page.js) · [Profile page](../frontend/src/app/dashboard/profile/page.js)

**Goal topics covered.** ✅ [Authentication and authorization](LEARNING-GOALS.md#35--authentication-and-authorization) · ✅ [Logging objects and structured records](LEARNING-GOALS.md#19--logging-objects-and-structured-records) · ✅ [Duplicate entries](LEARNING-GOALS.md#14--duplicate-entries)

## For staff on the train

### 14. Checking tickets

**Topic.** Deciding at the door whether a ticket is genuine, still valid, and for this train.

**In Seat Planner.** Scan the QR with a phone camera or type the ticket number. Eight distinct verdicts, each with its own message (already used, refunded, transferred, wrong service…). *Scan* admits the passenger and marks the ticket used under a row lock; *check* only looks. Every attempt is logged, forgeries included.

**Code.** [verificationService.judge](../backend/src/services/verificationService.js#L128) · [verificationService.resolve](../backend/src/services/verificationService.js#L242) · [QrScanner.js](../frontend/src/components/checking/QrScanner.js) · [Check Tickets page](../frontend/src/app/dashboard/checker/page.js)

**Goal topics covered.** ✅ [Transactions and row locking](LEARNING-GOALS.md#1--transactions-and-row-locking) · ✅ [Concurrency and isolation](LEARNING-GOALS.md#34--concurrency-and-isolation)

**Show it.** checker1@example.com → *Check Tickets*; type a ticket number from user1's bookings.

### 15. Checking with no signal

**Topic.** Trains lose signal; checking must carry on and reconcile later.

**In Seat Planner.** A manifest downloaded before departure says which tickets have since been refunded, cancelled or used. Scans made offline are uploaded later; each carries the device's own reference, so a retried upload never counts a scan twice.

**Code.** [verificationService.manifest](../backend/src/services/verificationService.js#L422) · [verificationService.sync](../backend/src/services/verificationService.js#L490)

**Goal topics covered.** ✅ [Duplicate entries](LEARNING-GOALS.md#14--duplicate-entries)

### 16. Reporting, abuse score and account holds

**Topic.** Catching people who misuse tickets, without punishing anyone on an accusation alone.

**In Seat Planner.** A checker reports a ticket; a reviewer upholds or dismisses it. A score adds up upheld reports, duplicate scans and buy-and-return churn — every weight a setting. A hold stops an account buying and nothing else, is always reversible with a reason, and automatic holds are off by default.

**Code.** [abuseService.report](../backend/src/services/abuseService.js#L64) · [abuseService.review](../backend/src/services/abuseService.js#L118) · [abuseService.scoreFor](../backend/src/services/abuseService.js#L189) · [abuseService.hold](../backend/src/services/abuseService.js#L322) · [Reported Tickets page](../frontend/src/app/dashboard/reports/page.js)

**Goal topics covered.** ✅ [Complex querying: subqueries, grouping, filtered includes](LEARNING-GOALS.md#6--complex-querying-subqueries-grouping-filtered-includes) · ✅ [Logging objects and structured records](LEARNING-GOALS.md#19--logging-objects-and-structured-records)

**Show it.** admin1@example.com → *Reported Tickets* has checker1's report.

## For operators

### 17. Stations, trains and routes

**Topic.** The network: which trains call where, when, and how far apart.

**In Seat Planner.** A route builder records arrival and departure times, distances, and a day offset per stop — so an overnight train's stops after midnight fall on the right date everywhere downstream.

**Code.** [trainService.setRoute](../backend/src/services/trainService.js#L140) · [RouteBuilder.js](../frontend/src/components/network/RouteBuilder.js) · [StationManager.js](../frontend/src/components/network/StationManager.js)

**Goal topics covered.** ✅ [Complex mappings and constraints](LEARNING-GOALS.md#11--complex-mappings-and-constraints) · ✅ [Data seeding](LEARNING-GOALS.md#9--data-seeding)

**Show it.** admin1@example.com → *Network* → Ekota Express (its later stops are on day +1).

### 18. Fares

**Topic.** Pricing every station pair in every class without writing a price for each one.

**In Seat Planner.** A chain of rules by priority: a published price table for particular pairs beats a per-kilometre fallback with a minimum fare. Rules can be scoped to a train and a class; a matrix previews the result.

**Code.** [fareService.resolveFare](../backend/src/services/fareService.js#L191) · [fareService.fareMatrix](../backend/src/services/fareService.js#L273) · [FareManager.js](../frontend/src/components/network/FareManager.js)

**Goal topics covered.** ✅ [Complex querying: subqueries, grouping, filtered includes](LEARNING-GOALS.md#6--complex-querying-subqueries-grouping-filtered-includes)

### 19. Seat plan designer and approval

**Topic.** Describing each coach's seat layout, and making sure nobody sells seats from a layout still being drawn.

**In Seat Planner.** A grid editor for coach layouts with per-seat attributes (window, charging port, fan). Plans are submitted and approved or rejected; only approved plans can put seats into service.

**Code.** [PlanEditor.js](../frontend/src/components/plans/PlanEditor.js) · [SeatGrid.js](../frontend/src/components/plans/SeatGrid.js) · [normalizeLayout](../backend/src/utils/normalizeLayout.js#L76) · [seatPlanService.approvePlan](../backend/src/services/seatPlanService.js#L154)

**Goal topics covered.** ✅ [Data seeding](LEARNING-GOALS.md#9--data-seeding)

**Show it.** planner1@example.com → *Seat Plans*.

### 20. Compositions, schedules and the rolling horizon

**Topic.** Turning "this train runs Monday to Saturday with these coaches" into concrete departures with sellable seats.

**In Seat Planner.** Each train has a default coach list and a weekly schedule. A daily job keeps a configurable number of days of departures generated, copying the composition onto each one and materialising its seats from the approved layouts. It is idempotent — safe on a timer, on boot and by hand.

**Code.** [compositionService.set](../backend/src/services/compositionService.js#L45) · [scheduleService.set](../backend/src/services/scheduleService.js#L22) · [tripService.generateHorizon](../backend/src/services/tripService.js#L140) · [materializeSeats](../backend/src/utils/seatMaterializer.js#L41) · [trip.horizon job](../backend/src/jobs/index.js#L87)

**Goal topics covered.** ✅ [Lazy and eager loading](LEARNING-GOALS.md#12--lazy-and-eager-loading) · ✅ [Constraints and referential integrity](LEARNING-GOALS.md#2--constraints-and-referential-integrity) · ✅ [Duplicate entries](LEARNING-GOALS.md#14--duplicate-entries)

### 21. Running departures: cancel, reinstate, coaches

**Topic.** What happens when a service or one coach cannot run — everyone aboard must get their money back and be told.

**In Seat Planner.** Cancelling a departure or a single coach refunds every ticket in full through a background job, one email per passenger. Coaches can be added from approved plans, removed only if no ticket has ever used them, cancelled and reinstated; reinstating is refused while refunds are still being issued.

**Code.** [tripService.cancel](../backend/src/services/tripService.js#L481) · [coachService.cancel](../backend/src/services/coachService.js#L297) · [coachService.add](../backend/src/services/coachService.js#L138) · [TripCoachesDialog.js](../frontend/src/components/departures/TripCoachesDialog.js) · [RefundJobBanner.js](../frontend/src/components/departures/RefundJobBanner.js)

**Goal topics covered.** ✅ [Transactions: commit and rollback](LEARNING-GOALS.md#7--transactions-commit-and-rollback) · ✅ [Concurrency without holding locks](LEARNING-GOALS.md#4--concurrency-without-holding-locks) · ✅ [Concurrency and isolation](LEARNING-GOALS.md#34--concurrency-and-isolation)

**Show it.** admin1@example.com → *Departures* → a departure → *Cancel*.

### 22. Seat inventory, quotas and blocks

**Topic.** Seeing who holds each seat for which stretch, and keeping some seats back for particular journeys.

**In Seat Planner.** A per-seat occupancy map shows every holder by stretch. Quota rules keep seats for a station pair and release them automatically a set time before departure; individual seats can be blocked.

**Code.** [availabilityService.occupancy](../backend/src/services/availabilityService.js#L325) · [quotaService.materialiseForTrip](../backend/src/services/quotaService.js#L188) · [quotaService.releaseDue](../backend/src/services/quotaService.js#L459) · [inventoryService.blockSeat](../backend/src/services/inventoryService.js#L147) · [SeatOccupancy.js](../frontend/src/components/inventory/SeatOccupancy.js)

**Goal topics covered.** ✅ [Complex querying: subqueries, grouping, filtered includes](LEARNING-GOALS.md#6--complex-querying-subqueries-grouping-filtered-includes) · ✅ [Constraints and referential integrity](LEARNING-GOALS.md#2--constraints-and-referential-integrity)

### 23. Background jobs

**Topic.** Work too big or too slow for one web request — a mass refund must survive a restart halfway through.

**In Seat Planner.** Jobs are rows in a table, claimed under a renewable lease, retried with growing waits, de-duplicated per subject, and reported with progress. A screen shows what is running and what failed, and sends a failed job round again.

**Code.** [jobService.enqueue](../backend/src/services/jobService.js#L97) · [jobService.claimNext](../backend/src/services/jobService.js#L152) · [jobService.run](../backend/src/services/jobService.js#L189) · [job handlers](../backend/src/jobs/handlers.js#L55) · [Background Jobs page](../frontend/src/app/dashboard/jobs/page.js)

**Goal topics covered.** ✅ [Concurrency without holding locks](LEARNING-GOALS.md#4--concurrency-without-holding-locks) · ✅ [Indexing](LEARNING-GOALS.md#3--indexing) · ✅ [Transactions: commit and rollback](LEARNING-GOALS.md#7--transactions-commit-and-rollback) · 🟡 [Retention](LEARNING-GOALS.md#22--retention) · 🟡 [Basic logging and log levels](LEARNING-GOALS.md#21--basic-logging-and-log-levels)

## For administrators

### 24. Roles and permissions as data

**Topic.** Deciding who may do what, without hard-coding roles into the program.

**In Seat Planner.** A catalogue of 49 permissions is synced to the database on every start. Roles are ordinary rows built from them, a user can hold several, and an escalation guard stops anyone granting a permission they do not hold. The super admin implicitly holds everything. Menus hide what a person cannot use; the API is the real guard.

**Code.** [permission catalogue](../backend/src/constants/permissions.js#L99) · [roleService.assertCanGrantPermissions](../backend/src/services/roleService.js#L24) · [permissionService.getAccess](../backend/src/services/permissionService.js#L95) · [requirePermission](../backend/src/middleware/authorize.js#L17) · [Roles page](../frontend/src/app/dashboard/roles/page.js)

**Goal topics covered.** ✅ [Authentication and authorization](LEARNING-GOALS.md#35--authentication-and-authorization) · ✅ [Caching](LEARNING-GOALS.md#15--caching) · ✅ [Complex mappings and constraints](LEARNING-GOALS.md#11--complex-mappings-and-constraints) · ✅ [Migrations, and debugging a migration](LEARNING-GOALS.md#10--migrations-and-debugging-a-migration)

### 25. Settings

**Topic.** Every rule that might need tuning — timeouts, deductions, thresholds — changeable without a new release.

**In Seat Planner.** 34 typed settings with limits and descriptions, held in memory and changed at runtime from a settings screen.

**Code.** [settingDefinitions.js](../backend/src/constants/settingDefinitions.js) · [settingService.get](../backend/src/services/settingService.js#L43) · [settingService.set](../backend/src/services/settingService.js#L88) · [Settings page](../frontend/src/app/dashboard/settings/page.js)

**Goal topics covered.** ✅ [Caching](LEARNING-GOALS.md#15--caching)

### 26. Audit log

**Topic.** A trustworthy record of who did what, from where — the first place to look when something goes wrong.

**In Seat Planner.** Every privileged action and every sign-in attempt is written to MongoDB with the actor, IP address, browser, and before/after values, and can be filtered on screen.

**Code.** [auditService.record](../backend/src/services/auditService.js#L18) · [requestContext](../backend/src/utils/requestContext.js#L16) · [AuditEvent model](../backend/src/models/mongo/AuditEvent.js) · [Audit Log page](../frontend/src/app/dashboard/audit/page.js)

**Goal topics covered.** ✅ [A document store beside the relational database](LEARNING-GOALS.md#18--a-document-store-beside-the-relational-database) · ✅ [Logging objects and structured records](LEARNING-GOALS.md#19--logging-objects-and-structured-records) · ✅ [Correlating entries to one request](LEARNING-GOALS.md#20--correlating-entries-to-one-request)

### 27. Demo data

**Topic.** Filling a system with realistic data to show it — and taking it away again without touching anything real.

**In Seat Planner.** One button builds demo accounts, seat plans, a network, departures and sample bookings through the normal services; another deletes exactly what the demo created. Existing data is adopted, never modified; the delete refuses while someone outside the demo holds a valid ticket on a demo departure.

**Code.** [demoService.populate](../backend/src/services/demoService.js#L814) · [demoService.clear](../backend/src/services/demoService.js#L884) · [demoService.blockers](../backend/src/services/demoService.js#L206) · [demoCapture.install](../backend/src/utils/demoCapture.js#L50) · [Demo Data page](../frontend/src/app/dashboard/demo-data/page.js)

**Goal topics covered.** ✅ [Object tracking and hooks](LEARNING-GOALS.md#13--object-tracking-and-hooks) · ✅ [Data seeding](LEARNING-GOALS.md#9--data-seeding) · ✅ [Transactions: commit and rollback](LEARNING-GOALS.md#7--transactions-commit-and-rollback) · ✅ [Complex querying: subqueries, grouping, filtered includes](LEARNING-GOALS.md#6--complex-querying-subqueries-grouping-filtered-includes) · ✅ [Duplicate entries](LEARNING-GOALS.md#14--duplicate-entries) · ✅ [Constraints and referential integrity](LEARNING-GOALS.md#2--constraints-and-referential-integrity)

**Show it.** Super admin → *Administration → Demo Data*.

## Platform

### 28. Sign-in sessions

**Topic.** Keeping people signed in safely: short-lived credentials that can be revoked.

**In Seat Planner.** A short-lived JWT access token plus a refresh token that is rotated on every use and stored only as a hash. The browser refreshes automatically, sharing one refresh between simultaneous requests. A password reset signs out every session.

**Code.** [tokenService.issueRefreshToken](../backend/src/services/tokenService.js#L46) · [tokenService.rotateRefreshToken](../backend/src/services/tokenService.js#L74) · [auth middleware](../backend/src/middleware/auth.js) · [api.js (refresh)](../frontend/src/lib/api.js#L103)

**Goal topics covered.** ✅ [Authentication and authorization](LEARNING-GOALS.md#35--authentication-and-authorization)

### 29. Email

**Topic.** Getting codes and tickets to people reliably, even where the host blocks ordinary mail ports.

**In Seat Planner.** Mail goes through the Gmail API or Brevo over HTTPS in production, SMTP locally, or the console when nothing is configured. Every send has a time limit, a failure asks the person to try again, and reserved test domains are never actually mailed.

**Code.** [emailService.sendMail](../backend/src/services/emailService.js#L193) · [sendWithGmail](../backend/src/services/emailService.js#L154) · [isUnroutable](../backend/src/services/emailService.js#L191) · [email tests](../backend/tests/emailGmail.test.js)

**Goal topics covered.** ✅ [Testing asynchronous code](LEARNING-GOALS.md#25--testing-asynchronous-code) · ✅ [Security in deployment](LEARNING-GOALS.md#30--security-in-deployment) · ✅ [Caching](LEARNING-GOALS.md#15--caching) · 🟡 [Basic logging and log levels](LEARNING-GOALS.md#21--basic-logging-and-log-levels)

### 30. API documentation

**Topic.** A machine-readable description of every endpoint, its permissions and its responses.

**In Seat Planner.** An OpenAPI 3 spec of 113 paths, served at `/api/v1/openapi.json`.

**Code.** [openapi.js](../backend/src/docs/openapi.js) · [served here](../backend/src/routes/index.js#L34)

**Goal topics covered.** none of the listed topics — this one is about the product rather than a learning goal

### 31. Deployment

**Topic.** Running the system somewhere other people can use it.

**In Seat Planner.** Docker images for both halves; Docker Compose for self-hosting, with Caddy in front (it serves HTTPS automatically when given a domain); live on Vercel (web), Render (API), Aiven (MySQL) and MongoDB Atlas. Database migrations run on every start.

**Code.** [backend/Dockerfile](../backend/Dockerfile) · [frontend/Dockerfile](../frontend/Dockerfile) · [docker-compose.yml](../docker-compose.yml) · [Caddyfile](../Caddyfile) · [next.config.mjs (API proxy)](../frontend/next.config.mjs#L18)

**Goal topics covered.** ✅ [Dockerfile basics and dockerizing Node.js](LEARNING-GOALS.md#27--dockerfile-basics-and-dockerizing-nodejs) · ✅ [Docker Compose, environment, volumes and networking](LEARNING-GOALS.md#28--docker-compose-environment-volumes-and-networking) · ✅ [Cloud deployment](LEARNING-GOALS.md#29--cloud-deployment) · ✅ [Security in deployment](LEARNING-GOALS.md#30--security-in-deployment) · ✅ [Schema deployment strategy](LEARNING-GOALS.md#17--schema-deployment-strategy) · 🟡 [CI/CD](LEARNING-GOALS.md#31--cicd) · 🟡 [Rollback and disaster recovery](LEARNING-GOALS.md#32--rollback-and-disaster-recovery)

### 32. Responsive design system

**Topic.** One interface that works as well on a checker's phone as on an operator's laptop.

**In Seat Planner.** Design tokens and component styling in one theme; tables turn into cards on phones; every icon-only button has hover text; checked at laptop and phone width on every page.

**Code.** [theme.css](../frontend/src/app/theme.css) · [mobile.css](../frontend/src/app/mobile.css) · [DataTable.js](../frontend/src/components/ui/DataTable.js) · [tip.js](../frontend/src/components/ui/tip.js) · [DashboardShell.js](../frontend/src/components/layout/DashboardShell.js)

**Goal topics covered.** none of the listed topics — this one is about the product rather than a learning goal
