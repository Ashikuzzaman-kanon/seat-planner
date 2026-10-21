# Seat Planner — Railway Ticketing

A complete railway ticketing system: design coach seat plans, run departures,
sell seats **stretch by stretch**, check tickets on the train (even without
signal), handle returns and disruptions, and administer all of it with roles
defined as data.

**Live:** https://seat-planner-sable.vercel.app · API https://seat-planner-api.onrender.com/api/v1/health

> The API runs on a free tier that sleeps after 15 minutes idle, so the first
> request after a quiet spell can take ~50 seconds.

---

## What it does

**For passengers**
- Search trains between any two stations; a seat is sold only for the stretch
  you travel, so a train "full end to end" often still has room on yours — and
  a *Where is there room?* view shows exactly where.
- Choose seats on a drawn coach map or let the system pick (window, charging
  port, fan, seated together), hold them for a timed checkout, pay by wallet,
  simulated card/mobile banking, or a split of both.
- Signed QR tickets, PDF, and a confirmation email. Resume an unfinished
  checkout from any device.
- Return a ticket under two policies (*convenient*: refunded now less a
  time-based deduction; *demand*: refunded segment by segment as the seat
  resells), transfer it to another passenger (approved by staff), or extend the
  journey with a connecting standing ticket.
- Join a waitlist for a sold-out stretch; a freed seat is offered in one click.

**For everyone**
- **Notifications**: a bell with the unread count, a panel of the newest, and a
  full inbox filtered by kind. Bookings, returns paying out, a cancelled train,
  a seat offered from the waitlist, a request decided, a change of roles — and,
  for staff, a plan or request waiting on them and background jobs finishing or
  failing. Kept in the app whether or not the email arrived; checked every 30
  seconds while the tab is open, with a toast when something new comes in.
- **Android app**: the site full screen, with the back button, pull to refresh,
  the camera for checking tickets and the tickets PDF in the phone's viewer. It
  loads every page from the live site, so a web deploy needs no app update. See
  *The Android app*.
- **Subscriptions**: ask for a subscription, saying on how many devices, and a
  reviewer approves it for a period and a number of devices they choose, or
  declines it. It runs through the end of its last day and then ends by itself;
  the subscriber can cancel it at any time, and so can a reviewer. A caller
  outside the app can ask whether an account holds one on the device it is
  running on — see *Subscriptions and the check API*.
- **Profiles**: a person's name, wherever the dashboard shows it, opens their
  profile. Everyone sees the name and roles; the person themself, and staff
  who can view users, also see the email, date of birth, the last four of the
  national ID, when they joined and last signed in, and anything stopping them.

**For staff on the train**
- *Check Tickets*: scan a QR with the phone camera or type the number; eight
  distinct verdicts; scanning can admit the passenger or only read the ticket.
- An offline manifest for checking with no network, synced idempotently later.
- Report a suspicious ticket; reports feed a review queue and an account score.

**For operators**
- Network: stations, trains, routes with day offsets, fare rule chains, seat
  attributes.
- Departures: weekly schedules generate a rolling horizon of departures; per
  departure, add / remove / cancel / reinstate coaches, switch return policies
  and standing sales, and cancel a whole departure — everyone aboard is refunded
  in full and told why. Once a train is 90 days gone (a setting), the seats
  nobody bought are cleared daily to keep the database small; every seat with a
  ticket or a return, and every booking, payment and refund, is kept.
- Seat Inventory: a station-pair availability matrix and a per-seat occupancy map
  showing who holds each seat and for which stretch; quota holds for specific
  pairs.
- Seat plans: a grid designer for coach layouts, with an approval workflow.
  A train has one plan per coach, numbered with the railway's coach letter
  (KA, KHA, GA…), and classes carry the railway's codes (S_CHAIR, SNIGDHA,
  AC_B…). An approved plan is changed through an editable copy: the plan
  keeps being used until the copy is approved, then takes its changes under
  its own id. Departures already generated keep their seats.

**For administrators**
- Roles and permissions are data: create roles, grant any of 54 permissions,
  assign several roles to a user. An escalation guard stops anyone granting
  what they do not hold.
- **Restricting an account** (`user:restrict`): from its profile, or several at
  once from *Users*, with a reason. It is signed out everywhere at once and
  cannot sign in or pass the subscription check until someone lifts it; every
  restriction and lift is kept with who did it and why. Nobody restricts their
  own account or a super admin's, and an account holding a permission you lack
  can only be restricted by someone who holds it too.
