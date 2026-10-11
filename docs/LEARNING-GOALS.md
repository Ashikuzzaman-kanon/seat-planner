# Seat Planner — learning goals

The learning-goal topics this project covers, topic by topic. Topics 1 to 35 came first and keep their
numbers; 36 to 64 were added so that every sub-goal on the goal sheet has a topic.
[The goal sheet, sub-goal by sub-goal](#the-goal-sheet-sub-goal-by-sub-goal) maps each line of the sheet to its topic.

For each topic: what it is (**Topic**), where and how Seat Planner uses it (**In Seat Planner**), and
where the code is (**Code**). Where a topic is shown by doing rather than by code there are steps
(**Do**), and where part or all of it has to be explained there are the points to make (**Explain**)
and the nearest thing in the project to point at (**Nearest thing here**).

Code links open the file at the line where the feature lives — on GitHub, or in VS Code's Markdown preview.

**How each topic is covered**

- ✅ **In the code** — the project demonstrates it. Open the linked code.
- 🟡 **Partly in the code** — show what is there; the rest is explained.
- 🎬 **Live demo** — a technique rather than code: done in front of people, on this project.
- 💬 **Explain** — not in this project. A short talk, with the nearest thing here to point at.
- ⏳ **Planned** — Phase 9 (hardening); not built.

## The goal sheet, sub-goal by sub-goal

Every sub-goal on the sheet, in the sheet's own order and wording, with the topic that covers it.
Where two topics are named, the first is the one to present from.

| Goal | Sub-goals | ✅ | 🟡 | 🎬 | 💬 |
|---|---|---|---|---|---|
| [1. Application Deployment (Intermediate)](#goal-1--application-deployment-intermediate) | 18 | 7 | 5 | 0 | 6 |
| [2. Debugging Techniques (Advanced)](#goal-2--debugging-techniques-advanced) | 7 | 1 | 0 | 4 | 2 |
| [3. Logging](#goal-3--logging) | 10 | 4 | 5 | 0 | 1 |
| [4. ORM (Intermediate)](#goal-4--orm-intermediate) | 12 | 11 | 1 | 0 | 0 |
| [5. Operating System (Advanced)](#goal-5--operating-system-advanced) | 3 | 0 | 3 | 0 | 0 |
| [6. Unit Testing (Advanced)](#goal-6--unit-testing-advanced) | 4 | 3 | 1 | 0 | 0 |
| **Total** | **54** | **26** | **15** | **4** | **9** |

### Goal 1 — Application Deployment (Intermediate)

| Sub-goal on the sheet | | Topic | In one line |
|---|---|---|---|
| Deployment Strategies | 🟡 | [36](#36--deployment-strategies) | Immutable deploys switched over when ready, with previews first; rolling and canary are explained. |
| Deployment Tools and Technologies | ✅ | [37](#37--deployment-tools-and-technologies) | Docker, Compose, Caddy, Vercel, Render, Aiven, GitHub Actions and Gradle — each with its file. |
| Cloud Deployment | ✅ | [29](#29--cloud-deployment) | Live on Vercel, Render and Aiven, behind one origin. |
| On-Premises Deployment | ✅ | [38](#38--on-premises-deployment), [28](#28--docker-compose-environment-volumes-and-networking) | The whole stack on one machine of your own, with Docker Compose and Caddy. |
| Continuous Integration and Continuous Deployment (CI/CD) | 🟡 | [31](#31--cicd) | CI on every pull request and an automated Android release; deploys are not gated on it. |
| Containerization and Orchestration | 🟡 | [39](#39--containerization-and-orchestration), [27](#27--dockerfile-basics-and-dockerizing-nodejs), [28](#28--docker-compose-environment-volumes-and-networking) | Two images and five containers under Compose; Kubernetes is explained. |
| Monitoring and Logging | 🟡 | [33](#33--monitoring) | A health endpoint and failed-job notices; no metrics or outside alerts. |
| Security in Application Deployment | ✅ | [30](#30--security-in-deployment) | TLS to the database, a CORS allow-list, secrets in the environment. |
| Rollback and Disaster Recovery | 🟡 | [32](#32--rollback-and-disaster-recovery) | Every migration can be undone; there are no backups yet. |
| Best Practices for Application Deployment | ✅ | [40](#40--best-practices-for-application-deployment) | Configuration from the environment, one image for any domain, migrations before start. |
| Jenkins - Basics | 💬 | [41](#41--jenkins---basics) | Not used — CI here is GitHub Actions. Explained against `ci.yml`. |
| Jenkins - Freestyle Project | 💬 | [42](#42--jenkins---freestyle-project) | Explained; the frontend build job is the nearest thing. |
| Jenkins - Pipeline Project | 💬 | [43](#43--jenkins---pipeline-project) | Explained; `ci.yml` translates into a Jenkinsfile stage by stage. |
| Jenkins - Configuration | 💬 | [44](#44--jenkins---configuration) | Explained; the release workflow's secrets and pinned tools are the nearest thing. |
| Docker - Optimizing Images | ✅ | [27](#27--dockerfile-basics-and-dockerizing-nodejs) | Production-only install and a two-stage build. |
| Docker - Security | ✅ | [45](#45--docker---security) | Not root, no secrets in images, only the proxy published. |
| Docker - Resource Management | 💬 | [46](#46--docker---resource-management) | No limits are set. Explained; the connection-pool cap is the nearest thing. |
| Docker - Custom Registries | 💬 | [47](#47--docker---custom-registries) | Nothing is pushed to a registry. Explained. |

### Goal 2 — Debugging Techniques (Advanced)

| Sub-goal on the sheet | | Topic | In one line |
|---|---|---|---|
| Conditional Breakpoints and Actions | 🎬 | [48](#48--conditional-breakpoints-and-actions) | A breakpoint that stops only for a hold of three seats or more, and a logpoint that never stops. |
| Attach to Process | 🎬 | [49](#49--attach-to-process) | VS Code attached to the API while it runs; Chrome attached to the page inside the Android app. |
| Debugging Child Processes | 🎬 | [50](#50--debugging-child-processes) | The test runner and the suites it starts, both under one debugger. |
| Debugging Mixed Code Bases | 🎬 | [51](#51--debugging-mixed-code-bases) | Kotlin and the JavaScript page it hosts, followed across the boundary. |
| Debugging in Multi-threaded Applications | 💬 | [52](#52--debugging-in-multi-threaded-applications) | Explained; the Android app's background thread and the race tests are the nearest things. |
| Core dump analysis | 💬 | [53](#53--core-dump-analysis) | Explained; a Node diagnostic report can be shown in its place. |
| Different env issue reproduce | ✅ | [54](#54--different-env-issue-reproduce) | Four real cases: a timezone, a blocked mail port, a sleeping server, a phone's camera. |

### Goal 3 — Logging

| Sub-goal on the sheet | | Topic | In one line |
|---|---|---|---|
| Introduction to logging | ✅ | [55](#55--introduction-to-logging) | Three records for three readers: the console, the audit log, job history. |
| Basic logging concepts | 🟡 | [21](#21--basic-logging-and-log-levels) | Console lines with a prefix per area; a real logger is planned. |
| Different log types | ✅ | [56](#56--different-log-types) | Application, access, audit and security, query, and job history. |
| Log levels | 🟡 | [21](#21--basic-logging-and-log-levels) | Severity by console method; no threshold that can be raised or lowered. |
| Logging objects | ✅ | [19](#19--logging-objects-and-structured-records) | Audit entries are documents, not sentences. |
| Log rotation and retention | 🟡 | [22](#22--retention) | Retention is shown; rotation is explained — the app writes no log files. |
| Structured logging | ✅ | [19](#19--logging-objects-and-structured-records) | The audit log is structured end to end. |
| Logging frameworks/libraries | 🟡 | [57](#57--logging-frameworkslibraries), [23](#23--asynchronous-logging-frameworks-rotation-distributed-logging) | morgan writes request lines in development; a framework proper is planned and explained. |
| Asynchronous logging | 💬 | [58](#58--asynchronous-logging), [23](#23--asynchronous-logging-frameworks-rotation-distributed-logging) | Not used. Explained; audit entries are deliberately awaited. |
| Distributed logging | 🟡 | [59](#59--distributed-logging), [20](#20--correlating-entries-to-one-request) | A request ID on every audit entry and in a response header; no central collection. |

### Goal 4 — ORM (Intermediate)

| Sub-goal on the sheet | | Topic | In one line |
|---|---|---|---|
| Complex querying capabilities in ORM (e.g., subqueries, grouping) | ✅ | [6](#6--complex-querying-subqueries-grouping-filtered-includes) | Subqueries, GROUP BY and filtered includes, through the ORM. |
| Transactions, including commit and rollback operations | ✅ | [7](#7--transactions-commit-and-rollback), [1](#1--transactions-and-row-locking) | Managed transactions; work is queued only after the commit. |
| Understand generated Query | ✅ | [8](#8--understanding-the-generated-sql) | Every statement the ORM sends is printed in development. |
| Understand object tracking | ✅ | [13](#13--object-tracking-and-hooks) | Hooks record every row created while demo data is built. |
| Lazy Loading & Eager Loading | ✅ | [12](#12--lazy-and-eager-loading) | Eager loading, in a place where a missing include once caused a bug. |
| Data Seeding | ✅ | [9](#9--data-seeding) | Seeders, the demo-data button and the railway loader — all safe to run twice. |
| Debug Migration | ✅ | [10](#10--migrations-and-debugging-a-migration) | A migration over live data, rehearsed against a copy of the old schema. |
| Repository Pattern | 🟡 | [16](#16--repository-pattern) | A service layer owns all data access, without repository interfaces. |
| Handle Complex Mapping/Constraints | ✅ | [11](#11--complex-mappings-and-constraints), [2](#2--constraints-and-referential-integrity) | Many-to-many, two links to one table, and constraints that carry business rules. |
| Caching | ✅ | [15](#15--caching) | Settings, permissions and a mail token, each cached in a different way. |
| Unit Test | ✅ | [60](#60--unit-test--testing-code-that-uses-the-orm) | Database code is tested against a real test database, snapshotted and restored. |
| Deployment strategies | ✅ | [17](#17--schema-deployment-strategy) | Migrations run before the API starts, so code and schema arrive together. |

### Goal 5 — Operating System (Advanced)

| Sub-goal on the sheet | | Topic | In one line |
|---|---|---|---|
| Advanced Shell Scripting | 🟡 | [61](#61--advanced-shell-scripting) | The shell that drives the Android release; longer scripts are explained. |
| Service and System Management | 🟡 | [62](#62--service-and-system-management) | Containers kept running by Compose and timers inside the API; systemd is explained. |
| Security and Troubleshooting | 🟡 | [63](#63--security-and-troubleshooting) | Least privilege in the containers; a connection test that says what failed. |

### Goal 6 — Unit Testing (Advanced)

| Sub-goal on the sheet | | Topic | In one line |
|---|---|---|---|
| Test-Driven Development (TDD) | ✅ | [24](#24--test-driven-style-on-pure-logic) | Rules written as small pure functions, with their tests. |
| Code Coverage and Metrics | ✅ | [26](#26--code-coverage-and-ci) | Measured across both test runs, with floors the build enforces. |
| Testing Asynchronous and Multi-Threaded Code | 🟡 | [25](#25--testing-asynchronous-code), [64](#64--testing-multi-threaded-code) | Timeouts and retries, and races fired together; threads themselves are explained. |
| Continuous Integration and Test Automation | ✅ | [26](#26--code-coverage-and-ci), [31](#31--cicd) | Every test runs on every pull request, without anyone starting it. |

**For the theory session** — the 9 sub-goals that are explained and nothing else: Jenkins - Basics ([41](#41--jenkins---basics)), Jenkins - Freestyle Project ([42](#42--jenkins---freestyle-project)), Jenkins - Pipeline Project ([43](#43--jenkins---pipeline-project)), Jenkins - Configuration ([44](#44--jenkins---configuration)), Docker - Resource Management ([46](#46--docker---resource-management)), Docker - Custom Registries ([47](#47--docker---custom-registries)); Debugging in Multi-threaded Applications ([52](#52--debugging-in-multi-threaded-applications)), Core dump analysis ([53](#53--core-dump-analysis)); Asynchronous logging ([58](#58--asynchronous-logging)).

**To do live** — the 4 that are shown by doing them: Conditional Breakpoints and Actions ([48](#48--conditional-breakpoints-and-actions)), Attach to Process ([49](#49--attach-to-process)), Debugging Child Processes ([50](#50--debugging-child-processes)), Debugging Mixed Code Bases ([51](#51--debugging-mixed-code-bases)).

**Shown in part, the rest explained** — 15: Deployment Strategies ([36](#36--deployment-strategies)), Continuous Integration and Continuous Deployment (CI/CD) ([31](#31--cicd)), Containerization and Orchestration ([39](#39--containerization-and-orchestration)), Monitoring and Logging ([33](#33--monitoring)), Rollback and Disaster Recovery ([32](#32--rollback-and-disaster-recovery)); Basic logging concepts ([21](#21--basic-logging-and-log-levels)), Log levels ([21](#21--basic-logging-and-log-levels)), Log rotation and retention ([22](#22--retention)), Logging frameworks/libraries ([57](#57--logging-frameworkslibraries)), Distributed logging ([59](#59--distributed-logging)); Repository Pattern ([16](#16--repository-pattern)); Advanced Shell Scripting ([61](#61--advanced-shell-scripting)), Service and System Management ([62](#62--service-and-system-management)), Security and Troubleshooting ([63](#63--security-and-troubleshooting)); Testing Asynchronous and Multi-Threaded Code ([25](#25--testing-asynchronous-code)).

*Understand object tracking* is on the sheet twice under ORM; it is one line here.

In this guide but not on the sheet: Indexing ([3](#3--indexing)), Concurrency without holding locks ([4](#4--concurrency-without-holding-locks)), Partitioning ([5](#5--partitioning)), Duplicate entries ([14](#14--duplicate-entries)), A document store beside the relational database ([18](#18--a-document-store-beside-the-relational-database)), Concurrency and isolation ([34](#34--concurrency-and-isolation)), Authentication and authorization ([35](#35--authentication-and-authorization)).

## Database — SQL

### 1. ✅ Transactions and row locking

**Topic.** A transaction makes several statements succeed or fail together; a row lock stops another transaction changing a row until this one finishes.

**In Seat Planner.** A purchase writes the booking, tickets, seat segments, wallet debit and payment in one transaction, re-reading the hold with `SELECT … FOR UPDATE` in case it expired meanwhile. Wallet rows are locked the same way, so five simultaneous purchases on one wallet cannot overspend it. Deciding a subscription request locks its row first too, so two reviewers cannot both act on it.

**Code.** [booking transaction](../backend/src/services/bookingService.js#L214) · [hold locked FOR UPDATE](../backend/src/services/bookingService.js#L217) · [wallet row lock](../backend/src/services/walletService.js#L57) · [subscription decision lock](../backend/src/services/subscriptionService.js#L393)

### 2. ✅ Constraints and referential integrity

**Topic.** Foreign keys with the right delete rule (restrict, cascade, set null) and unique keys keep the data consistent whatever the code does.

**In Seat Planner.** A booking can never lose its departure (RESTRICT); a departure's coaches and seats go with it (CASCADE); a train cannot run twice on one date, nor have two coaches in one position (UNIQUE). Above all, a seat can be sold only once per leg: the unique key on (seat, segment) is the last guard against double-selling, even when two purchases race. The same idea stops a person holding two live requests for one subscription: a key that is unique while the request is live and NULL once it has ended.

**Code.** [foreign-key helper](../backend/migrations/20260104000000-composition-and-trips.js#L21) · [one departure per train per date](../backend/migrations/20260104000000-composition-and-trips.js#L80) · [one coach per position](../backend/migrations/20260104000000-composition-and-trips.js#L39) · [one sale per seat per leg](../backend/migrations/20260105000000-segment-inventory.js#L51) · [booking tables](../backend/migrations/20260106000000-booking-and-payment.js) · [one live request each](../backend/migrations/20260122000000-subscriptions.js#L75)

### 3. ✅ Indexing

**Topic.** Indexes shaped like the queries that use them.

**In Seat Planner.** The job worker asks "what is due?" every few seconds, so the jobs table is indexed on exactly (status, run_after) and (status, lease_expires_at).

**Code.** [jobs indexes](../backend/migrations/20260117000000-jobs.js#L71)

### 4. ✅ Concurrency without holding locks

**Topic.** Optimistic claiming: several workers race for the same row, and a conditional UPDATE decides the winner without anyone waiting on a lock.

**In Seat Planner.** Workers read due jobs without locks, then claim one with `UPDATE … WHERE status = 'queued'`; whoever's update matches first owns it. A lease that is not renewed lets another worker take over a job whose worker died.

**Code.** [jobService.claimNext](../backend/src/services/jobService.js#L206) · [lease heartbeat](../backend/src/services/jobService.js#L245)

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

**Code.** [afterCommit](../backend/src/services/jobService.js#L181) · [all-or-nothing delete](../backend/src/services/demoService.js#L889) · [tripService.cancel](../backend/src/services/tripService.js#L486)

### 8. ✅ Understanding the generated SQL

**Topic.** Seeing the SQL the ORM actually sends, to catch inefficient or surprising queries.

**In Seat Planner.** In development every statement Sequelize runs is printed to the console; production and the test run turn it off.

**Code.** [logging option](../backend/src/config/database.js#L17)

### 9. ✅ Data seeding

**Topic.** Loading reference and sample data repeatably.

**In Seat Planner.** Command-line seeders build users, seat plans, the network and departures, idempotently. The in-app Demo Data button builds the same data through the normal services, and *Railway Data* loads the real railway's published timetable from a snapshot in the repository — adding what is missing, never changing what is there, so it too can run twice.

**Code.** [importSeatPlans.js](../backend/src/seeders/importSeatPlans.js) · [seedNetwork.js](../backend/src/seeders/seedNetwork.js) · [seedDepartures.js](../backend/src/seeders/seedDepartures.js) · [demoService.populate](../backend/src/services/demoService.js#L814) · [railwayService.load](../backend/src/services/railwayService.js#L380) · [the timetable snapshot](../backend/src/data/railway/timetable.json)

### 10. ✅ Migrations, and debugging a migration

**Topic.** Versioned schema changes, and getting a risky one right against real data.

**In Seat Planner.** 25 migrations run on every deploy. One converted the first release's single `users.role` column into roles-as-data on the live database; it was rehearsed against a copy of the old schema before it ran.

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

**Code.** [demoCapture.install](../backend/src/utils/demoCapture.js#L50) · [registered here](../backend/src/models/index.js#L105)

### 14. ✅ Duplicate entries

**Topic.** Avoiding, and reporting well, rows that already exist.

**In Seat Planner.** Seeding uses `findOrCreate` so it can run twice; a unique-constraint violation anywhere is answered with a clear 409 instead of a crash. A notification carries a key per event under a unique index, so a job that is retried cannot tell someone twice; a device turned away again and again is one row whose count goes up (`INSERT … ON DUPLICATE KEY UPDATE`), not a row per attempt.

**Code.** [findOrCreate](../backend/src/services/demoService.js#L420) · [unique violation → 409](../backend/src/middleware/errorHandler.js#L13) · [a notification told once](../backend/src/services/inboxService.js#L56) · [one row per refusal, counted](../backend/src/services/deviceService.js#L183)

### 15. ✅ Caching

**Topic.** Keeping frequently read, rarely changed data in memory — and knowing when to throw it away.

**In Seat Planner.** Settings are loaded into memory at start and read synchronously. Each user's permissions are cached for 60 seconds and dropped the moment their roles change. The Gmail access token is reused until shortly before it expires. (Caching hot availability reads is Phase 9.)

**Code.** [settingService.get](../backend/src/services/settingService.js#L43) · [permissionService.getAccess](../backend/src/services/permissionService.js#L95) · [invalidateUser](../backend/src/services/permissionService.js#L105) · [gmailAccessToken](../backend/src/services/emailService.js#L117)

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

**Code.** [email route logged at start](../backend/src/services/emailService.js#L38) · [job worker errors](../backend/src/services/jobService.js#L368)

### 22. 🟡 Retention

**Topic.** Keeping records only as long as they are useful.

**In Seat Planner.** Partly: finished job records and old notifications are pruned after a configurable number of days, the record of subscription checks that were turned away is capped per account and dropped after ninety, and the unsold seats of trains long gone are cleared daily while everything with money or a journey behind it is kept. Log rotation is Phase 9.

**Code.** [jobService.prune](../backend/src/services/jobService.js#L557) · [inboxService.prune](../backend/src/services/inboxService.js#L160) · [deviceService.pruneRefusals](../backend/src/services/deviceService.js#L400) · [seatRetentionService.clearDeparted](../backend/src/services/seatRetentionService.js#L68)

### 23. ⏳ Asynchronous logging, frameworks, rotation, distributed logging

**Topic.** A logging library writing JSON asynchronously, rotated, and gathered from several processes.

**In Seat Planner.** Phase 9, step 2: structured JSON logs (levels, request ID on every line, secrets redacted), searchable in Render.

**Code.** [build plan, Phase 9](../REQUIREMENTS.md)

## Unit testing

### 24. ✅ Test-driven style on pure logic

**Topic.** Writing tests for business rules as small pure functions, independent of the database.

**In Seat Planner.** 265 unit tests cover money arithmetic, refund percentages, segment overlap, seat auto-selection, standing capacity, ticket signing, job retry timing, timetable arithmetic, subscription periods and device limits.

**Code.** [refundPolicy tests](../backend/tests/unit/refundPolicy.test.js) · [autoSelect tests](../backend/tests/unit/autoSelect.test.js) · [money tests](../backend/tests/unit/money.test.js) · [availability tests](../backend/tests/unit/availability.test.js) · [timetable tests](../backend/tests/unit/timetable.test.js) · [device-limit tests](../backend/tests/unit/subscriptionDevices.test.js)

### 25. ✅ Testing asynchronous code

**Topic.** Testing code that waits on the network: timeouts, retries, failures.

**In Seat Planner.** Email delivery is tested against local HTTP servers standing in for Google and Brevo — including a server that never answers (the send gives up in time) and a rejected token (refreshed and retried once).

**Code.** [Gmail tests](../backend/tests/unit/emailGmail.test.js) · [Brevo tests](../backend/tests/unit/emailBrevo.test.js)

### 26. ✅ Code coverage and CI

**Topic.** Measuring how much code the tests exercise, and running them automatically on every change.

**In Seat Planner.** 44 integration suites live in the repository beside the unit tests. They build a database of their own, snapshot it and restore it before every suite, and talk to the API over HTTP. Coverage is measured across the unit and integration runs together, and the build fails below 90% of lines and functions or 70% of branches. GitHub Actions runs all of it on every pull request and every push to `master`, against MySQL and MongoDB services, with a production build of the web app.

**Code.** [ci.yml](../.github/workflows/ci.yml) · [integration runner](../backend/tests/integration/run.js) · [snapshot and restore](../backend/tests/integration/run.js#L138) · [coverage floors](../backend/package.json#L24) · [what is measured](../backend/.c8rc.json)

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

**Code.** [API proxy](../frontend/next.config.mjs#L29) · [README: Deployment](../README.md)

### 30. ✅ Security in deployment

**Topic.** Keeping secrets and traffic safe once the system is public.

**In Seat Planner.** TLS to the database; a CORS allow-list that admits the project's own preview deployments by pattern, with one endpoint deliberately open to any origin because nothing of the browser's own goes with a call to it; secrets only in environment variables, and the Android app's signing key only in repository secrets; mail sent over HTTPS because the host blocks SMTP.

**Code.** [database TLS](../backend/src/config/database.js#L9) · [CORS allow-list](../backend/src/utils/allowedOrigin.js#L66) · [the one open route](../backend/src/app.js#L34) · [email over HTTPS](../backend/src/services/emailService.js#L161)

### 31. 🟡 CI/CD

**Topic.** Building, testing and deploying automatically from the repository.

**In Seat Planner.** Partly: GitHub Actions runs the tests, the coverage floors and a production build of the web app on every pull request and every push to `master`, and a tag builds, tests, signs and publishes the Android app. Vercel deploys the web app on every push; the API deploy is started by hand. Nothing yet makes a deploy wait for the checks to pass.

**Code.** [ci.yml](../.github/workflows/ci.yml) · [android.yml](../.github/workflows/android.yml) · [README: Deployment](../README.md)

### 32. 🟡 Rollback and disaster recovery

**Topic.** Undoing a bad release, and recovering lost data.

**In Seat Planner.** Partly: every migration has a `down` step. Scheduled database backups are still to do.

**Code.** [a down() step](../backend/migrations/20260117000000-jobs.js#L78)

### 33. 🟡 Monitoring

**Topic.** Knowing the system is healthy before users say otherwise.

**In Seat Planner.** Partly: a health endpoint answers whether the API is up, and the web app calls it to wake a sleeping server and to know when it is back. Background work is watched from inside the app — a screen lists what is running and what failed, and a job that gives up notifies the staff who can send it round again. A script signs in on the live site after the API has slept and records what happened.

**Code.** [health endpoint](../backend/src/routes/index.js#L28) · [a failed job tells staff](../backend/src/services/jobService.js#L127) · [Background Jobs page](../frontend/src/app/dashboard/jobs/page.js) · [prod-wake-check.js](../tools/prod-wake-check.js)

**Explain.** There are no metrics, no uptime check and no alert outside the app — those are Phase 9, step 5. Say what is missing: the four golden signals (latency, traffic, errors, saturation), a metrics endpoint that something like Prometheus scrapes, an outside check of the health endpoint, and alerts that reach a person. The logging half of this sub-goal is the Logging topics.

## Also exercised

### 34. ✅ Concurrency and isolation

**Topic.** Many people acting on the same seats and money at the same moment.

**In Seat Planner.** Seat holds claim segments atomically — the unique key on (seat, segment) makes the loser of a race fail cleanly — wallet rows are locked, background jobs use leases with heartbeats, and de-duplication keys stop two clicks queueing two mass refunds. A device takes a place on a subscription with the account's row locked, so of six new devices arriving together exactly one gets the last place; password checks for one email run one at a time, so a burst of guesses is counted in order.

**Code.** [holdService.create](../backend/src/services/holdService.js#L62) · [seat-segment unique key](../backend/migrations/20260105000000-segment-inventory.js#L51) · [job de-duplication](../backend/src/services/jobService.js#L156) · [lease heartbeat](../backend/src/services/jobService.js#L245) · [a place taken under a lock](../backend/src/services/deviceService.js#L241) · [one password check at a time](../backend/src/services/authService.js#L188)

### 35. ✅ Authentication and authorization

**Topic.** Proving who someone is, and deciding what they may do.

**In Seat Planner.** Hashed passwords, short-lived JWTs with rotating refresh tokens, and permissions as data with an escalation guard. Sign-in pauses for an account after a run of wrong passwords. A caller outside the app can check a subscription with an email and password — through the same check as sign-in, pause included — and is given no session.

**Code.** [tokenService.rotateRefreshToken](../backend/src/services/tokenService.js#L74) · [escalation guard](../backend/src/services/roleService.js#L24) · [the pause after wrong passwords](../backend/src/services/authService.js#L216) · [one check for sign-in and outside callers](../backend/src/services/authService.js#L274)

## Application deployment — the rest of the goal sheet

### 36. 🟡 Deployment Strategies

**Topic.** How a new version takes over from the old one: all at once (recreate), instance by instance (rolling), a second copy that traffic is switched to (blue-green), or a small share of traffic first (canary).

**In Seat Planner.** Partly. The web app is released blue-green style by its host: every push is built as its own immutable deployment, the public address moves to it only once it is ready, and earlier deployments stay available to switch back to. Every branch and pull request gets a preview address before anything reaches production. The API is replaced by a container built from the new commit, which applies pending migrations before it serves — the schema side is topic [17](#17--schema-deployment-strategy).

**Code.** [README: Deployment](../README.md) · [migrations, then start](../backend/Dockerfile#L39) · [previews admitted by pattern](../backend/src/utils/allowedOrigin.js#L66)

**Explain.** Rolling and canary releases need several instances behind a load balancer, and there is one API instance here. Say what each strategy is, what it costs (two copies running for blue-green, routing rules for canary), and why a schema change has to stay compatible with the old code while both versions run: expand, migrate, contract.

### 37. ✅ Deployment Tools and Technologies

**Topic.** The tools that build, ship and run the system, and what each one is for.

**In Seat Planner.** Docker builds the two images and Docker Compose runs the whole stack; Caddy is the reverse proxy and obtains HTTPS certificates; Vercel hosts the web app, Render the API container and Aiven the MySQL database; GitHub Actions tests every change and builds the Android release; sequelize-cli applies the schema migrations; Gradle builds the Android app.

**Code.** [backend/Dockerfile](../backend/Dockerfile) · [docker-compose.yml](../docker-compose.yml) · [Caddyfile](../Caddyfile) · [ci.yml](../.github/workflows/ci.yml) · [android.yml](../.github/workflows/android.yml) · [the migrate command](../backend/package.json#L17) · [the Android build](../android/app/build.gradle.kts)

### 38. ✅ On-Premises Deployment

**Topic.** Running the whole system on a server you own, with no managed services.

**In Seat Planner.** The Compose file of topic [28](#28--docker-compose-environment-volumes-and-networking) is the on-premises deployment: MySQL, MongoDB, the API, the web app and Caddy on a single machine, from one command. Given a domain name, Caddy serves HTTPS by itself; data lives in named volumes that outlive the containers; everything is configured from one `.env` file.

**Code.** [docker-compose.yml](../docker-compose.yml) · [Caddyfile](../Caddyfile) · [.env.example](../backend/.env.example) · [README: Everything in Docker](../README.md)

**Show it.** `docker compose up --build`, then open http://localhost.

### 39. 🟡 Containerization and Orchestration

**Topic.** Packaging each part with what it needs to run (a container), and running many containers as one system: start order, restarts, networking, scaling (orchestration).

**In Seat Planner.** Partly. The containers are topics [27](#27--dockerfile-basics-and-dockerizing-nodejs) and [28](#28--docker-compose-environment-volumes-and-networking). Compose is orchestration on one machine: the API waits for the database's health check before starting, every service restarts unless stopped, and containers find each other by service name on a private network.

**Code.** [start order](../docker-compose.yml#L43) · [restart policy](../docker-compose.yml#L10)

**Explain.** Orchestration across several machines is not here. Say what Kubernetes adds — scheduling onto nodes, replicas and scaling, self-healing, rolling updates, service discovery and ingress — and how this stack would map onto it: each Compose service becomes a Deployment with a Service, Caddy becomes the Ingress, the volumes become persistent volume claims, and the `.env` file becomes ConfigMaps and Secrets.

### 40. ✅ Best Practices for Application Deployment

**Topic.** The habits that make a deploy uneventful: the same build everywhere, configuration outside the code, schema and code moving together, and nothing secret in an image.

**In Seat Planner.** Configuration comes from the environment, with an example file listing every variable. The web image is built with a relative API address, so one image runs behind any domain. Schema changes are versioned migrations applied by the container before it serves — never an automatic sync. The API waits for the database to be healthy. Containers run as a non-root user, and no secret is baked into an image. Changes are seen on a preview address first. The tests start the app through the same boot sequence production uses.

**Code.** [config/env.js](../backend/src/config/env.js) · [.env.example](../backend/.env.example) · [a relative API address](../frontend/Dockerfile#L18) · [migrations, then start](../backend/Dockerfile#L39) · [never a sync](../backend/src/boot.js#L17) · [waits for the database](../docker-compose.yml#L43) · [one boot sequence](../backend/src/boot.js#L9)

**Explain.** Two it does not follow yet, and worth naming before someone asks: a deploy does not wait for the checks, and backups are not scheduled.

### 41. 💬 Jenkins - Basics

**Topic.** Jenkins is a self-hosted automation server: it watches a repository and runs builds, tests and deploys on machines you control.

**Explain.** A controller schedules the work and keeps the configuration; agents do the work. A job is a definition and a build is one run of it, with a workspace, a console log and artifacts. A build starts from a webhook, a poll of the repository, a timer, or by hand. Almost everything — Git, Node, Docker, notifications — is a plugin.

**Nearest thing here.** This project's CI is the hosted equivalent (topic [26](#26--code-coverage-and-ci)), so each idea has a counterpart to point at: a workflow is a job, a runner is an agent, `on:` is the trigger, repository secrets are credentials, and the coverage report kept by each run is an archived artifact.

**Code.** [the triggers](../.github/workflows/ci.yml#L6) · [a job and its runner](../.github/workflows/ci.yml#L18) · [an artifact kept](../.github/workflows/ci.yml#L74)

### 42. 💬 Jenkins - Freestyle Project

**Topic.** A job configured through Jenkins's web forms rather than a file.

**Explain.** Its parts, top to bottom: where the source comes from, what triggers a build, the build environment, the build steps (usually shell commands), and the post-build actions — archive artifacts, publish test results, notify. It is quick to set up, but the configuration lives in Jenkins and not in the repository, so it is neither reviewed nor versioned with the code. That is why pipelines replaced it.

**Nearest thing here.** The *Frontend build* job is exactly what a freestyle job would be: check out, install with `npm ci`, run `npm run build`.

**Code.** [the frontend build job](../.github/workflows/ci.yml#L88)

### 43. 💬 Jenkins - Pipeline Project

**Topic.** The build written as code, in a `Jenkinsfile` kept in the repository.

**Explain.** Declarative (`pipeline { agent … stages { stage { steps } } post { } }`) or scripted (plain Groovy). Stages show progress, `parallel` runs them side by side, `environment` and `credentials()` bring in settings and secrets, and `post` runs clean-up and notifications whatever the result. Because it is in the repository, it is reviewed and it changes with the code it builds.

**Nearest thing here.** `ci.yml` is this project's pipeline as code, and it translates stage by stage: the two jobs become two parallel stages, the MySQL and MongoDB services become sidecar containers, `npm run coverage` is one `sh` step, and the kept coverage report is `archiveArtifacts`.

**Code.** [the service containers](../.github/workflows/ci.yml#L21) · [the test step](../.github/workflows/ci.yml#L64) · [the report kept](../.github/workflows/ci.yml#L74)

### 44. 💬 Jenkins - Configuration

**Topic.** Setting up the Jenkins server itself.

**Explain.** Under *Manage Jenkins*: plugins; global tools such as the JDK and Node versions; the credentials store; nodes and agents with their labels; who can sign in and what they may do; and system settings such as the server's address and mail. Kept as a YAML file with Configuration as Code, a server can be rebuilt rather than clicked together again.

**Nearest thing here.** The same concerns appear in the Android release workflow: the signing key and its passwords come from the repository's secret store and never from the repository, and the JDK version is pinned for the build.

**Code.** [secrets, not files](../.github/workflows/android.yml#L33) · [a pinned tool version](../.github/workflows/android.yml#L42)

### 45. ✅ Docker - Security

**Topic.** Limiting what a container can do, and what an image gives away.

**In Seat Planner.** Both containers drop root and run as the `node` user. No secret is baked into an image: `.env` files are excluded from the build, and configuration arrives at run time. The database is used through an application account, not root. Only the reverse proxy publishes ports — the API and MySQL are reachable only on the stack's private network, and MongoDB is published on the loopback address alone. The proxy's configuration is mounted read-only.

**Code.** [not root](../backend/Dockerfile#L33) · [secrets kept out of the build](../backend/.dockerignore#L9) · [an application account](../docker-compose.yml#L14) · [loopback only](../docker-compose.yml#L35) · [mounted read-only](../docker-compose.yml#L92)

**Explain.** Not here, and worth naming: scanning images for known vulnerabilities, pinning base images by digest, a read-only root filesystem, and dropping Linux capabilities.

### 46. 💬 Docker - Resource Management

**Topic.** Stopping one container from taking the whole machine.

**Explain.** Limits on memory and CPU (`--memory`, `--cpus`, or `deploy.resources.limits` in Compose); what happens at the limit — the kernel kills the process for memory and throttles it for CPU; reservations against limits; `docker stats` to see real use; restart policies; and why Node's own heap limit (`--max-old-space-size`) has to sit below the container's memory limit.

**Nearest thing here.** The Compose file sets restart policies and a health check but no limits. The nearest real limit is in the application: the database connection pool is capped by `DB_POOL_MAX`, because the free database allows few connections.

**Code.** [restart policy](../docker-compose.yml#L10) · [the pool cap](../backend/src/config/database.js#L23)

### 47. 💬 Docker - Custom Registries

**Topic.** Where images are stored and pulled from, when it is not the public Docker Hub.

**Explain.** A registry holds repositories of tagged images: `docker login`, `tag`, `push`, `pull`. It can be one of your own (`registry:2`) or hosted (GitHub Container Registry, a cloud provider's). Tags move but digests do not, so a deploy should name the digest; and a server needs credentials to pull from a private one.

**Nearest thing here.** Nothing is pushed here: Compose builds the images where they run, and Render builds the API from its Dockerfile. The same idea does exist for the Android app — the release workflow builds a versioned file once and publishes it for phones to download.

**Code.** [built where it runs](../docker-compose.yml#L39) · [a published, versioned build](../.github/workflows/android.yml#L100)

## Debugging techniques

### 48. 🎬 Conditional Breakpoints and Actions

**Topic.** Stopping only when a condition holds, or logging a value without stopping at all (a logpoint) — so the tenth interesting call is reached without stepping through nine dull ones.

**Do.** Run the API under the debugger: in VS Code open a *JavaScript Debug Terminal* in `backend/` and run `npm run dev`. Put a breakpoint on the first line inside `holdService.create`, edit it, and give it the condition `seatIds.length > 2` — choosing one seat sails through, choosing three stops. Then add a logpoint in the same function with the message `hold: {seatIds.length} seats for user {userId}`: it prints on every hold and never pauses. A hit count (`>= 3`) stops on the third call only.

**Code.** [holdService.create](../backend/src/services/holdService.js#L62)

### 49. 🎬 Attach to Process

**Topic.** Connecting a debugger to a program that is already running, instead of starting it under one.

**Do.** Start the API with `node --inspect src/server.js` in `backend/`; it prints the port a debugger can connect on. In VS Code run *Debug: Attach to Node Process* and pick it — breakpoints now bind in the running server, and detaching leaves it running. `chrome://inspect` in a browser lists the same process. On a phone, the page inside the Android app can be attached to in the same way while the app is pointed at a development server.

**Code.** [how the API starts](../backend/package.json#L7) · [the app allows a debugger in development](../android/app/src/main/java/com/seatplanner/app/MainActivity.kt#L206)

### 50. 🎬 Debugging Child Processes

**Topic.** A program that starts other programs: a debugger attached only to the parent never stops in the child.

**Do.** The integration tests are a parent and its children: the runner keeps the API inside its own process and starts every suite as a separate Node process. In a VS Code *JavaScript Debug Terminal* run `npm run test:integration -- subscription-devices`; the terminal attaches to each child as it starts. A breakpoint in the suite stops in the child, one in `deviceService.admit` stops in the parent, and the call-stack panel shows both. Without that, the child would have to be started with `--inspect-brk` on a port of its own.

**Code.** [each suite is a child process](../backend/tests/integration/run.js#L90) · [the API stays in the parent](../backend/tests/integration/run.js#L213) · [a suite](../backend/tests/integration/suites/subscription-devices.js) · [deviceService.admit](../backend/src/services/deviceService.js#L218)

### 51. 🎬 Debugging Mixed Code Bases

**Topic.** One behaviour that crosses languages and runtimes, so no single debugger sees all of it.

**Do.** The Android app is Kotlin hosting the site's JavaScript, and it runs scripts of its own inside the page. Follow the back button across the boundary: Kotlin asks the page to close an open dialog and acts on the answer. With the app pointed at a development server, open `chrome://inspect` on the computer to debug the page inside the app, and watch the Kotlin side with `adb logcat` or Android Studio. The same crossing exists between the browser and the API: every response carries an `X-Request-Id`, which is the thread to pull from a failing request in the browser's network panel to the server's records.

**Code.** [Kotlin calls into the page](../android/app/src/main/java/com/seatplanner/app/MainActivity.kt#L369) · [the scripts it runs there](../android/app/src/main/java/com/seatplanner/app/PageScripts.kt) · [debugging the page is allowed in development](../android/app/src/main/java/com/seatplanner/app/MainActivity.kt#L206) · [the request ID in every response](../backend/src/middleware/requestContext.js#L18)

### 52. 💬 Debugging in Multi-threaded Applications

**Topic.** Several threads touching the same state: faults that depend on timing and vanish when stepped through.

**Explain.** The threads view and a call stack per thread; freezing the others while stepping one; why a breakpoint changes the timing, so that logs with thread names and timestamps often show more than stepping does; races and deadlocks, and how to tell them apart; handing a result back to a UI thread safely. For Node, say why it is different: JavaScript runs on one thread, so the same faults appear as interleavings between `await`s and between database transactions — found with async stack traces and by reading lock waits in the database.

**Nearest thing here.** Two real cases. The Android app tests a server address on a background thread and hands the result back to the UI thread, discarding it if a newer test has started meanwhile — the stale-result race, guarded. And the API's own races are in the database (topic [34](#34--concurrency-and-isolation)) — two purchases of one seat, six new devices for one place — each pinned down by a test that fires them together.

**Code.** [work on a background thread](../android/app/src/main/java/com/seatplanner/app/ServerActivity.kt#L137) · [a stale result is discarded](../android/app/src/main/java/com/seatplanner/app/ServerActivity.kt#L140) · [two purchases of one seat](../backend/tests/integration/suites/concurrency.js)

### 53. 💬 Core dump analysis

**Topic.** Reading the memory image a process leaves behind when it crashes, to find out what it was doing.

**Explain.** What a dump holds (every thread's stack, the heap, the loaded modules); how one is produced (`ulimit -c unlimited` on Linux, `node --abort-on-uncaught-exception`, a minidump or `procdump` on Windows); how it is read (`lldb` or `gdb`, with `llnode` to see JavaScript frames and objects; WinDbg on Windows); and the lighter tools usually tried first in Node — a diagnostic report and a heap snapshot.

**Nearest thing here.** No dump has been needed here and nothing in the code produces one. The nearest thing that can be shown in a minute: start the API with `node --report-uncaught-exception --report-on-fatalerror src/server.js`, and when the process dies it writes a JSON report — the JavaScript and native stacks, heap statistics and open handles — which is what a core dump is usually opened to find.

**Code.** [how the API starts](../backend/package.json#L7)

### 54. ✅ Different env issue reproduce

**Topic.** A fault that appears in one environment and not another — and making it appear on your own machine, which is most of fixing it.

**In Seat Planner.** Four real ones. A timestamp was written in the server's own timezone: invisible on servers set to UTC, six hours out on a developer's machine — fixed by using the database's UTC clock, and a check now fails on any machine where the two differ. Production's host blocks SMTP, so mail that worked locally never left; there it goes over HTTPS. A sleeping production API refuses requests that arrive through the web host's proxy: a browser check simulates that sleeping server locally, and a script records the real one. And a phone refuses its camera to a page that is not served over HTTPS, so a tool serves the local site over HTTPS on the network. Behind all four: the tests start the app through the same boot sequence as production, and Compose runs the production images locally.

**Code.** [the database's UTC clock](../backend/src/services/deviceService.js#L182) · [the check for it](../backend/tests/integration/suites/subscription-devices.js#L144) · [mail over HTTPS](../backend/src/services/emailService.js#L161) · [a simulated sleeping server](../e2e/test-wake.js) · [the real one, recorded](../tools/prod-wake-check.js) · [HTTPS on the local network](../tools/lan-https.js) · [one boot sequence](../backend/src/boot.js#L9)

## Logging — the rest of the goal sheet

### 55. ✅ Introduction to logging

**Topic.** What a system writes down about itself, and who reads it.

**In Seat Planner.** Three records, for three readers. The application log is lines on the console for whoever runs the server: what started, what was skipped, what failed. The audit log is data for whoever is accountable: who did what, to which thing, from where. Job history is rows for operators: what background work ran, how far it got and why it stopped.

**Code.** [a line at start-up](../backend/src/services/emailService.js#L38) · [auditService.record](../backend/src/services/auditService.js#L18) · [a job's run, recorded](../backend/src/services/jobService.js#L243)

### 56. ✅ Different log types

**Topic.** Logs differ by what they are for: running the system, proving who did what, tracing requests, tuning queries.

**In Seat Planner.** Five kinds are kept. An application log on the console. An access log — one line per request — in development. An audit and security log in MongoDB: every privileged action, every sign-in, wrong password and pause. A query log of every SQL statement, in development. And job history in the database.

**Code.** [access log](../backend/src/app.js#L47) · [query log](../backend/src/config/database.js#L17) · [the audit actions](../backend/src/constants/auditActions.js#L8) · [a failed sign-in, recorded](../backend/src/services/authService.js#L284) · [Background Jobs page](../frontend/src/app/dashboard/jobs/page.js)

### 57. 🟡 Logging frameworks/libraries

**Topic.** A library that handles levels, formats and destinations, so the code only says what happened.

**In Seat Planner.** Partly. One small library is used: `morgan` writes the request line in development. Everything else is the built-in console. Adopting a framework proper is the plan in topic [23](#23--asynchronous-logging-frameworks-rotation-distributed-logging).

**Code.** [morgan](../backend/src/app.js#L47)

**Explain.** Say what a framework adds, and name two: pino (fast, JSON first, child loggers that carry context) and winston (transports and formats). Levels by environment, a child logger per request, redaction, and transports to files or to a log service.

### 58. 💬 Asynchronous logging

**Topic.** Writing log entries without making the request wait for the disk or the network.

**Explain.** The request hands the entry to a buffer and carries on; a background writer — in pino, a worker thread — sends it. It is faster under load, at a price: entries still in the buffer are lost if the process dies, so a fatal error is flushed synchronously, and a full buffer must either drop entries or push back.

**Nearest thing here.** Nothing is logged asynchronously here; it is part of the plan in topic [23](#23--asynchronous-logging-frameworks-rotation-distributed-logging). The nearest decision in the code is the opposite one, made on purpose: an audit entry is awaited before the response is sent, so it is not lost — but it can never fail the action either. If the audit store is down, the entry is skipped with a warning.

**Code.** [auditing never fails the action](../backend/src/services/auditService.js#L8)

### 59. 🟡 Distributed logging

**Topic.** One request passes through several programs; their logs have to be joined to tell its story.

**In Seat Planner.** Partly. The joining is topic [20](#20--correlating-entries-to-one-request): every request gets an ID that every audit entry it causes carries. The same ID is returned to the caller in a header, so a person reporting a problem can quote it.

**Code.** [returned in a header](../backend/src/middleware/requestContext.js#L18) · [runWithContext](../backend/src/utils/requestContext.js#L16)

**Explain.** Joining is as far as it goes: the web host, the API host and the database each keep their own logs. Say what completes it — one place that collects every service's logs, and an ID passed along with each call so that a trace spans all of them.

## ORM — the rest of the goal sheet

### 60. ✅ Unit Test — testing code that uses the ORM

**Topic.** Testing code that talks to the database through the ORM.

**In Seat Planner.** Database code is tested against a real MySQL database, not a stand-in: the runner builds one with the same migrations as production, snapshots it, and restores it before every suite, so each of the 44 suites starts from the same rows. The rules themselves are pulled out of the services into pure functions, so most of the 265 unit tests need no database at all.

**Code.** [snapshot](../backend/tests/integration/run.js#L138) · [restore](../backend/tests/integration/run.js#L154) · [a rule kept pure](../backend/src/utils/subscriptionDevices.js#L122) · [the service that applies it](../backend/src/services/deviceService.js#L218)

**Explain.** Say the alternatives and why they were not used: an in-memory SQLite behaves differently from MySQL (locks, JSON, upserts), and mocked models prove only that the mock was called.

## Operating system

### 61. 🟡 Advanced Shell Scripting

**Topic.** Scripts that make decisions: pulling text apart, conditions, exit codes, values passed from one step to the next.

**In Seat Planner.** Partly. The Android release is driven by shell. It pulls the version out of the build file with `sed`, compares it with the tag, and stops the release with an error if they differ; decodes the signing key from a secret into a temporary file and hands its path to later steps; strips the tag's prefix with a parameter expansion; and publishes the release from the command line. The API container's start command chains migration and start, so a failed migration stops the start.

**Code.** [a version pulled out with sed](../.github/workflows/android.yml#L49) · [the key, decoded](../.github/workflows/android.yml#L64) · [a prefix stripped](../.github/workflows/android.yml#L98) · [published from the command line](../.github/workflows/android.yml#L100) · [migrate, then start](../backend/Dockerfile#L39)

**Explain.** These are short. Say what longer scripts need: `set -euo pipefail`, functions, `trap` for clean-up, arrays, `getopts`, here-documents, and checking with `shellcheck`.

### 62. 🟡 Service and System Management

**Topic.** Keeping long-running programs running: starting them in order, restarting them, scheduling work.

**In Seat Planner.** Partly. The services are containers managed by Compose: each restarts unless stopped, the API starts only when the database reports healthy, and data survives in volumes. Scheduled work is not cron but timers inside the API — expiring holds every minute, pruning daily — and long work is a durable job that another worker takes over if the first one dies.

**Code.** [restart policy](../docker-compose.yml#L10) · [start order](../docker-compose.yml#L43) · [how work is scheduled](../backend/src/jobs/index.js#L25) · [a schedule entry](../backend/src/jobs/index.js#L113) · [a job taken over](../backend/src/services/jobService.js#L206)

**Explain.** Say the operating system's own tools for the same job: a systemd unit (`systemctl enable`, `start`, `status`, and `journalctl` for its log), cron and systemd timers, and Windows services.

### 63. 🟡 Security and Troubleshooting

**Topic.** Giving a program the least access it needs, and finding out why two machines cannot talk.

**In Seat Planner.** Partly. Containers run as an unprivileged user, the database is used through an application account, and MongoDB listens on the loopback address only. For trouble between a phone and a development computer, the Android app says which kind it is — nothing listening on the port, no answer (a firewall, or another network), an unknown address — and its guide lists the checks: the same Wi-Fi, the firewall's private-network rule, forwarding a port over USB.

**Code.** [not root](../backend/Dockerfile#L33) · [loopback only](../docker-compose.yml#L35) · [what failed, in words](../android/app/src/main/java/com/seatplanner/app/Reachability.kt#L36) · [the checks](../android/README.md)

**Explain.** Say the general kit: users, groups and file permissions; which process holds a port (`ss`, `netstat`); firewall rules; DNS (`nslookup`); what is using the CPU, memory and disk (`top`, `df`); and reading the system log.

## Unit testing — the rest of the goal sheet

### 64. 🟡 Testing Multi-Threaded Code

**Topic.** Tests for code that runs at the same moment as other code.

**In Seat Planner.** Partly. The asynchronous half of this sub-goal is topic [25](#25--testing-asynchronous-code). Things happening at once are tested too: two purchases of the same seat fired together must not both succeed, and of six new devices arriving together exactly one takes the last place.

**Code.** [two purchases of one seat](../backend/tests/integration/suites/concurrency.js) · [six devices, one place](../backend/tests/integration/suites/subscription-devices.js#L282)

**Explain.** JavaScript here runs on one thread, so nothing tests threads as such — the simultaneous cases above race in the database, not in memory. Say what thread tests need that these do not: shared memory, locks, and a way to force a particular interleaving.

## Turning a talk into something to show

None of this is built. Each row is a piece of work that would move the topics beside it from being
explained, or planned, to being shown.

| What could be built | Topics it would move |
|---|---|
| A `Jenkinsfile` that runs what `ci.yml` runs, with Jenkins in a container beside the stack | [41](#41--jenkins---basics), [43](#43--jenkins---pipeline-project), [44](#44--jenkins---configuration) |
| A logging library such as pino: JSON lines, a level per environment, the request ID on every line, an asynchronous transport | [21](#21--basic-logging-and-log-levels), [23](#23--asynchronous-logging-frameworks-rotation-distributed-logging), [57](#57--logging-frameworkslibraries), [58](#58--asynchronous-logging), [59](#59--distributed-logging) |
| Memory and CPU limits on each service in the Compose file, shown with `docker stats` | [46](#46--docker---resource-management) |
| A CI step that pushes the API image to a registry, and a Compose file that pulls it | [47](#47--docker---custom-registries), [31](#31--cicd) |
| A database backup script, and a restore that has been tried | [32](#32--rollback-and-disaster-recovery), [61](#61--advanced-shell-scripting) |
| A metrics endpoint, and an outside check of the health endpoint | [33](#33--monitoring) |
| A systemd unit that runs the Compose stack on a server | [62](#62--service-and-system-management) |
