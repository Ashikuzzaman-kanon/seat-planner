# Railway Ticket Management System — Specification & Build Plan

> **Status:** phases 1-8 complete; phase 9 (hardening) remains. A passenger can
> search, buy, collect a ticket, return it under either policy, extend a seated
> journey with connecting standing, and queue for a sold-out stretch; transfers and
> withdrawals go through one approval queue. Checkers verify tickets online and
> offline, reports feed a review queue, and a cancelled coach or departure refunds
> everyone aboard through a durable background job that survives a restart.
> Section 17 carries the per-phase state, and 17.1 the reported issues.
>
> Evolves the existing seat-planner app. Auth, RBAC, reference-data CRUD, the seat-plan
> designer, and the whole Docker/deploy pipeline carry over.

---

## 1. What we are building

A railway ticketing platform.

Admins define the network — stations, trains, coaches, routes, fares. Privileged roles
compose trains from designed coach layouts, distribute seat inventory, and handle
disruptions. Passengers register, search a departure, book seats, pay, and receive a PDF
and QR ticket by email. They may refund or transfer tickets. Ticket checkers validate
tickets in the field and report abuse.

The distinguishing feature is **segment-level seat inventory** (§6): one seat is sold
independently across different parts of a route.

---

## 2. Core domain model

The most important structural decision: **inventory and tickets attach to a trip, not to
a train.**

```
station
train ── identity, code
  ├── route             ordered stops: seq, station, arrive, depart, day_offset, distance
  ├── fare rules        ordered chain, per class
  ├── default           the standard coach line-up
  │   composition
  ├── quota rules       per train + effective date range
  └── TRIP              = train + departure date          ◄── tickets attach HERE
        ├── composition       materialised from the default, overridable per trip
        ├── seat inventory    per seat, per segment
        ├── quota             materialised from train rules
        └── tickets

coach_layout    the seat-plan design — a reusable template of rows → cells → seats
```

### 2.1 Why composition lives on the trip

*Add a coach*, *remove a coach*, *cancel a coach and refund its seats*, *cancel a train*
are operations on **one departure**. Cancelling the 4 October run must not touch
5 October. Each trip therefore carries its own composition, materialised from the train's
default template at generation time.

### 2.2 Trip generation

Trips are generated **automatically** on a rolling horizon from a weekly schedule pattern
— the system always holds *N* days of upcoming departures, *N* being configurable. Each
new trip materialises its composition, seat inventory and quota rules on creation.

### 2.3 Overnight trains and time

Route stops carry a **`day_offset`**. A train departing at 23:30 with `day_offset = 0`
reaches a later stop at 06:00 with `day_offset = 1`. A trip is identified by its
**departure date at the origin**. All times are computed in **Asia/Dhaka**.

---

## 3. Roles & permissions

Replaces the static `user < planner < admin < super_admin` constants.

| Aspect | Decision |
|---|---|
| Predefined roles | **Only `super_admin`.** Everything else is created at runtime |
| New registrations | Get a default **`user`** role with baseline passenger capability |
| Role shape | **Flat.** No rank or level — managing roles is itself a permission |
| Roles per user | **Multiple.** Effective permissions = **union** of all roles held |
| Delegation | Super admin may grant role-management permissions to other roles |
| **Escalation guard** | **A role-manager may only grant permissions it already holds.** Without this, role-management is a one-step path to super admin |
| Revocation | Any role, any time, effective within seconds — see §3.2 |

### 3.1 Permission catalogue

Permissions are **code-defined** — every endpoint declares the key it requires — and
stored as a catalogue. Roles are **database rows**; `role_permissions` and `user_roles`
join them. Admins compose roles freely from the catalogue but cannot invent permissions
no endpoint honours. Every new feature contributes keys, and roles adapt with no code
change.

### 3.2 Token strategy

A 365-day JWT would leave a revoked role live for a year. Instead:

- **Short-lived access token** carrying identity only — never a frozen permission list
- **Refresh token**, revocable server-side
- **Permissions resolved per request** from the database, cached, invalidated on any role
  or permission change

This is what makes "revoke any role at any time" real rather than nominal. It also suits
native mobile clients, which cannot rely on httpOnly cookies — endpoints accept both
cookie and bearer credentials.

---

## 4. Reference data & the seat planner

Admin-managed lookups: stations, trains, coach types, coach classes, seat attributes, and
the configuration values in §15.

The **existing seat-plan designer is retained**, with static role gates replaced by
dynamic permissions. A seat plan is a **coach layout template** — a JSON grid of rows →
cells → seats, each seat carrying attributes.