- Sign-in pauses for an account after five wrong passwords in a row (both
  numbers are settings), so a password cannot be guessed at speed. Resetting
  the password ends the pause; anyone already signed in stays signed in.
- A settings store for every tunable rule (timeouts, deductions, abuse weights,
  job retries) — changes take effect without a restart.
- An audit log of every privileged action.
- **Background Jobs**: long-running work (a cancelled departure's mass refund,
  the email to each passenger) runs as durable jobs that survive a restart,
  retry with backoff, and wait here for a person if they give up.
- **Demo Data** (super admin): one button fills an empty system with demo
  accounts for every role, seat plans, a network, two trains with departures
  and sample bookings; another removes exactly that again. Existing data is
  adopted and never changed, and the delete refuses while anyone outside the
  demo holds a valid ticket on a demo departure.
- **Railway Data** (super admin): loads Bangladesh Railway's 149 trains, their
  stations and routes, and the seat plans transcribed from coach diagrams, and
  makes the 50 trains with plans ready for departures. See *The real railway*.

## Tech stack

| Layer | |
|---|---|
| Frontend | Next.js 15 (App Router), React 18, PrimeReact 10, jsQR, jsPDF |
| Backend | Node.js 20, Express 4, Sequelize 6, express-validator, PDFKit, qrcode, Nodemailer |
| Data | MySQL 8 (everything transactional) · MongoDB (audit log; optional) |
| Auth | Short-lived JWT access tokens + rotating, revocable refresh tokens; per-request permission resolution |
| Android | Kotlin, a WebView over the live site; an APK installed directly, released from GitHub |
| Deploy | Vercel (frontend) · Render, Docker (API) · Aiven MySQL · Docker Compose + Caddy for self-hosting |

## How it fits together

```
 Browser or
 Android app ──▶ Next.js (Vercel)  ── /api/* rewrite ──▶  Express API (Render)
                                                        │
                                   MySQL (Aiven) ◀──────┤  transactions, jobs table
                                   MongoDB (optional) ◀─┘  audit log
                                                        │
                                   in-process workers:  recurring sweeps (horizon,
                                                        expired holds, waitlist offers)
                                                        + durable job worker
```

The browser only ever talks to the frontend's origin; Next.js proxies `/api/*`
to the API, so there is no CORS in production.

Some design points worth knowing:

- **Segment inventory.** A seat is booked per segment between consecutive stops.
  Availability for A→D means every segment in between is free on the same seat.
- **Money is integers** (poisha) end to end, with an append-only wallet ledger
  that can be re-added and verified against the balance.
- **Durable jobs.** A cancellation marks the departure cancelled and queues its
  refund job in one transaction; a worker claims jobs under a renewable lease
  (no database locks held during the work), processes refunds in resumable
  batches, and each passenger's email is itself a job written with their refund.
- **Permissions in code, roles in data.** Every endpoint declares the permission
  it needs; the catalogue is synced to the database on boot.

The full specification, decision log and per-phase build notes are in
[REQUIREMENTS.md](REQUIREMENTS.md). The API contract is served at
`/api/v1/openapi.json`.

## Repository layout

```
seat-planner/
├── backend/            Express API
│   ├── migrations/     Sequelize migrations (run automatically on container start)
│   ├── src/
│   │   ├── constants/  permission catalogue, settings catalogue, audit actions
│   │   ├── docs/       OpenAPI document
│   │   ├── jobs/       recurring sweeps + durable job handlers
│   │   ├── models/     Sequelize models (+ mongo/ for the audit log)
│   │   ├── routes/ controllers/ services/ validators/ middleware/
│   │   ├── seeders/    super admin, test users, network, seat plans, departures
│   │   └── utils/      pure logic: availability, auto-select, refund policy, money…
│   └── tests/          unit tests (node:test)
├── frontend/           Next.js app
│   └── src/
│       ├── app/        routes: auth pages, /dashboard/*
│       ├── components/ booking, checking, departures, inventory, network, ui…
│       └── lib/        API clients per area
├── android/            Android app (Kotlin): the site in a WebView — see android/README.md
├── tools/lan-https.js  HTTPS proxy for testing the camera scanner from a phone
├── docker-compose.yml  MySQL + MongoDB + API + frontend + Caddy
├── REQUIREMENTS.md     specification and build log
└── PRESENTATION.md     walkthrough of the project for presenting it
```

