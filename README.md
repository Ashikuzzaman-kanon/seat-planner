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
  in full and told why.
- Seat Inventory: a station-pair availability matrix and a per-seat occupancy map
  showing who holds each seat and for which stretch; quota holds for specific
  pairs.
- Seat plans: a grid designer for coach layouts, with an approval workflow.

**For administrators**
- Roles and permissions are data: create roles, grant any of 49 permissions,
  assign several roles to a user. An escalation guard stops anyone granting
  what they do not hold.
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

## Tech stack

| Layer | |
|---|---|
| Frontend | Next.js 15 (App Router), React 18, PrimeReact 10, jsQR, jsPDF |
| Backend | Node.js 20, Express 4, Sequelize 6, express-validator, PDFKit, qrcode, Nodemailer |
| Data | MySQL 8 (everything transactional) · MongoDB (audit log; optional) |
| Auth | Short-lived JWT access tokens + rotating, revocable refresh tokens; per-request permission resolution |
| Deploy | Vercel (frontend) · Render, Docker (API) · Aiven MySQL · Docker Compose + Caddy for self-hosting |

## How it fits together

```
 Browser ──▶ Next.js (Vercel)  ── /api/* rewrite ──▶  Express API (Render)
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

Loading adds what is missing and never changes what is there. Trains whose seat
plans are known (50 of them) get coaches, running days and per-kilometre fares,
ready for departures; diagrams that name no train become draft plans. It never
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