**Seat attributes are data, not hardcoded fields.** Window (full/half), charging port,
fan, direction and notes are catalogue entries. Adding "extra legroom", "USB port" or
"near toilet" later requires no migration — and because auto-select filters are generated
from the same catalogue, new attributes become filterable automatically.

---

## 5. Route & fare

| Aspect | Decision |
|---|---|
| Route | Ordered stops with arrival, departure, `day_offset`, cumulative distance |
| Fare model | **Both** — an explicit fare table per class per station-pair, falling back to `distance × per-km rate` when no table row matches |
| Presentation | **Single amount.** No itemised base / VAT / service-charge split |
| Structure | An **ordered rule chain**, so peak/off-peak, holiday surcharges, child and senior fares, promo codes or dynamic pricing are added as new rules without rewriting the engine |

---

## 6. Segment-based seat inventory ★ core feature

Route `A → B → C → D` decomposes into **3 segments**: `A-B`, `B-C`, `C-D`. A seat is not
sold "for the trip" — it is sold **per segment**.

**Availability rule:** seat *S* is bookable for `X → Y` **iff every segment in `[X, Y)`
is unoccupied** on that trip.

| Action on seat 5 | Segments occupied | Still sellable as |
|---|---|---|
| Sell `B→C` | `B-C` | `A-B`, and `C-D` — two independent sales |
| Sell `A→C` | `A-B`, `B-C` | `C-D` only |
| Sell `A→D` | all three | nothing |

### 6.1 Storage

Source of truth is one row per occupied segment:

```
seat_segment_booking (trip_id, seat_id, segment_index, ticket_id)
UNIQUE (trip_id, seat_id, segment_index)
```

The unique constraint is what makes concurrent booking safe — two simultaneous purchases
of the same seat-segment cannot both commit; the loser rolls back. Rows rather than a
bitmask, so route length is unbounded and per-segment metadata stays possible.

### 6.2 Availability matrix

A station-pair grid showing seats free per segment, for operators and passengers. The
clearest demonstration of the whole model.

---

## 7. Seat distribution & quota

A role with seat-distribution capability marks each seat on a trip as:

- **Open** — sellable for any valid segment range
- **Reserved** — restricted to a specific station pair

| Aspect | Decision |
|---|---|
| Match mode | **Exact only.** A seat reserved for `A→C` sells *only* as `A→C` |
| Auto-release | **Yes.** Unsold reserved seats revert to open a configurable interval before departure |
| Scope | Defined **per train** with an effective date range, **materialised onto each trip** |
| Future-proofing | Match mode is stored as a field even though only `EXACT` ships, so adding `WITHIN` later is a config row rather than a migration |

Exact matching is deliberately strict and would strand inventory on its own; auto-release
is what recovers it. The two decisions depend on each other.

---

## 8. Booking & payment

| Aspect | Decision |
|---|---|
| Booking size | **Up to 4 tickets per booking** |
| Passenger data | Each ticket carries its own name, NID and DOB, so a user may book for family |
| Seat hold | Selected seats lock for a configurable window during checkout, auto-releasing on timeout |
| Providers | A pluggable **`PaymentProvider`** interface. Ships with a simulated gateway and the wallet; a real gateway drops in without touching booking logic |

Booking is the transactional centrepiece: **reserve every segment, create the tickets, take
payment — atomically, or not at all.**

### 8.1 Wallet

Optional stored credit enabling one-click purchase — and, more importantly, making the
refund model in §11 workable.

| Aspect | Decision |
|---|---|
| Top-up | Through the simulated gateway |
| Withdrawal | Permitted, but **requires approval** by a privileged role |
| Split payment | Wallet balance plus gateway for the remainder |
| Refund destination | **Always the wallet** |
| Balance cap | Configurable maximum |

**The ledger is append-only.** There is no mutable `balance` column updated in place —
balance derives from an immutable transaction log, every entry referencing its cause
(booking, refund, top-up, withdrawal, adjustment). Concurrent bookings from one wallet are
guarded by row-level locking **inside the same transaction that reserves seat segments**,
so a wallet cannot be overdrawn.

Money enters by gateway, refunds land in the wallet, and the only exit is a
human-approved withdrawal — which is also where buy-and-refund churn gets caught.

---

## 9. Seat selection modes

**Manual** — the passenger picks exact seats from the rendered layout, seeing every seat
attribute captured in the planner.

**Auto-select** — the passenger gives a quantity plus optional filters drawn from the
attribute catalogue.

| Aspect | Decision |
|---|---|
| Grouping | **"Keep together" toggle** — prefer adjacent seats in the same row and coach |
| Strictness | **Strict.** Every seat must match the criteria, otherwise the request **reports failure** rather than returning partial matches |

