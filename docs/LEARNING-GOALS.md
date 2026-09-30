# Seat Planner — learning goals

The learning-goal topics this project exercises, topic by topic. For each: what the topic is
(**Topic**), where and how Seat Planner uses it (**In Seat Planner**), and where the code is (**Code**).

Code links open the file at the line where the feature lives — on GitHub, or in VS Code's Markdown preview.

**Status:** ✅ demonstrated in the code · 🟡 partly · ⏳ planned for Phase 9 (hardening)

| Area | ✅ | 🟡 | ⏳ |
|---|---|---|---|
| Database — SQL | 4 | 0 | 1 |
| ORM — Sequelize | 11 | 1 | 0 |
| NoSQL — MongoDB | 1 | 0 | 0 |
| Logging | 2 | 2 | 1 |
| Unit testing | 2 | 0 | 1 |
| Application deployment — Docker | 2 | 0 | 0 |
| Application deployment — cloud | 2 | 2 | 1 |
| Also exercised | 2 | 0 | 0 |
| **Total** | **26** | **5** | **4** |

Not covered by this codebase: *Debugging Techniques (Advanced)* and *Operating System (Advanced)* —
skills practised while building it, but with no code of their own to point to; and *Jenkins*, as CI
here is planned on GitHub Actions.

## Database — SQL

### 1. ✅ Transactions and row locking

**Topic.** A transaction makes several statements succeed or fail together; a row lock stops another transaction changing a row until this one finishes.

**In Seat Planner.** A purchase writes the booking, tickets, seat segments, wallet debit and payment in one transaction, re-reading the hold with `SELECT … FOR UPDATE` in case it expired meanwhile. Wallet rows are locked the same way, so five simultaneous purchases on one wallet cannot overspend it.