## Running it locally

**Prerequisites:** Node.js 20, MySQL 8. MongoDB is optional (the audit log is
skipped without it) — `docker compose up -d mongo` starts one.

### 1. API

```bash
cd backend
cp .env.example .env            # set DB_*, JWT_SECRET, SUPER_ADMIN_*; SMTP optional
npm install
npm run migrate                 # creates the schema
npm run seed:superadmin         # system roles + your super admin account
npm run seed:seatplans          # coach layouts (imported as pending review)
npm run seed:network            # stations, trains, routes, fares
npm run dev                     # http://localhost:4000/api/v1
```

Departures only get seats from **approved** seat plans, and imported plans
arrive pending. So before generating departures, start the frontend (below),
sign in as the super admin and approve the plans under *Approvals*. Then:

```bash
npm run seed:departures         # compositions, weekly schedules, rolling horizon
```

A departure generated before its plans were approved has no seats; use its
*Rebuild* button on *Departures* once they are.

If no email route is configured (`GMAIL_*`, `BREVO_API_KEY` or `EMAIL_HOST`),
emails (verification codes, tickets) are printed to the API console instead of
sent.

Optional: `npm run seed:testusers` / `npm run seed:unittestusers` create
accounts for trying each role.

Or skip the seeding commands after `seed:superadmin`: sign in as the super
admin and press **Populate demo data** on *Administration → Demo Data*. It
builds the same data through the app itself — seat plans already approved,
departures generated, sample bookings made — and **Delete demo data** removes
it again. This is also how to put demo data on a deployed system.

Demo accounts follow `<role><n>@example.com` / `<Role>123!` — for example
`planner1@example.com` / `Planner123!`, `checker1@example.com` /
`Checker123!`, `user1@example.com` / `User123!`. Anyone can read these
passwords here, so the button never creates a super admin.

### The real railway

Bangladesh Railway's timetable — 149 trains, their stations and routes — and
the seat plans transcribed from coach diagrams are loaded from the snapshot in
`backend/src/data/railway/`:

```bash
npm run railway:load            # or Administration → Railway Data → Load
npm run railway:fetch           # refresh the timetable snapshot from the railway (then review the diff)
```

**Keeping it current.** *Railway Data → Check with the railway* asks the
railway for every train's timetable as it is now and lists what differs here —
new trains and stations, renamed trains, moved times, changed stations,
changed running days, trains no longer published, trains it could not fetch.
Nothing changes until **Apply changes**, which compares again and then takes
new trains and stations, new names, and moved times (even on trains with
departures, keeping the distances saved, so fares stay put); it replaces
changed stations only on trains with no departures still to run, and updates
running days unless they were set by hand, listing departures already made on
a day the train no longer runs. Nothing is deleted, and coaches, seat plans
and fares are untouched. The applied timetable is the one **Load** works from
afterwards. The railway's API is not an official public one: if it stops
answering, the check says so and nothing changes. (`RAILWAY_SOURCE_URL` points
it elsewhere; the tests use a stand-in.)

Loading adds what is missing and never changes what is there. Trains whose seat
plans are known (50 of them) get coaches, running days and per-kilometre fares,
ready for departures — and each of their 226 coaches a plan of its own,
numbered with its letter, in the railway's class codes (AC_B, AC_S, SNIGDHA,
F_BERTH, F_SEAT, F_CHAIR, S_CHAIR, SHOVAN, SHULOV, AC_CHAIR). Coaches built
alike start from the same layout, and each can be changed on its own. Diagrams
that name no train become draft plans. It never
generates departures — do that on *Departures → Generate…*. It refuses while
demo data exists, since the demo's stations share names with the real ones.
Distances are estimated from running times (the timetable publishes none) and
can be corrected on each train's route; fares follow.

### 2. Frontend

```bash
cd frontend
echo "NEXT_PUBLIC_API_BASE_URL=/api" > .env.local
npm install
npm run dev                     # http://localhost:3000
```

### Scanning tickets from a phone on the same network

Browsers only allow the camera on a secure origin. Run
`node tools/lan-https.js` and open the printed `https://<your-LAN-IP>:3443`
address on the phone (accept the self-signed certificate once).

### The Android app