---

## 10. Connecting standing tickets

A passenger holding a **seated** ticket `A→B` may buy **standing** tickets for `X→A`
and/or `B→Y` on the **same trip**, contiguous with the seated leg. Someone who could only
secure a seat for part of their journey can then legitimately travel the whole way,
instead of abandoning the booking or riding unticketed.

| Rule | Decision |
|---|---|
| Prerequisite | Requires an existing seated ticket on that trip — never sold standalone |
| Contiguity | Standing legs must abut the seated leg |
| Capacity | Capped **per coach, configurable per class**, enforced per segment |
| Fare | A **configurable percentage of the seated fare** for the same segment — a flat rate would misprice a 30 km leg against a 300 km one |
| Refund | **Not refundable independently while the seated ticket is still held** — see §11.3 |

---

## 11. Refunds

### 11.1 Convenient Return
Immediate refund minus a percentage deduction scaling with **time remaining before
departure**. Deduction slabs — and the lead time at which tickets **open for sale** — are
configurable.

### 11.2 Demand-Based Return
The seat returns to inventory; money is refunded **only if it resells**.

| Aspect | Decision |
|---|---|
| Granularity | **Per segment.** Each returned segment refunds independently as that segment resells |
| Unsold by departure | **No refund** |
| Deduction | Configurable percentage |

This design is elegant but would be painful to pay out through a gateway — three segments
could mean three separate refunds, with fees, failures and weeks of delay. The wallet is
what makes it practical, and the waitlist (§12) is what makes resale likely.

### 11.3 Standing tickets
Standing is an add-on and follows its seat. It **cannot be refunded on its own while the
seated ticket is held**; refunding the seat releases the attached standing legs with it.

---

## 12. Waitlist

When a segment is full, passengers queue. A refund or release **auto-offers** the freed
seat to the next in line, who confirms in one click from wallet credit. This converts
returned inventory quickly — which is precisely what §11.2 depends on.

### 12.1 How it works

| Aspect | Decision |
|---|---|
| Joining | Only when the stretch is genuinely full. A queue place behind an open seat would wait forever, since the queue is served when a seat *frees* |
| Who travels | Captured **at join time**, not at confirmation. This is what makes one click true — a seat offered to the queue is out of sale for everyone else until answered, so that is the worst possible moment to ask for paperwork |
| Order | Join order, and nothing else. No priority, no paid queue-jumping, no manual reordering; `waitlist:view_all` can watch a queue and cannot touch it |
| Skipping | An entry that cannot be served is passed over, not blocked behind. One seat freeing should reach the next person who wants one seat, not sit idle because the person at the front wants four |
| Offer window | Its own setting (default 60 min), longer than a checkout's ten — the passenger is being emailed, not sitting at the screen |
| Unanswered offers | The seat goes back on sale and the entry keeps its original place. After `waitlist.max_open_offers_missed` lapses it leaves the queue, because each unanswered offer took a seat out of sale for a full window |
| Payment | Wallet only. A card flow is several screens and a redirect, which is the friction this feature exists to remove. A short balance names the shortfall and keeps the offer open |
| Class | Optional. Naming one narrows what counts as a match and converts slower; the UI says so |

### 12.2 What tells the queue a seat came back

`waitlistService.seatsFreed` is called **after the transaction commits**, never inside it —
a sweep running on uncommitted state sees the segments as still occupied and silently does
nothing. Three callers: a return (`refundService.request`), a released checkout and an
expired one (`holdService`). A cancelled departure deliberately does not sweep, since
there is nothing to offer.

Sweeps **chain** per departure rather than dropping a concurrent one. Dropping is wrong:
a sweep asked for *after* a seat was freed must actually see that seat, and a caller told
"nothing found" about a state nobody looked at is being lied to.

When a seat comes back, the seat is **held first and the entry claimed second**. The
reverse order can leave an entry marked as offered with no seat behind it, and nothing
would know to undo that. This way the worst case is an orphaned hold, which the existing
hold-expiry job already collects.

---

## 13. Passengers, identity & transfers

- Registration by **email**, with verification — the existing flow carries over
- Passengers supply **NID** and **DOB**; NID accepts any **10–17 digit** number for now
- Each ticket in a booking carries its own passenger identity
- **Ticket transfer** between NIDs is supported but requires **human approval** by a role
  holding the transfer-approval permission
- Transfer requests are counted as an abuse signal in §14

---

## 14. Field operations & abuse detection

On purchase the passenger receives an **email with ticket details and a PDF**, carrying a
unique ticket number and a **QR code**.

| Capability | Who |
|---|---|
| Verify a ticket by number or QR | Role with verification permission |
| **Report** a ticket — fraud, identity mismatch, misuse | Higher-privileged checker role |