**Code.** [booking transaction](../backend/src/services/bookingService.js#L213) · [hold locked FOR UPDATE](../backend/src/services/bookingService.js#L216) · [wallet row lock](../backend/src/services/walletService.js#L57)

### 2. ✅ Constraints and referential integrity

**Topic.** Foreign keys with the right delete rule (restrict, cascade, set null) and unique keys keep the data consistent whatever the code does.

**In Seat Planner.** A booking can never lose its departure (RESTRICT); a departure's coaches and seats go with it (CASCADE); a train cannot run twice on one date, nor have two coaches in one position (UNIQUE). Above all, a seat can be sold only once per leg: the unique key on (seat, segment) is the last guard against double-selling, even when two purchases race.

**Code.** [foreign-key helper](../backend/migrations/20260104000000-composition-and-trips.js#L21) · [one departure per train per date](../backend/migrations/20260104000000-composition-and-trips.js#L80) · [one coach per position](../backend/migrations/20260104000000-composition-and-trips.js#L39) · [one sale per seat per leg](../backend/migrations/20260105000000-segment-inventory.js#L51) · [booking tables](../backend/migrations/20260106000000-booking-and-payment.js)

### 3. ✅ Indexing

**Topic.** Indexes shaped like the queries that use them.

**In Seat Planner.** The job worker asks "what is due?" every few seconds, so the jobs table is indexed on exactly (status, run_after) and (status, lease_expires_at).

**Code.** [jobs indexes](../backend/migrations/20260117000000-jobs.js#L71)

### 4. ✅ Concurrency without holding locks

**Topic.** Optimistic claiming: several workers race for the same row, and a conditional UPDATE decides the winner without anyone waiting on a lock.

**In Seat Planner.** Workers read due jobs without locks, then claim one with `UPDATE … WHERE status = 'queued'`; whoever's update matches first owns it. A lease that is not renewed lets another worker take over a job whose worker died.

**Code.** [jobService.claimNext](../backend/src/services/jobService.js#L152) · [lease heartbeat](../backend/src/services/jobService.js#L191)

### 5. ⏳ Partitioning

**Topic.** Splitting a large table into parts by range (e.g. by date), so queries and clean-up touch only the parts they need.

**In Seat Planner.** Planned for Phase 9. One design constraint shapes it: MySQL cannot partition a table that has foreign keys, so the likely candidate is an FK-free archive of past departures' seat rows, partitioned by departure date.

**Code.** [build plan, Phase 9](../REQUIREMENTS.md)

## ORM — Sequelize

### 6. ✅ Complex querying: subqueries, grouping, filtered includes

**Topic.** Expressing subqueries, GROUP BY and conditional joins through the ORM rather than raw SQL.

**In Seat Planner.** Demo-data status counts rows through an `IN (subquery)`; what a run created is counted with `GROUP BY model`; valid tickets are found through a filtered include of their booking and its owner; availability aggregates over every station pair.

**Code.** [subquery](../backend/src/services/demoService.js#L133) · [GROUP BY](../backend/src/services/demoService.js#L799) · [filtered include](../backend/src/services/demoService.js#L167) · [availabilityService.matrix](../backend/src/services/availabilityService.js#L210)

### 7. ✅ Transactions: commit and rollback

**Topic.** Managed transactions commit when the callback finishes and roll back when it throws; hooks can run after a commit.

**In Seat Planner.** Deleting demo data is one managed transaction — any refusal rolls every delete back. A job queued inside a transaction is only started after that transaction commits (`afterCommit`), so a job never runs for a change that was rolled back.

**Code.** [afterCommit](../backend/src/services/jobService.js#L127) · [all-or-nothing delete](../backend/src/services/demoService.js#L889) · [tripService.cancel](../backend/src/services/tripService.js#L481)

### 8. ✅ Understanding the generated SQL

**Topic.** Seeing the SQL the ORM actually sends, to catch inefficient or surprising queries.

**In Seat Planner.** In development every statement Sequelize runs is printed to the console; production turns it off.

**Code.** [logging option](../backend/src/config/database.js#L17)

### 9. ✅ Data seeding

**Topic.** Loading reference and sample data repeatably.

**In Seat Planner.** Command-line seeders build users, seat plans, the network and departures, idempotently. The in-app Demo Data button builds the same data through the normal services.

**Code.** [importSeatPlans.js](../backend/src/seeders/importSeatPlans.js) · [seedNetwork.js](../backend/src/seeders/seedNetwork.js) · [seedDepartures.js](../backend/src/seeders/seedDepartures.js) · [demoService.populate](../backend/src/services/demoService.js#L814)

### 10. ✅ Migrations, and debugging a migration

**Topic.** Versioned schema changes, and getting a risky one right against real data.

**In Seat Planner.** 19 migrations run on every deploy. One converted the first release's single `users.role` column into roles-as-data on the live database; it was rehearsed against a copy of the old schema before it ran.

**Code.** [role-column migration](../backend/migrations/20260101000001-rbac-from-role-column.js) · [migration folder](../backend/migrations)

### 11. ✅ Complex mappings and constraints

**Topic.** Associations beyond one-to-many: many-to-many through a join table, several foreign keys to the same table, aliases.

**In Seat Planner.** Roles and permissions are many-to-many through `role_permissions`; a booking has two station associations (`fromStation`, `toStation`) on one table.

**Code.** [Booking associations](../backend/src/models/Booking.js#L121) · [Role belongsToMany](../backend/src/models/Role.js#L55)

### 12. ✅ Lazy and eager loading

**Topic.** Loading related rows in the same query (eager) or when first touched (lazy) — and the bugs a missing include causes.

**In Seat Planner.** Departure generation eager-loads each train's coaches, their plans and schedules in one query. A missing include once made station names read "undefined" in the standing dialog; the fix was to eager-load `Station` in the route index.

**Code.** [inventoryService.routeIndex](../backend/src/services/inventoryService.js#L26) · [tripService.generateHorizon](../backend/src/services/tripService.js#L140)

### 13. ✅ Object tracking and hooks

**Topic.** Reacting to the ORM's lifecycle — every instance created, updated or destroyed.

**In Seat Planner.** Global `afterCreate` / `afterBulkCreate` hooks note every row created while demo data is being built, in the same transaction as the row, so the demo can later be removed exactly.

**Code.** [demoCapture.install](../backend/src/utils/demoCapture.js#L50) · [registered here](../backend/src/models/index.js#L93)

### 14. ✅ Duplicate entries

**Topic.** Avoiding, and reporting well, rows that already exist.

**In Seat Planner.** Seeding uses `findOrCreate` so it can run twice; a unique-constraint violation anywhere is answered with a clear 409 instead of a crash.

**Code.** [findOrCreate](../backend/src/services/demoService.js#L420) · [unique violation → 409](../backend/src/middleware/errorHandler.js#L13)

### 15. ✅ Caching

**Topic.** Keeping frequently read, rarely changed data in memory — and knowing when to throw it away.

**In Seat Planner.** Settings are loaded into memory at start and read synchronously. Each user's permissions are cached for 60 seconds and dropped the moment their roles change. The Gmail access token is reused until shortly before it expires. (Caching hot availability reads is Phase 9.)

**Code.** [settingService.get](../backend/src/services/settingService.js#L43) · [permissionService.getAccess](../backend/src/services/permissionService.js#L95) · [invalidateUser](../backend/src/services/permissionService.js#L105) · [gmailAccessToken](../backend/src/services/emailService.js#L111)

### 16. 🟡 Repository pattern

**Topic.** Hiding data access behind repository objects so business code does not depend on the ORM.

**In Seat Planner.** Partly: a service layer owns all data access and controllers never touch models, but the services use Sequelize models directly rather than through repository interfaces.

**Code.** [services/](../backend/src/services) · [a thin controller](../backend/src/controllers/jobController.js)

### 17. ✅ Schema deployment strategy

**Topic.** Getting schema changes onto a running system safely.

**In Seat Planner.** The API's container runs pending migrations before it starts, so code and schema always arrive together.

**Code.** [Dockerfile CMD](../backend/Dockerfile#L39)

## NoSQL — MongoDB

### 18. ✅ A document store beside the relational database

**Topic.** Using a document database where records vary in shape and are written far more than they are changed.

**In Seat Planner.** The audit log lives in MongoDB: each event stores different before/after snapshots, and the screen queries it by action, actor and entity.

**Code.** [AuditEvent model](../backend/src/models/mongo/AuditEvent.js) · [auditService.query](../backend/src/services/auditService.js#L59) · [connection](../backend/src/config/mongo.js)

## Logging

### 19. ✅ Logging objects and structured records

**Topic.** Writing log entries as structured data rather than sentences, so they can be searched and filtered.

**In Seat Planner.** Audit events are structured documents: action, outcome, actor, entity, before, after, and the request's context.

**Code.** [auditService.record](../backend/src/services/auditService.js#L18)

### 20. ✅ Correlating entries to one request

**Topic.** Tying every entry from one request together with an ID.

**In Seat Planner.** Each request gets a request ID and the caller's identity in AsyncLocalStorage; every audit entry written during that request carries them, without passing them through every function.

**Code.** [runWithContext](../backend/src/utils/requestContext.js#L16) · [request context middleware](../backend/src/middleware/requestContext.js)

### 21. 🟡 Basic logging and log levels

**Topic.** Info, warning and error levels, used consistently.

**In Seat Planner.** Partly: the server uses `console.info` / `warn` / `error` with a prefix per area (`[email]`, `[jobs]`). A real logger with levels and JSON output is Phase 9.

**Code.** [email route logged at start](../backend/src/services/emailService.js#L33) · [job worker errors](../backend/src/services/jobService.js#L312)

### 22. 🟡 Retention

**Topic.** Keeping records only as long as they are useful.

**In Seat Planner.** Partly: finished job records are pruned after a configurable number of days. Log rotation is Phase 9.

**Code.** [jobService.prune](../backend/src/services/jobService.js#L501)

### 23. ⏳ Asynchronous logging, frameworks, rotation, distributed logging

**Topic.** A logging library writing JSON asynchronously, rotated, and gathered from several processes.

**In Seat Planner.** Phase 9, step 2: structured JSON logs (levels, request ID on every line, secrets redacted), searchable in Render.

**Code.** [build plan, Phase 9](../REQUIREMENTS.md)

## Unit testing

### 24. ✅ Test-driven style on pure logic

**Topic.** Writing tests for business rules as small pure functions, independent of the database.

**In Seat Planner.** 205 unit tests cover money arithmetic, refund percentages, segment overlap, seat auto-selection, standing capacity, ticket signing and job retry timing.

**Code.** [refundPolicy tests](../backend/tests/refundPolicy.test.js) · [autoSelect tests](../backend/tests/autoSelect.test.js) · [money tests](../backend/tests/money.test.js) · [availability tests](../backend/tests/availability.test.js)

### 25. ✅ Testing asynchronous code

**Topic.** Testing code that waits on the network: timeouts, retries, failures.

**In Seat Planner.** Email delivery is tested against local HTTP servers standing in for Google and Brevo — including a server that never answers (the send gives up in time) and a rejected token (refreshed and retried once).

**Code.** [Gmail tests](../backend/tests/emailGmail.test.js) · [Brevo tests](../backend/tests/emailBrevo.test.js)

### 26. ⏳ Code coverage and CI

**Topic.** Measuring how much code the tests exercise, and running them automatically on every change.

**In Seat Planner.** Phase 9, step 1: move the 39 integration suites into the repository, measure coverage, and run everything on GitHub Actions against a MySQL service on every push.

**Code.** [build plan, Phase 9](../REQUIREMENTS.md)

## Application deployment — Docker

### 27. ✅ Dockerfile basics and dockerizing Node.js

**Topic.** Building small, safe images for Node applications.

**In Seat Planner.** The API image installs production dependencies only and runs as a non-root user; the web image is a two-stage build (build, then a slim runtime).

**Code.** [backend/Dockerfile](../backend/Dockerfile) · [frontend/Dockerfile](../frontend/Dockerfile#L6)

### 28. ✅ Docker Compose, environment, volumes and networking

**Topic.** Running several containers together, configured from the environment, with data that outlives them.

**In Seat Planner.** Compose runs MySQL, MongoDB, the API, the web app and Caddy. The API waits for the database's health check; data lives in named volumes; containers reach each other by service name; Caddy routes `/api` to the API and everything else to the web app, serving HTTPS when given a domain.

**Code.** [docker-compose.yml](../docker-compose.yml) · [health check](../docker-compose.yml#L18) · [Caddyfile](../Caddyfile) · [.env.example](../backend/.env.example) · [config/env.js](../backend/src/config/env.js)

## Application deployment — cloud

### 29. ✅ Cloud deployment

**Topic.** Running across managed services.

**In Seat Planner.** Web on Vercel, API on Render (Docker), MySQL on Aiven, audit log on MongoDB Atlas. The web app proxies `/api` to the API, so the browser only ever talks to one origin.

**Code.** [API proxy](../frontend/next.config.mjs#L18) · [README: Deployment](../README.md)

### 30. ✅ Security in deployment

**Topic.** Keeping secrets and traffic safe once the system is public.

**In Seat Planner.** TLS to the database; a CORS allow-list; secrets only in environment variables; mail sent over HTTPS because the host blocks SMTP.

**Code.** [database TLS](../backend/src/config/database.js#L9) · [CORS allow-list](../backend/src/app.js#L47) · [email over HTTPS](../backend/src/services/emailService.js#L154)

### 31. 🟡 CI/CD

**Topic.** Building, testing and deploying automatically from the repository.

**In Seat Planner.** Partly: Vercel deploys the web app on every push; the API deploy is started by hand. An automated test gate is Phase 9.

**Code.** [README: Deployment](../README.md)

### 32. 🟡 Rollback and disaster recovery

**Topic.** Undoing a bad release, and recovering lost data.

**In Seat Planner.** Partly: every migration has a `down` step. Scheduled database backups are still to do.

**Code.** [a down() step](../backend/migrations/20260117000000-jobs.js#L78)

### 33. ⏳ Monitoring

**Topic.** Knowing the system is healthy before users say otherwise.

**In Seat Planner.** Phase 9, step 5: a metrics endpoint, uptime checks, and alerts when background jobs fail.

**Code.** [build plan, Phase 9](../REQUIREMENTS.md)

## Also exercised

### 34. ✅ Concurrency and isolation

**Topic.** Many people acting on the same seats and money at the same moment.

**In Seat Planner.** Seat holds claim segments atomically — the unique key on (seat, segment) makes the loser of a race fail cleanly — wallet rows are locked, background jobs use leases with heartbeats, and de-duplication keys stop two clicks queueing two mass refunds.

**Code.** [holdService.create](../backend/src/services/holdService.js#L60) · [seat-segment unique key](../backend/migrations/20260105000000-segment-inventory.js#L51) · [job de-duplication](../backend/src/services/jobService.js#L102) · [lease heartbeat](../backend/src/services/jobService.js#L191)

### 35. ✅ Authentication and authorization

**Topic.** Proving who someone is, and deciding what they may do.

**In Seat Planner.** Hashed passwords, short-lived JWTs with rotating refresh tokens, and permissions as data with an escalation guard.

**Code.** [tokenService.rotateRefreshToken](../backend/src/services/tokenService.js#L74) · [escalation guard](../backend/src/services/roleService.js#L24)