The app in [android/](android/README.md) is the live site full screen, so it
changes whenever the site does. To try local changes in it, open **Open on
phone** from the account menu while `npm run dev` runs (or go to
`http://localhost:3000/dev/phone`): one QR code installs the app from this
computer, the other switches it to this computer until you tap its **DEV**
strip. Holding three fingers on the app's screen for three seconds opens the
same switch by hand. Building, the signing key and releases are in
[android/README.md](android/README.md).

### Everything in Docker

```bash
cp backend/.env.example .env    # compose reads DB_*, JWT_SECRET, SUPER_ADMIN_* from it …
echo "MYSQL_ROOT_PASSWORD=change-me" >> .env   # … plus this, for the MySQL container
docker compose up --build       # http://localhost
docker compose exec backend npm run seed:superadmin
```

## Configuration

Backend environment (`backend/.env`):

| Variable | Required | Notes |
|---|---|---|
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASS` | yes | MySQL connection |
| `DB_SSL`, `DB_POOL_MAX` | managed DBs | `DB_SSL=true` for Aiven; small pools on free tiers |
| `JWT_SECRET` | yes | Signs access tokens |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | no | Default 15m / 30d |
| `TICKET_SIGNING_SECRET` | recommended | Signs ticket QR codes; falls back to `JWT_SECRET` |
| `MONGO_URI` | no | Blank disables the audit log |
| `GMAIL_CLIENT_ID` `GMAIL_CLIENT_SECRET` `GMAIL_REFRESH_TOKEN` | no | Send through the Gmail API over HTTPS, as your own Gmail — works where outbound SMTP is blocked. See *Email in production* |
| `BREVO_API_KEY` | no | Send through Brevo's HTTP API instead — also HTTPS. `EMAIL_FROM` must be a verified Brevo sender |
| `EMAIL_HOST` `EMAIL_PORT` `EMAIL_SECURE` `EMAIL_USER` `EMAIL_PASS` `EMAIL_FROM` | no | SMTP; with neither this nor Brevo, mail is logged to the console |
| `CORS_ORIGINS` | production | Comma-separated allowed origins |
| `APP_URL` | no | The web app's address, for buttons and the logo in emails. Defaults to the first `CORS_ORIGINS` entry |
| `SUPER_ADMIN_NAME` `SUPER_ADMIN_EMAIL` `SUPER_ADMIN_PASSWORD` | for seeding | Used by `npm run seed:superadmin` |

Frontend: `NEXT_PUBLIC_API_BASE_URL` (use `/api`) and, in production,
`BACKEND_ORIGIN` — where the `/api` rewrite points.

Business rules (hold timeouts, refund slabs, waitlist windows, abuse weights,
job retries…) live in the settings store and are edited on the *Settings*
screen, not in environment variables.

### Seat allocation

*Operations → Seat Allocation* shows which station pairs Bangladesh Railway
actually sets seats aside for, train by train and class by class. Four
filters — from, to, train, class — each left empty to mean all: from and to
together give the trains with seats on that journey, a train alone gives its
pairs in route order (and a grid). Only allocated pairs show unless asked.

It is the railway's own data, kept apart from the site's: its tables
(`allocation_*`) name trains, stations and classes as the railway does, as
text, and point at nothing the site books on; loading or syncing railway data,
demo data and the clean-ups never touch them. Whoever holds
`allocation:manage` fills it from three files, each shown before it is
applied: the train routes (`train-stoppages.json`, for travel order), the
census CSV from BR Ticket Helper (pairs in the file replace what is stored for
them; failed scans, and "Allocated" without the trains named, are left out
with the reason), and the counts sheet (download it, fill in seats, upload
it). A count not known is stored as empty and shown as "count not available",
never as 0. A pair can also be set by hand.

### Switching tabs off

*Settings → Features* (super admin only) turns any tab of the app off — for
everyone, or for chosen people and roles — with an optional message. The tab
leaves their menu and every shortcut to it (the Book button, the bell, the
Home page cards, the account menu); its address shows that it is unavailable,
with the message; and the API refuses the calls only that tab makes, with
`403` and `code: "FEATURE_UNAVAILABLE"`. A call another tab still needs keeps
working: switching off Network takes its stations away, but not the train list
Departures shows. Which tab each endpoint serves is listed in
`backend/src/constants/features.js`, and a test fails if a signed-in route is
left out.

A switch applies to the super admin too. Settings has no switch, so it is
always there to switch things back on. With Home off, signing in lands on the
first tab still there. The outside APIs (the subscription check and seat
plans) are never switched. Every change is in the audit log.

## Subscriptions and the check API

Three permissions run subscriptions, and a role can hold any of them (the
super admin holds every permission):

| Permission | Allows |
|---|---|
| `subscription:manage` | Create a subscription, rename it, close it to new requests, reopen it, delete one nobody has asked for. Create the platforms subscriptions are used on, rename them, switch them off |
| `subscription:approve` | See the requests, approve one for a period and a number of devices, or decline it. Change a running subscription's last day or device counts, cancel anyone's. See an account's devices and why any were turned away; note, block or remove a device |
| `subscription:versions` (*Manage apps*) | Look after each subscription's app: which versions it accepts on each platform (require a version, set the oldest accepted, block single versions), the link subscribers get it from, and notices to subscribers about a new version or one going away |

Everyone signed in sees the *Subscriptions* page and can ask for one. A
subscription is valid from approval **through the end of its last day in
Dhaka**; an hourly job then marks it ended and tells the subscriber, and warns
them a few days before (*Settings → Subscriptions*). Every request is kept, so
who decided what stays on record.

Each subscription has a **code** — made from its name when it is created, or
chosen then — which never changes, even if the subscription is renamed.

**Devices.** A subscription allows so many devices of each **platform**.
Platforms are data — `windows` and `android` to begin with, more from the
*Platforms* tab — and each is a count of its own, 0 to 10. Whoever asks says how
many of each they want; the reviewer can change those numbers when approving,
and later while the subscription runs.

Nobody registers a device. The first time one checks in (below) and a place is
free, it takes one and keeps it; places are held in the order devices arrived,
per account and platform. So a subscription allowing two Windows devices is
valid on the account's first two. Lowering a count removes no device — the
later ones simply stop being valid — and a platform created later starts at 0
on subscriptions already running, until a reviewer raises it.

A reviewer opens an account's devices from the *Subscribers* tab: what has
signed in, with a note of their own on each; **block** (never valid, and its
place passes to the next device) or **remove** (its place is free — and the
same device may take one again, so block to keep one out); and every check
that was turned away, with the reason. Subscribers see their own devices and
how many places are used, to look at only.

**App versions.** Each subscription has its own rules on the version of the
app making the check, platform by platform — so one version can be fine for
*basic* and too old for *premium*. From the *Versions* tab (pick the
subscription, or use the tag button on its card): **require** a version, set
the **oldest accepted**, and **block** single versions with a fault whatever
the minimum. A version is one to four numbers joined by dots — `2`, `1.4.2`,
`v1.4.2.17` — compared number by number, so `1.10` is newer than `1.9` and
`1.4` is `1.4.0`. The tab lists the versions the subscription's current
subscribers' devices last checked in with, so a minimum is raised knowing who
it turns away. A new subscription has no rules: any version, or none, is
accepted.

**The app's link, and notices about its versions.** On the *Versions* tab a
subscription gets an **app link** (an https address): subscribers whose
subscription is running see an **Open the app** button on its card that goes
there. Under each platform, **Send a notice** tells everyone currently
subscribed with a device on that platform that a new version is out, or that
an old one is going away — in the app at once, and by email too if the sender
ticks *Email them too* (each email a queued job, retried if the mail server
refuses). The message starts from ready-made words and can be changed. Raising
the minimum or blocking a version offers a "going away" notice ready-filled.
Every notice is listed under its platform, with who sent it and to how many.

**Checking from outside the app.** One endpoint takes an email and password,
and the device the call is made from, and says for every subscription there is
whether that account's is valid on that device now:

```bash
curl -X POST https://seat-planner-api.onrender.com/api/v1/subscriptions/check \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"...","deviceId":"458c70e0bd45dc3676dc6d83c5ccec4e","platform":"windows","version":"1.4.2"}'
```

```json
{
  "user": { "name": "Rahim Uddin", "email": "user@example.com" },
  "subscriptions": [
    { "code": "basic", "valid": true },
    { "code": "premium", "valid": false, "message": "This version is no longer supported. Please update." },
    { "code": "pro", "valid": false }
  ]
}
```

- It returns no dates. With the right password from a named device, it also
  returns a **sign-in token** for the app:

  ```json
  { "user": { … }, "subscriptions": [ … ], "token": "spa_…", "tokenExpiresAt": "2026-10-23T09:00:00.000Z" }
  ```

  The app sends it as `Authorization: Bearer <token>` in place of the email
  and password — on the check and on seat plans — so it need not keep the
  password. It lasts a week by default (*Settings → Subscriptions → App sign-in
  lasts*), is tied to the account and that device, and still needs `version`
  on each call. Signing in again from the device replaces it; a new password, a
  restriction, or staff removing or blocking the device end it early. A token
  that no longer works answers `401` "Sign in again".
- `deviceId` is the caller's own stable id for the installation — 4 to 128
  letters, digits and `. _ : -` — and `platform` is a platform's value. Send
  the same id every time: a new id is a new device. `version` is the app's
  version; the device remembers the last one it sent.
- **A subscription that does not accept the app's version says so**, on its
  own entry, so the app can show it: `"message": "A version is required"`
  when none was sent, or `"This version is no longer supported. Please
  update."` when it is older than that subscription's minimum or blocked by
  it. The other subscriptions are answered as usual. It is said only when the
  version is the one thing in the way — the account holds the subscription and
  the device has a place — so it never hints at why a device was turned away.
  The audit entry names each subscription that refused the version, and why.