**Scanning marks the ticket used**, recording checker identity, time and station. This
defeats screenshot sharing and produces real no-show data.

**QR payloads are cryptographically signed**, so a checker app can validate a ticket
**offline** inside a moving train and sync the scan later.

### 14.0 Verification, as built (7A)

| Decision | Why |
|---|---|
| **Two verbs: `check` and `scan`** | Looking and admitting are different acts. A passenger asking "am I on the right train" should not have their ticket burned to find out, and marking used is the half that cannot be undone. They are separate permissions (`ticket:verify`, `ticket:scan`) for the same reason |
| **A refusal is HTTP 200** | The request worked, the reader worked, and the answer is no. A 4xx would make a scanner treat a refused ticket like a dropped connection, at exactly the moment it must not |
| **Every attempt is logged, refusals included** | Recording only admissions throws away the half worth having. A ticket presented twice is how a shared screenshot surfaces; a bad signature is somebody trying. `ticket_id` is nullable so forged and unreadable codes — which name no ticket we hold — are still kept |
| **Eight verdicts, each with its own sentence** | "Invalid" is useless in a corridor. A refunded ticket, a copy of somebody else's, and the wrong train need three different things said out loud — and the wrong-train refusal names the service the passenger *is* holding, which is the useful part |
| **Marking used takes a row lock** | Two checkers scanning the same ticket at the same moment must produce one admission and one "already scanned", never two admissions |
| **Last four NID digits only** | Enough for a checker to match the card in a hand; useless to anyone photographing the screen. Same truncation in the downloadable manifest |

**Offline.** The signature proves the railway issued a ticket with no database at all. What a
token cannot carry is anything mutable — refunded, cancelled, already scanned — so a checker
downloads a manifest before departure and syncs afterwards. `scanned_at` is when the scan
happened; `synced_at` is when it arrived, and they can be hours apart. `client_reference` is
the device's own id, unique, so a batch re-sent over bad signal records nothing twice **and is
not counted as fresh admissions**.

A stale manifest is the failure mode of the whole mechanism — a ticket returned after it was
generated still looks valid offline — so the response says so rather than leaving it implied.

### 14.3 Abuse scoring, as built (7B)

Three steps, and the distance between them is the design. A **signal** is an observation, a
**score** is arithmetic over observations, and a **hold** is a punishment. Collapsing any two
produces a system that locks people out for being unusual.

| Decision | Why |
|---|---|
| **Only upheld reports count** | An open report is an accusation nobody has checked. A dismissed one is withdrawn entirely rather than discounted — a report a human rejected is not weak evidence, it is none |
| **Three permissions, kept apart** | `ticket:report` raises a signal, `abuse:review` decides whether it counts, `account:hold` is the only one that can stop somebody buying. A checker holds the first and should not hold the third |
| **Duplicate scans count weakly** | A shared screenshot looks exactly like a checker walking the train twice. One is worth very little; several are worth noticing |
| **Churn is a ratio past a volume floor** | Returning tickets is a service the railway sells. Buying forty and returning four is a good customer; the signal is buying in quantity and returning nearly all of it |
| **Being refused at a gate scores nothing** | A passenger whose ticket was refunded who turns up anyway is confused, not fraudulent. Scoring confusion punishes the least sophisticated passengers hardest |
| **Signals age out** (`abuse.window_days`) | A score with no window never forgives anything |
| **Automatic holds default to off** | A new deployment should watch what the numbers do before letting them lock anyone out. When on, the threshold is deliberately high |
| **A hold stops buying and nothing else** | Existing tickets stay valid, readable, downloadable and travellable. Voiding them would be a second penalty nobody decided on |
| **Lifting requires a reason** | An unexplained release is as unaccountable as an unexplained hold. Holds are rows, not a flag, so the history survives |

The score always returns its **parts** alongside the total — the signal, the count, the weight,
the points and a note on why it counted what it did. A score presented as a bare number is
unarguable, and this one has to be argued with: by the reviewer deciding, and by the passenger
disputing.

**Abuse detection:** ticket reports, transfer requests and buy-and-refund churn accumulate
against an account.

| Aspect | Decision |
|---|---|
| Enforcement | **Scored signals → human review queue → automatic hold only at a high threshold** |
| Reversibility | Always reversible by an admin |
| Auditing | Every action audited |

### 14.1 Disruption operations

| Operation | Rule |
|---|---|
| Add a coach to a trip | Permitted role |
| Remove a coach with **no** sold seats | Permitted role |
| Remove a coach **with** sold seats | **Blocked** on the normal path |
| Cancel a coach, refunding its seats | Higher-privileged role |
| Cancel an entire trip | Higher-privileged role — mass refund plus notification |

