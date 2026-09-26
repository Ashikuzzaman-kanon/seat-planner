# 🎫 Seat Planner — Demo & Presentation Guide

> A role-based web app for designing Bangladesh Railway coach seat plans — built, containerized, and deployed live for **$0**.
> This guide is your script: **what to say**, **which file to open** (links are clickable), and a **plain-English meaning for every technical term**.

**Live app:** https://seat-planner-sable.vercel.app · **API:** https://seat-planner-api.onrender.com · **Repo:** https://github.com/Ashikuzzaman-kanon/seat-planner

---

## Table of contents
1. [Elevator pitch](#1-elevator-pitch)
2. [Architecture at a glance](#2-architecture-at-a-glance)
3. [Topic 1 — Docker & Containerization](#3-topic-1--docker--containerization)
4. [Topic 2 — Cloud Deployment & CI/CD](#4-topic-2--cloud-deployment--cicd)
5. [Topic 3 — Database, ORM & Migrations](#5-topic-3--database-orm--migrations)
6. [Topic 4 — Auth & Role-Based Access Control](#6-topic-4--auth--role-based-access-control)
7. [Topic 5 — Security & Configuration](#7-topic-5--security--configuration)
8. [Topic 6 — NoSQL with MongoDB](#8-topic-6--nosql-with-mongodb)
9. [What's coming next (roadmap)](#9-whats-coming-next-roadmap)
10. [Glossary — every technical term](#10-glossary--every-technical-term)
11. [Live-demo command cheat-sheet](#11-live-demo-command-cheat-sheet)

---

## 1. Elevator pitch

*"Seat Planner lets railway staff visually design the seat layout of a train coach — where each seat, window, charging port and aisle is — with a review-and-approve workflow. Planners create plans, admins approve them, and normal users view approved ones. I built the full stack, containerized it with Docker, and deployed it to the cloud for free."*

**Roles (permission hierarchy):** `user` → `planner` → `admin` → `super_admin`
- **user** — view approved plans
- **planner** — create/edit/delete plans (go to *pending* for approval)
- **admin** — all the above + approve/reject
- **super_admin** — all the above + manage user roles

📂 The whole permission model lives in one file: [backend/src/constants/roles.js](backend/src/constants/roles.js)

---

## 2. Architecture at a glance

```
Browser
  └─▶ Vercel  (Next.js frontend)         ← the website
         │  /api/* proxied to ▼
         └─▶ Render  (Express API in Docker)   ← the backend/business logic
                │  TLS ▼
                └─▶ Aiven  (managed MySQL)      ← the database
```

Locally, the same app runs as **4 Docker containers** via one file: [docker-compose.yml](docker-compose.yml)

> **Frontend** = the part the user sees (pages, buttons). **Backend** = the server that holds the logic and talks to the database. **Database** = where data is permanently stored.

---

## 3. Topic 1 — Docker & Containerization

**One-line pitch:** *"Every part of the app is packaged into containers so it runs identically on my laptop and in the cloud."*

### 🔑 Terms (explain these as you go)
- **Container** — a lightweight, isolated box that holds an app plus everything it needs to run. Like a shipping container: same box works on any ship (machine).
- **Image** — the *blueprint* a container is created from (a class); the container is the running instance (the object).
- **Dockerfile** — a recipe that tells Docker how to build an image, step by step.
- **Docker Compose** — a tool to define and run *multiple* containers together from one YAML file.
- **Volume** — storage that lives *outside* the container so data survives restarts (databases need this).
- **Multi-stage build** — building in one big "builder" image, then copying only the finished result into a tiny final image → smaller, faster deploys.

### 📂 Files to open while presenting
| File | What to point out |
|---|---|
| [backend/Dockerfile](backend/Dockerfile) | A **single-stage** recipe. Note: copying `package*.json` first (**layer caching**), `npm ci --omit=dev` (no dev tools in production), and `USER node` (runs as a **non-root** user for security). |
| [frontend/Dockerfile](frontend/Dockerfile) | A **multi-stage** build — `builder` compiles the site, `runner` keeps only the output. Explains why the final image is small. |
| [docker-compose.yml](docker-compose.yml) | 4 services (**db, backend, frontend, caddy**). Point out **volumes** (data persists), **healthcheck** (backend waits for the DB), and **service-name networking** (backend reaches the DB at host `db`). |
| [backend/.dockerignore](backend/.dockerignore) | Files kept *out* of the image — secrets (`.env`) and host `node_modules`. |
| [Caddyfile](Caddyfile) | The **reverse proxy** config: routes `/api/*` to the backend, everything else to the frontend. |

### 🖥️ Live demo (run in a terminal)
```bash
docker compose up -d          # start the whole stack
docker compose ps             # show running containers
docker images                 # show built images + sizes
docker compose logs backend   # view a container's logs
# open http://localhost
```

---

## 4. Topic 2 — Cloud Deployment & CI/CD

**One-line pitch:** *"It's live on the internet on a completely free stack, and every time I push code to GitHub it redeploys automatically."*

### 🔑 Terms
- **Cloud deployment** — running the app on someone else's servers (Vercel/Render/Aiven) instead of your own machine.
- **CI/CD** — *Continuous Integration / Continuous Deployment*: code changes are automatically built and shipped. Here: `git push` → auto-deploy.
- **Managed database** — a database someone else hosts, backs up, and maintains for you (Aiven).
- **Reverse proxy** — a "traffic director" in front of your services that routes each request to the right one and handles HTTPS.
- **Cold start** — a free server "sleeps" when idle; the first request after waking is slow (~50s), then fast.
- **Same-origin / proxy** — the browser only talks to the Vercel domain; Vercel quietly forwards `/api` calls to the backend, so there are no cross-site (**CORS**) problems.

### 📂 Files & dashboards to show
| Where | What to point out |
|---|---|
| **https://seat-planner-sable.vercel.app** | The live site. Log in, click around. |
| [frontend/next.config.mjs](frontend/next.config.mjs) | The **rewrite** rule that proxies `/api` → the backend (keeps everything same-origin). |
| **Render dashboard** | The backend service, its logs, and the env variables. |
| **Vercel dashboard** | The frontend deployments list — show auto-deploy on push. |
| **Aiven dashboard** | The managed MySQL database. |

### 🖥️ Live demo
```bash
# make a tiny change, then:
git add -A && git commit -m "demo tweak" && git push
# → watch Vercel AND Render start building automatically
```

---

## 5. Topic 3 — Database, ORM & Migrations

**One-line pitch:** *"I use an ORM so I write JavaScript instead of raw SQL, and migrations so database changes are versioned and safe."*

### 🔑 Terms
- **Database** — permanent structured storage (tables of rows), here **MySQL**.
- **ORM** (*Object-Relational Mapping*) — a library that lets you work with database rows as normal code objects instead of writing SQL by hand. Here: **Sequelize**.
- **Model** — a code class that maps to one database table (e.g. `User` ↔ `users` table).
- **Migration** — a versioned, ordered script that changes the database schema (add a table/column). Runs once, tracked, reversible → safe to apply to production.
- **Seeder** — a script that inserts starter/test data (e.g. an admin account).
- **Foreign key** — a column that references another table's row, enforcing relationships (a plan's `created_by` points to a real user).
- **Association** — how the ORM links models together (a `SeatPlan` *belongs to* a `TrainName`).
- **Eager loading** — fetching a row *and* its related rows in one query (plan + its train name + author together).
- **JSON column** — a database column that stores a whole flexible JSON document (the seat grid) — relational DB + document flexibility in one.
- **Connection pool** — a set of reusable open database connections, so we don't reconnect on every request.

### 📂 Files to open
| File | What to point out |
|---|---|
| [backend/src/models/SeatPlan.js](backend/src/models/SeatPlan.js) | A **model** with **associations** (`belongsTo` TrainName/CoachType/User), an **enum** status, and the **JSON column** `layout`. |
| [backend/src/models/User.js](backend/src/models/User.js) | Password is stored **hashed** (never plain); `toPublicJSON()` hides secrets. |
| [backend/migrations/20260101000000-init-schema.js](backend/migrations/20260101000000-init-schema.js) | The **migration** that builds all tables + **foreign keys**, in dependency order. |
| [backend/src/services/seatPlanService.js](backend/src/services/seatPlanService.js) | Real queries: `include` = **eager loading**, `Op.or` = complex filtering, role-based visibility. |
| [backend/src/seeders/createTestUsers.js](backend/src/seeders/createTestUsers.js) | **Data seeding** — 2 test users per role. |
| [backend/src/config/database.js](backend/src/config/database.js) | The DB connection: **connection pool** and **TLS/SSL** for the managed DB. |

### 🖥️ Live demo
```bash
cd backend
npm run migrate:status     # show which migrations are applied
npm run seed:testusers     # insert test users
npm run dev                # watch the console print the generated SQL
```
> Point at the console lines `Executing (default): SELECT …` — *"that's the ORM writing SQL for me from my JavaScript."*

---

## 6. Topic 4 — Auth & Role-Based Access Control

**One-line pitch:** *"Users register with email verification, log in with a token, and every action is checked against their role's permissions."*

### 🔑 Terms
- **Authentication** — proving *who you are* (login).
- **Authorization** — deciding *what you're allowed to do* (permissions).
- **RBAC** (*Role-Based Access Control*) — permissions are granted to roles, and roles to users.
- **JWT** (*JSON Web Token*) — a signed token the server gives you at login; you send it with each request to prove you're logged in.
- **Bcrypt / hashing** — a one-way scramble of passwords so even we can't read them.
- **Middleware** — code that runs *before* a route handler, e.g. to check the token or permission.
- **OTP** (*One-Time Password*) — the 6-digit code emailed to verify your address.
- **SMTP** — the protocol used to send emails (via Gmail here).

### 📂 Files to open
| File | What to point out |
|---|---|
| [backend/src/constants/roles.js](backend/src/constants/roles.js) | **Single source of truth**: roles, permissions, and which role gets which permission. |
| [backend/src/middleware/auth.js](backend/src/middleware/auth.js) | **Authentication** — reads the **JWT**, loads the user, blocks invalid tokens. |
| [backend/src/middleware/authorize.js](backend/src/middleware/authorize.js) | **Authorization** — `requirePermission()` guards each route. |
| [backend/src/services/authService.js](backend/src/services/authService.js) | Register / verify / login / reset flow; passwords **hashed** with bcrypt. |
| [backend/src/services/emailService.js](backend/src/services/emailService.js) | Sends the **OTP** email via **SMTP**. |

### 🖥️ Live demo
Log in on the site as different roles (all pre-verified) and show the menu/permissions change:
| Role | Email | Password |
|---|---|---|
| user | `user1@example.com` | `User123!` |
| planner | `planner1@example.com` | `Planner123!` |
| admin | `admin1@example.com` | `Admin123!` |
| super_admin | `superadmin1@example.com` | `SuperAdmin123!` |

Flow to show: **planner1** creates a plan → it's *pending* → **admin1** approves → **user1** can now see it.

---

## 7. Topic 5 — Security & Configuration

**One-line pitch:** *"Secrets stay out of the code, traffic is encrypted, and I patch known vulnerabilities."*

### 🔑 Terms
- **Environment variable** — a config value (like a password) supplied at runtime, kept *out* of the code.
- **Secret** — sensitive config (DB password, JWT key, email password) — never committed to git.
- **TLS / HTTPS** — encryption so data in transit can't be read by others (the padlock in the browser).
- **CORS** (*Cross-Origin Resource Sharing*) — browser rules about which sites may call your API; our proxy design avoids the problem.
- **CVE** — a publicly catalogued security vulnerability; we upgraded Next.js to patch one.

### 📂 Files to open
| File | What to point out |
|---|---|
| [backend/.env.example](backend/.env.example) | The *template* of needed config — real values live in a git-ignored `.env`. |
| [.gitignore](.gitignore) | Line for `.env` — proof secrets aren't committed. |
| [backend/src/app.js](backend/src/app.js) | **CORS** setup (an allow-list of trusted origins). |
| [backend/src/config/env.js](backend/src/config/env.js) | Central config loader — one place reads all **environment variables**. |

---

## 8. Topic 6 — NoSQL with MongoDB

**One-line pitch:** *"Alongside MySQL, I added MongoDB — a different KIND of database — for data that's better stored as flexible documents than as rigid table rows. Using the right database for each job is called polyglot persistence."*

### 🔑 Terms
- **SQL vs NoSQL** — SQL databases (MySQL) store fixed tables of rows/columns with strict relationships. **NoSQL** relaxes that; here MongoDB stores flexible **documents**.
- **Document store** — a NoSQL database that stores JSON-like **documents** grouped into **collections** (the NoSQL equivalent of a table's rows).
- **MongoDB** — the document database we added.
- **Mongoose** — the library (an **ODM**) we use to talk to MongoDB from Node — the document-DB counterpart to Sequelize.
- **ODM** (*Object-Document Mapper*) — like an ORM, but for document databases.
- **Polyglot persistence** — deliberately using more than one *type* of database, each for what it's best at (MySQL for relationships, MongoDB for event/history documents).
- **Graceful degradation** — if MongoDB is down, the app keeps running and only the document features switch off — it never crashes the core app.

### 📂 Files to open
| File | What to point out |
|---|---|
| [backend/src/config/mongo.js](backend/src/config/mongo.js) | The Mongo connection — note it's **non-fatal** (**graceful degradation**): a `try/catch` that logs and continues if Mongo is unavailable. |
| [docker-compose.yml](docker-compose.yml) | The new **`mongo`** service (a MongoDB container) with its own **volume**, plus `MONGO_URI` handed to the backend — the stack now runs **two databases** side by side. |
| [backend/src/server.js](backend/src/server.js) | Startup connects MySQL *and* MongoDB. |

### 🖥️ Live demo
```bash
docker compose up -d
docker compose logs backend | grep -i mongo
# → "✅ MongoDB connection established"   (MySQL + MongoDB both connected)
```

> **What it powers (built on this foundation):** an **audit/activity log**, **plan version history**, and **notifications** — all stored as MongoDB documents (added in the sections below as we build them).

---

## 9. What's coming next (roadmap)

These additions turn the project into an even broader demo (and cover more learning goals):

| Next step | Adds | New terms to learn |
|---|---|---|
| **NoSQL — MongoDB** | Audit log, plan version history, notifications | **NoSQL**, **document store**, **polyglot persistence** |
| **Redis** (optional) | Caching + rate-limiting | **key-value store**, **cache**, **TTL** |
| **Structured logging** | Winston logs with levels + rotation | **log levels**, **structured logging** |
| **Unit tests + CI** | Jest tests, coverage, GitHub Actions | **unit test**, **code coverage**, **pipeline** |

> **NoSQL** = a database that doesn't use fixed tables/rows. **Document store** (MongoDB) = stores flexible JSON-like documents — perfect for event logs and history. **Polyglot persistence** = using the right *kind* of database for each job (SQL for relationships, NoSQL for documents/cache).

---

## 10. Glossary — every technical term

| Term | Plain-English meaning |
|---|---|
| **Frontend** | The part of the app the user sees and clicks (the website). |
| **Backend** | The server that holds the logic and talks to the database. |
| **API** | The set of URLs the frontend calls to get/save data. |
| **Container** | An isolated box holding an app + everything it needs; runs the same anywhere. |
| **Image** | The blueprint a container is built from. |
| **Docker** | The tool that builds and runs containers. |
| **Docker Engine** | The background service that actually runs containers. |
| **Dockerfile** | Step-by-step recipe to build an image. |
| **Docker Compose** | Runs multiple containers together from one YAML file. |
| **Multi-stage build** | Build in a big image, ship only the small result. |
| **Layer caching** | Docker reuses unchanged build steps to rebuild faster. |
| **Volume** | Storage that outlives the container (for databases). |
| **Reverse proxy** | Traffic director in front of services; also does HTTPS. |
| **Caddy** | The reverse proxy we use; gives automatic HTTPS. |
| **Healthcheck** | A test that reports whether a container is ready. |
| **ORM** | Library to use the database via code objects instead of SQL. |
| **Sequelize** | The specific ORM we use (for MySQL). |
| **Model** | A class mapped to a database table. |
| **Migration** | Versioned script that changes the DB schema safely. |
| **Seeder** | Script that inserts starter/test data. |
| **Foreign key** | A column linking one table's row to another's. |
| **Association** | How the ORM connects two models. |
| **Eager loading** | Fetch a row and its related rows in one query. |
| **Lazy loading** | Fetch related rows later, only when needed. |
| **JSON column** | A DB column storing a whole flexible JSON document. |
| **Connection pool** | Reusable open DB connections for speed. |
| **Authentication** | Proving who you are (login). |
| **Authorization** | Deciding what you can do (permissions). |
| **RBAC** | Permissions grouped into roles, roles given to users. |
| **JWT** | A signed login token sent with each request. |
| **Bcrypt / hashing** | One-way password scramble; can't be reversed. |
| **Middleware** | Code that runs before a route (e.g. auth check). |
| **OTP** | One-time 6-digit verification code. |
| **SMTP** | The protocol for sending email. |
| **Environment variable** | Runtime config kept out of the code. |
| **Secret** | Sensitive config never committed to git. |
| **TLS / HTTPS / SSL** | Encryption of data in transit (the browser padlock). |
| **CORS** | Browser rules on which sites may call your API. |
| **Cold start** | Slow first request after a free server wakes from idle. |
| **CI/CD** | Automatic build + deploy on code push. |
| **Managed database** | A database hosted and maintained by a provider. |
| **Cloud deployment** | Running the app on a provider's servers. |
| **NoSQL** | A database without fixed tables (e.g. documents, key-value). |
| **Document store** | NoSQL DB storing flexible JSON-like documents (MongoDB). |
| **Polyglot persistence** | Using different database types for different jobs. |
| **MongoDB** | The NoSQL document database added alongside MySQL. |
| **Mongoose** | The library (ODM) used to talk to MongoDB from Node. |
| **ODM** | Object-Document Mapper — like an ORM, but for document databases. |
| **Collection** | A group of documents in MongoDB (like a table in SQL). |
| **Document** | One JSON-like record in MongoDB (like a row in SQL). |
| **Graceful degradation** | If an optional part (Mongo) is down, the app keeps running with that feature off. |

---

## 11. Live-demo command cheat-sheet

```bash
# ---- Local Docker demo ----
docker compose up -d            # start db + backend + frontend + caddy
docker compose ps               # what's running
docker images                   # images and their sizes
docker compose logs -f backend  # follow backend logs
docker compose down             # stop everything (keeps data)

# ---- Database / ORM demo (in backend/) ----
cd backend
npm run migrate:status          # applied migrations
npm run seed:testusers          # insert 2 users per role
npm run dev                     # run backend, watch generated SQL

# ---- CI/CD demo ----
git add -A && git commit -m "demo" && git push   # triggers auto-deploy on Vercel + Render
```

> **Tip for the demo:** keep the **live site**, the **Vercel dashboard**, the **Render logs**, and this file open in tabs. Talk through the architecture diagram first, then open the linked files as you hit each topic.