- A `version` that is not numbers and dots at all is a `400` for the whole
  call, before the password is checked.
- **A device that is not let in is told only `valid: false`.** The limit
  reached, the device blocked, an unknown or switched-off platform, a missing
  or malformed `deviceId` — each is the same `200` in the same shape, with no
  reason. The reason is kept for staff: on the account's devices (*Subscribers
  → Devices → Turned away*), one row per device and reason with a count, the
  newest hundred per account for ninety days — and in the audit log.
- **Every call is in the audit log**, when the audit log is configured — a
  device's hundredth check as much as its first. A call that is answered is a
  `subscription.check` entry: the account, the `deviceId` and `platform` sent,
  which subscriptions came back valid, and when none did, why. A call refused
  at the password is `auth.login_failed`, with the same device details. A
  device taking a place adds a `subscription.device_add` entry of its own.
  That is one entry per call with nothing clearing them out, so a caller that
  checks often is what will fill the audit store first.
- **It answers from any origin** — a page on any other site may call it. The
  rest of the API stays limited to `CORS_ORIGINS`. That is safe here because
  nothing of the browser's own goes with the call: the caller sends the email
  and password itself.
- A wrong password and an unknown email are the same `401`. An email not yet
  verified, or a restricted account, is a `403`, as at sign-in — told only
  after the password is right.