**As built (8A).** The higher-privileged role is a permission, `trip:cancel`, split out of
`trip:manage` — before this, cancelling a whole departure and rebuilding an empty one needed
the same permission, though one refunds hundreds of people and the other harms nobody.

| Decision | Why |
|---|---|
| **One builder** | Adding a coach goes through `buildCoach`, extracted from generation. A second copy would drift, and coaches added mid-life would sell differently from ones built at generation |
| **One refund path** | Coach cancellation calls the trip-cancellation refund, scoped to the coach. The rules are identical, and two copies is how they stop being |
| **A coach's passengers include standing tickets on it** | Missing them would leave people holding standing tickets for a carriage that is not running |
| **Removal counts every ticket, not only valid ones** | A returned ticket still names its seat. The rebuild guard learned this the hard way — a raw foreign-key error — and this took the lesson rather than relearning it |
| **Cancelled is not deleted** | Tickets and refunds refer to the seats; that record has to outlive the carriage. Sale already filters on `active`, so nothing more was needed to take it off sale |
| **Reinstating does not revive tickets** | Refunded passengers have their money and may have booked elsewhere. Re-issuing would seat people who are not coming |
| **New seats go to the queue first** | Adding a coach to a sold-out departure is the most common reason to add one |

**As built (8B).** Cancelling a departure or a coach now marks it cancelled and
queues a refund job **in one transaction**, then does the refunds from the job
table. A restart part-way through leaves the job behind, and the next worker
finishes it with the passengers not yet paid.

| Decision | Why |
|---|---|
| **A table, not a queue product** | The work is database work, and the database is already there. A job written in the same transaction as the decision cannot be lost between the two; a message broker cannot offer that without an outbox, which is this table |
| **Claimed under a lease, not a lock** | A conditional `UPDATE … WHERE status = 'queued'` claims a job, and the worker keeps renewing a one-minute lease. No lock is held for the length of the work, so a dead worker leaves nothing stuck: its lease lapses and the job is claimable again. Works on any MySQL, including free tiers without `SKIP LOCKED` |
| **Handlers run twice, do the work once** | A retry follows an interrupted attempt, which may have done some of the work. The refund handler resumes cleanly because a refunded ticket is no longer valid and is never read again; it works in batches of 25 until a batch finds nobody left |
| **Each message is written with its refund** | The cancellation email is queued inside the ticket's refund transaction. Refunded means told — retried if the mail server refuses, resumed after a restart. Sent after the loop, as before, a crash between the two left people refunded and never told why |
| **Retries back off, then stop** | 30s, 1m, 2m… capped at 30 minutes, for `jobs.max_attempts` tries (settings). A refusal (4xx) is not retried at all — it would refuse again. A job that gives up is audited and waits on the Background Jobs screen for a person |
| **The request still answers in full, usually** | It waits up to `jobs.inline_wait_seconds` for the job, so an ordinary cancellation reports what it refunded as it always did (200). A bigger one answers 202 with the job, and the departure board follows it to the end |
| **Reinstating waits for the refunds** | Reinstating mid-refund would put seats back on sale while their holders were still being paid. Refused with the job number and how far it has got |
| **Orphans are noticed at once on the same host** | A job's lock names host and process. On boot, jobs held by a process that no longer exists on this machine are released immediately instead of waiting out the lease |

---

## 14.2 Notifications

Every event that moves a passenger's money or their seat tells them about it. The
templates live in one place (`notificationService`), which is the seam §16.1 reserves
for notification channels — adding SMS, push or in-app means changing `deliver` and
nothing else, because callers say *what happened*, not *how to tell someone*.

| Event | Says |
|---|---|
| Tickets bought | Confirmation with the PDF attached |
| **Convenient** return | Finished: the amount, the deduction, money already in the wallet |
| **Demand** return accepted | Started, *not* paid: the ceiling, how many segments are waiting, and plainly that an unsold seat refunds nothing |
| Demand return pays a segment | What just arrived, what is still waiting, and whether the return is now complete |
| Demand return closes unsold | That it will never pay further, and why |
| Departure cancelled by the railway | Full refund, the reason, why nothing was deducted, and what to do next |
| Transfer or withdrawal decided | The decision, who made it, and always the reason when refused |
| Waitlist seat offered | The seats held, the deadline, one-click confirm |
| Waitlist offer lapsed | Whether they kept their place or used up their allowance |

Two rules hold everywhere:

- **A failed send never fails the operation.** Every send is caught and logged. A refund
  that credited a wallet correctly must not report failure because SMTP was slow, and
  everything announced is visible in the app regardless. Notification is a courtesy laid
  on top of state that is already durable.
- **Nothing is sent from inside a transaction.** A message describing a payment that then
  rolls back is worse than no message. Callers collect what to say, commit, then say it —
  which is why `settleResold` returns its payouts rather than announcing them.

The demand-based return is what makes this load-bearing rather than polite: it pays in
instalments over days as separate stretches resell, so without a message each time a
passenger would have to keep opening the wallet page to discover money had arrived.

---

## 15. Configuration store

The spec accumulates many *"configurable by a privileged role"* values: refund slabs,
sale-open lead time, quota release timing, seat-hold timeout, standing fare percentage,
standing capacity, wallet cap, abuse thresholds, trip horizon length.

Scattering these across env vars and columns is what will hurt most in six months. They
live instead in **one typed, audited settings store** — scoped global → train → class,
validated, with full change history and an admin UI. Future tunables then cost one row
instead of a deployment, and every value is demonstrable live.

---

## 16. Cross-cutting design principles

**Extensible at the seams, concrete in the middle.**

### 16.1 Designed extension points

| Seam | Buys later, free |
|---|---|
| Permission catalogue | New features add keys; roles adapt with no code change |
| `PaymentProvider` interface | Real gateways, new payment methods |
| Seat attribute catalogue | New attributes become filterable automatically |
| Fare rule chain | Discounts, surcharges, promos, dynamic pricing |
| Refund policy registry | Disruption refunds, goodwill credits |
| Quota match mode field | `WITHIN` matching becomes configuration |
| Sellable-unit abstraction | Sleeper berths, cabins, luggage or bicycle space |
| Declarative ticket state machine | `boarded`, `no-show`, `upgraded`, `rescheduled` |
| Generic approval workflow | Transfer, withdrawal and abuse review are **one mechanism**; the fourth costs nothing |
| Notification channels | SMS, push, in-app — templates as data |
| Segment rows, not bitmask | Unbounded route length |

### 16.2 Deliberate non-goals

Flexibility has a cost, and these are declined on purpose:

- **No multi-tenant / multi-operator layer.** One railway. Tenancy taxes every query for a scenario that may never arrive
- **No plugin system or generic rules engine.** Interfaces only where a second implementation is already visible
- **No premature caching or sharding.** Schema keyed so partitioning stays possible; built only when volume justifies it
- **Segment logic stays concrete.** It is the core of the product — it must be obvious and correct, not configurable

### 16.3 Standing conventions

- **`/api/v1`** from the first endpoint
- **Additive migrations** — new nullable columns and backfills, never destructive alters, so rollback is always available
- **OpenAPI documented from the start**, so web and mobile clients generate types rather than hand-writing them
- Mongo-backed audit, history and notifications stay schemaless — new event types need no migration

### 16.4 Mobile readiness

Responsive layout is a requirement of every screen, not a later pass.

- **API-first, already true.** All business logic — fares, availability, auto-select
  matching, refund amounts — stays server-side, so a native client gets identical
  behaviour for free
- **Auth already suits native clients**; endpoints accept cookie or bearer
- **The seat grid is the hard screen.** A coach layout at 390px needs pan/zoom or a
  re-flowed vertical view; it cannot simply stack
- **Ticket data exists independently of the PDF** — the ticket is JSON plus a QR payload,
  and the PDF is one rendering of it
- **Push is just another notification channel**

---

## 17. Build plan

Ordered by hard dependency. Each phase ends with something demonstrable.