- The password is checked exactly as sign-in checks it, **and shares its
  pause**: after five wrong passwords in a row the account answers `429` here
  and at sign-in for fifteen minutes, with `Retry-After` saying how long is
  left.
- **Call the API's own address, as above — not the website's.** The API sleeps
  after fifteen idle minutes. A call straight to it wakes it and is held while
  it starts, so allow up to a minute. The same path on the website's address
  also works while the API is awake, but while it sleeps that route answers a
  bare `429` (no JSON body) and does not wake it. A `429` that *does* carry a
  JSON `error` is the pause after wrong passwords.

**Seat plans for subscribers' apps.** A subscription can include seat plans
(*Includes seat plans* in its editor). An app signed in as one of its
subscribers fetches a train's plans with the same sign-in as the check, plus
the train — and, to narrow it, a class or a coach:

```bash
curl -X POST https://seat-planner-api.onrender.com/api/v1/subscriptions/seat-plans \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"...","deviceId":"458c70e0bd45dc3676dc6d83c5ccec4e","platform":"windows","version":"1.4.2","train":"EKOTA EXPRESS (705)","class":"S_CHAIR"}'
```

```json
{
  "train": { "name": "EKOTA EXPRESS (705)", "number": "705" },
  "coaches": [
    { "coach": "GA", "class": "S_CHAIR", "type": "PT Inka Red-Green (BG)", "planId": 41, "updatedAt": "2026-10-16T…", "layout": { "rows": [ … ] } },
    { "coach": "GHA", "class": "S_CHAIR", "type": "PT Inka Red-Green (BG)", "planId": 42, "updatedAt": "2026-10-16T…", "layout": { "rows": [ … ] } }
  ]
}
```

- Signed in with the app's token instead, send `Authorization: Bearer <token>`,
  `version` and `train` — no email or password.
- `train` is its name or its number (`705`). Leave out `class` and `coach`
  for every coach of the train, front to back. Only approved plans are sent;
  `updatedAt` says when a plan last changed, for caching.