| Phase | Scope | Why here |
|---|---|---|
| **1. Access foundation** — *done* | Dynamic roles and permission catalogue, `user_roles`, escalation guard, access + refresh tokens, per-request permission resolution, settings store, audit logging, `/api/v1`, OpenAPI | Everything else is gated by permissions; the token rework is painful to retrofit |
| **2. Network & reference data** — *done* | Stations, trains, coach classes and types, seat attribute catalogue, route builder with `day_offset`, fare rule chain. Seat planner re-gated to dynamic permissions, attributes made data-driven | Nothing can be composed before the network exists |
| **3. Composition & trips** — *done* | Default composition, weekly schedule, rolling-horizon trip generation, per-trip composition, seat inventory materialisation | Creates the object tickets attach to |
| **4. Inventory & availability** ★ — *done* | Segment model, availability engine, quota rules with exact match and auto-release, availability matrix. Heavy unit testing | The core of the product — built and proven before anything sells |
| **5A. Money & the booking transaction** — *done* | Integer money handling, wallet ledger with append-only entries, simulated gateway, split payment, seat hold with timeout and expiry job, the atomic hold→ticket conversion, passenger details | The first end-to-end revenue path |
| **5B. Selection & the passenger UI** — *done* | Auto-select with attribute criteria, the together toggle and strict mode; signed ticket QR, PDF and confirmation email; a passenger-facing search API separate from the operational departure board; the search→seats→passengers→payment→tickets flow, wallet screen and bookings list | Needs a working purchase underneath it |
| **6A. Returns & approvals** — *done* | Three refund policies behind one registry — convenient (time slabs), demand (flat processing charge, paid per segment on resale) and disruption (full fare, issued when the railway cancels); money floors and caps on both charges; per-departure switches for which returns are offered. One generic approval queue carrying ticket transfer and wallet withdrawal. Departure reinstatement, which cancellation had left as a one-way door. Screens for all of it | Requires tickets to exist first |
| **6B-i. Connecting standing** — *done* | Standing legs abutting a seated one, capacity per coach class with a per-departure switch, fare as a share of the seated fare, and standing following its seat through a refund (§11.3) | Needs a seated ticket to attach to |
| **6B-ii. Waitlist** — *done* | Queue for a full segment (§12); a return, released checkout or expired checkout auto-offers the freed seat to whoever is next, confirmed in one click from wallet credit — which is what makes a demand-based return likely to pay out rather than merely possible. Passenger details captured at join time, chained per-departure sweeps, a longer offer window with email, and a read-only view of a queue for staff | Needs returns to exist first |
| **7A. Verification & scanning** — *done* | Check by QR or typed number, eight verdicts each with its own message, scan-marks-used under a row lock, every attempt logged including forgeries, a downloadable manifest for checking with no network, and idempotent offline sync (§14.0) | Requires issued tickets |
| **7B. Reporting & abuse** — *done* | Ticket reporting by a higher-privileged checker; a score over upheld reports, duplicate scans and buy-and-return churn, every weight and threshold a setting; a review queue where upholding is the only thing that makes a signal count; account hold that stops buying and nothing else, always reversible with a required reason, always audited. Automatic holds are **off by default** (§14.3) | Needs the scan log to score against |
| **8A. Coach operations** — *done* | Add a coach from an approved plan through the same builder generation uses; remove a coach nobody has used; refuse removal of any coach a ticket of any status refers to; cancel a coach, refunding everyone on it in full through the trip-cancellation path and telling them why; reinstate. Cancellation of a departure or a coach moved to its own `trip:cancel` permission (§14.1) | Requires refunds and notifications |
| **8B. Durable jobs** — *done* | A job table with retries, so a mass refund survives a restart part-way through instead of dying with the request; trip and coach cancellation moved onto it. Each passenger's cancellation email is its own job, written in the same transaction as their refund. A Background Jobs screen (`job:view`) shows progress and failures; `job:manage` sends a failed job round again (§14.1) | Mass refunds are the first work too big to trust to one request |
| **9. Hardening & learning goals** | Structured logging, unit tests with coverage, CI, partitioning, caching, eager/lazy tuning, monitoring, MongoDB Atlas, production rollout | Best done against a complete system |

Responsive layout and audit logging are **cross-cutting** — applied within every phase,
not deferred to one.

### 17.1 Reported issues, in priority order

Raised against what is already shipped. Ordered by what they cost a passenger,
not by how hard they are to fix — a visible defect in a working feature outranks
a clarity gap, and losing money outranks both.

| # | Issue | Why this priority | Where |
|---|---|---|---|
| **1** ✅ | **Station names read "undefined" in the standing dialog.** *Fixed.* Every connecting leg shows "On to undefined", and the seat's own stretch shows no stations either. Fares and capacity are correct, so this is presentation only — but it makes the feature unusable, because a passenger cannot choose a leg they cannot read. **Cause, confirmed:** `inventoryService.routeIndex` loads `RouteStop` rows without the `Station` association, so `stop.station` is undefined; `standingService.buildLeg` reads `fromStop.station?.name`. `searchService` includes `Station` explicitly, which is why the booking search is unaffected. **Fix:** include `Station` in `routeIndex`, and check every other caller that reads `stops[].station` | A shipped feature that cannot be used. Small, contained fix | 6B-i |
| **2** ✅ | **A checkout cannot be resumed.** *Fixed.* Seats are held for ten minutes, but the hold reference lives only in React state on the booking page. Navigate away, close the tab, log out, or have a payment declined after leaving the page, and the passenger has no route back to seats they still hold — they wait out the timer or buy again. `GET /holds` already returns their live checkouts, so the data exists and nothing on the server needs to change; the flow has no way in. **Fix:** surface open checkouts (a banner on Home and My Bookings, and a resume route that reopens the payment step from a hold reference), and make the booking page recover its hold from the URL rather than only from memory | Someone loses seats they have not lost, and may pay twice. Money and trust | 5B |
| **3** ✅ | **Coach class is not shown while choosing seats.** *Fixed.* Neither the auto-select proposal nor the manual seat map says whether a seat is AC Chair, Shovon Chair, a cabin or anything else — only the coach code and seat number. A passenger picking between two seats has no idea what they are picking between, and the fare differs by class. The data is already on every seat (`coachClassId`) and in the departure card's fare list; the seat views do not show it | A real gap, but a passenger is inconvenienced rather than harmed | 5B |

**All three are closed.** They were picked up before new scope in 6B-ii, since two
of the three were defects in work already called done.

What shipped for each:

1. `inventoryService.routeIndex` now eager-loads `Station`. The same omission was
   feeding `availabilityService.occupancy`'s station names, so one fix closed
   both.
2. The hold reference lives in the URL (`/dashboard/book?resume=<ref>`) from the
   moment a hold exists, and the page rebuilds its state from the hold and its
   quote on load. `GET /holds` now returns the train, both stations, the
   departure date and the seat numbers, so an `OpenCheckouts` banner on Home, My
   Bookings and the booking page's first step can name what is being held and
   count it down. A dead reference says so and clears itself.
3. `SeatStep` builds a class lookup from the departure's fare list and uses it in
   the auto-select chips, a one-line proposal summary, the manual coach
   headings, the seat tooltips and the chosen-seat line — class name and fare,
   wherever a seat is being weighed against another.

---

## 18. Decision log

| Ref | Question | Decision |
|---|---|---|
| — | Inventory per train or per departure? | **Per departure (trip)** |
| A1 | Multiple roles per user? | **Yes**, permissions union |
| A2 | Escalation guard? | **Yes** |
| A3 | Short token + refresh? | **Yes** |
| A4 | Flat or ranked roles? | **Flat** |
| B5 | Fare model | **Table, with distance-formula fallback** |
| B6 | Fare components | **Single amount** |
| B7 | Composition per day? | **Per-trip**; overnight runs need `day_offset` |
| C8 | Reserved-seat match mode | **Exact pair only** |
| C9 | Quota auto-release | **Yes**, configurable |
| C10 | Quota scope | **Per train + date range → materialised per trip** |
| D11 | Payment | **Simulated**, pluggable provider |
| D12 | Seat hold | **Yes**, configurable timeout |
| D13 | Auto-select | **Together toggle**; strict criteria, else fail |
| D14 | Passenger identity | **≤4 tickets per booking**, each with own NID/DOB |
| E15 | Demand-based refund | **Per segment; no resale, no refund** |
| E16 | Standing refund | **Not refundable while the seat is held** |
| E17 | Coach removal with sold seats | **Only via privileged cancel-with-refund** |
| E18 | Abuse enforcement | **Scored → review queue → auto-hold at high threshold** |
| W1 | Wallet top-up | **Simulated gateway** |
| W2 | Withdrawal | **Requires approval** |
| W3 | Split payment | **Allowed** |
| W4 | Refund destination | **Wallet** |
| W5 | Balance cap | **Yes**, configurable |
| X1 | Trip generation | **Automatic, rolling horizon** |
| X2 | Standing fare | **% of seated fare**, configurable |
| X3 | Standing capacity | **Per coach, per class**, enforced per segment |
| X4 | UI | **Responsive throughout, mobile-app extendable** |
| B1–B8 | All eight proposed betterments | **Accepted** |

---

## 19. Learning-goal coverage

Secondary objective — topics this build exercises naturally.

| Goal topic | Where it lands |
|---|---|
| ORM: transactions, commit/rollback | Booking — segments, tickets, wallet debit, atomically (§8) |
| ORM: complex querying | Segment availability: subqueries and grouping over station pairs (§6) |
| ORM: caching, eager/lazy loading | Hot, repetitive availability lookups |
| ORM: repository pattern, seeding, migrations | Throughout |
| SQL: partitioning | `tickets` and `seat_segment_booking` by departure date |
| Unit testing / TDD | Fare calculation, refund percentages, segment overlap, auto-select matching, wallet arithmetic — all pure functions |
| Logging (all 10 sub-topics) | Booking, payment and refund flows need structured, levelled, rotated, correlated logs |
| NoSQL | Audit log, ticket history, notifications — MongoDB already scaffolded |
| Docker, CI/CD, monitoring | Carries over from existing deployment work |
| Concurrency & isolation levels | Wallet ledger and seat-segment contention (§6.1, §8.1) |