- It answers only when the account holds a subscription that includes seat
  plans and is valid on this device — that subscription's device limits and
  version rules apply, and asking takes a new device's place as a check does.
- Refused, it says nothing about the device: `403`. The exception is the app's
  version, when that is the only thing in the way: `400` "A version is
  required", or `426` "This version is no longer supported. Please update."
  No such train, or no plan matching, is a `404`.
- Answers come compressed (a whole train is a few kilobytes), from any origin,
  and every call is in the audit log as `subscription.seat_plans`.

## Tests

Every push runs them on GitHub Actions (`.github/workflows/ci.yml`): the
backend's unit and integration tests with coverage, and a production build of
the frontend.

```bash
cd backend
npm test                        # unit tests — pure logic: availability, auto-select, refunds, money, tokens…
npm run test:integration        # integration suites against a fresh test database (needs MySQL)
npm run coverage                # both, measured; fails below 90% lines/functions, 70% branches
```

**Integration tests** (`backend/tests/integration/`) build their own database
— never the development one: the name must end in `_test`
(`TEST_DB_NAME`, default `seat_planner_test`). It is migrated and seeded the
way a developer sets up locally, snapshotted, and restored before every suite,
so each suite starts from the same data whatever ran before it. The API runs
inside the test runner; each suite in `suites/` talks to it over HTTP.

- `npm run test:integration -- waitlist` runs only suites whose name contains
  "waitlist"; add `--reuse` to skip rebuilding the database.
- Set `TEST_MONGO_URI` (a database ending in `_test`) to include the audit-log
  checks; without it they are skipped.
- Mail is never sent: what would have gone out is written to
  `tests/integration/.work/outbox.jsonl`.

**Emails**: `node tools/preview-emails.js` renders every email the system
sends, with sample data, to `tools/.email-previews/` — open its `index.html`
after changing a template. They share one layout, `backend/src/emails/layout.js`.

**Browser checks** (`e2e/`) drive the running web app in Chrome at laptop and
phone widths — every page, every dialog, the booking flow, demo data, waking a
sleeping server. They need the API and the web app running locally with the
development data; see [e2e/README.md](e2e/README.md).

## Deployment

The live deployment follows `master`:

- **Vercel** builds `frontend/` (framework preset Next.js) with
  `NEXT_PUBLIC_API_BASE_URL=/api` and `BACKEND_ORIGIN` set to the API URL.
  Every branch and pull request also gets a preview address. Previews call the
  same API, and use its data, so the API's `CORS_ORIGINS` names them with a
  pattern — `*` stands for one piece of a host name, never a dot:
  `https://seat-planner-sable.vercel.app,https://seat-planner-*-ashikuzzaman-kanons-projects.vercel.app`
- **Render** builds `backend/Dockerfile`. The container runs
  `npm run migrate && npm start`, so pending migrations apply on every deploy.
- **Aiven** hosts MySQL (TLS required).
- **Email** goes out over HTTPS, because Render's free web services block
  outbound SMTP (ports 25, 465 and 587). Every send gives up after 15 seconds,
  so a mail problem shows as "try again" rather than a request that never
  returns.

### Email in production (Gmail API)

Free, about 500 emails a day, sent as your own Gmail. Once:

1. [Google Cloud console](https://console.cloud.google.com) → create a project
   (no billing needed) → *APIs & Services → Library* → enable **Gmail API**.
2. *Google Auth Platform* (the OAuth consent screen): External; add the scope
   `https://www.googleapis.com/auth/gmail.send`; under *Audience* **publish the
   app** — in *Testing*, refresh tokens die after 7 days.
3. *Clients* → create an OAuth client of type **Web application** with the
   redirect URI `https://developers.google.com/oauthplayground`.
4. In the [OAuth Playground](https://developers.google.com/oauthplayground):
   ⚙ → *Use your own OAuth credentials* → paste the client ID and secret;
   authorise the scope above with the Gmail account to send from (accept the
   "unverified app" warning — it is your own app); *Exchange authorization code
   for tokens*; copy the refresh token.
5. On Render set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`
   and `EMAIL_FROM="Seat Planner <that-address@gmail.com>"`. The API logs
   `[email] sending through the Gmail API` on start.

Push to `master` and both redeploy. A database created by the first release is
upgraded in place: migration `20260101000001` converts its old single `role`
column into roles-as-data, keeping every account's permissions.
