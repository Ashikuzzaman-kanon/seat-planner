# Best practices for application deployment

Goal: **App Deployment (Intermediate)**, sub-goal *Best Practices for Application Deployment* (0%).

This page ties the other study pages together into one checklist. Each practice links to where it is
explained in more depth.

---

### In one sentence

Deploy small changes often, through an automated pipeline that tests them, from an artifact built once,
configured by the environment, with health checks, monitoring and a rollback ready, so that releasing is
routine instead of risky.

### Why it matters

Teams that deploy rarely and by hand have big, scary releases: many changes at once, each one a possible
cause when something breaks, and a manual process that differs every time. The practices below make each
deploy small, repeatable and reversible. Then deploying more often makes things *safer*, not riskier.

### Key ideas

**The Twelve-Factor App** is the classic checklist for apps that deploy well (12factor.net). The factors
that matter most day to day:

| # | Factor | In plain words |
|---|---|---|
| I | Codebase | One repository, many deploys (dev, staging, production) of the same code |
| II | Dependencies | Declared and locked (`package.json` + `package-lock.json`), never assumed to be on the machine |
| III | Config | Anything that differs between environments (addresses, passwords) comes from **environment variables**, not code |
| IV | Backing services | The database, mail and storage are attached by address; swapping one is a config change |
| V | Build, release, run | Build an artifact, combine it with config to make a release, run it. Never patch a running server |
| VI | Processes | The app keeps no important state in memory or on local disk; anything lasting goes to a database |
| IX | Disposability | Starts fast, stops cleanly on SIGTERM, so it can be moved or restarted any time |
| X | Dev/prod parity | Development, staging and production as similar as possible: same database engine and versions |
| XI | Logs | Write to stdout; the platform collects them |
| XII | Admin processes | One-off tasks (migrations, scripts) run from the same code and config as the app |

**Beyond the twelve factors:**

- **Everything through a pipeline (CI/CD).** Every change is built and tested automatically; nothing
  reaches production without passing. People review, machines check.
- **Build once, deploy many.** The exact artifact that passed the tests is the one promoted to staging and
  production. Rebuilding per environment means production runs something never tested.
- **Small, frequent releases.** Small changes are easy to review, test, understand and undo.
- **Zero-downtime deploys.** Start the new version, wait for its health check, move traffic, then stop the
  old one gracefully. Database changes are backward-compatible (expand, then contract).
- **Observability from day one.** Health checks, logs, metrics and alerts
  ([Monitoring and logging](deployment-monitoring-logging.md)).
- **Rollback ready.** Versioned releases, feature flags, backups that have been restored once
  ([Rollback and DR](deployment-rollback-dr.md)).
- **Security built in.** Secrets out of code, least privilege, scanning in the pipeline
  ([Security](deployment-security.md)).
- **Infrastructure as code.** Servers, networks and settings described in files and reviewed like code.
- **Separate environments.** At least a staging environment with its own data that mirrors production.
- **Written down.** How to deploy, which variables exist, what to do when it breaks.

### Try it yourself

**1. Run this project the way production runs it**, the whole stack in containers (from the
[README](../../README.md#everything-in-docker)):

```powershell
cd D:\Projects\seat-planner
docker compose config --quiet          # checks the compose file; warns about any variable not set in .env
docker compose up -d --build           # MySQL, MongoDB, API, web app and Caddy; open http://localhost
docker compose ps                      # all running; db shows (healthy)
docker compose logs backend --tail 20  # migrations applied, then "API listening"
docker compose down                    # stop it (no -v: the data volumes are kept)
```

Compose reads the variables from a `.env` file next to `docker-compose.yml`; the README shows how to make
it from `backend/.env.example`. Port 80 must be free.

**2. Audit this project against the checklist below**, and pick the one gap you would close first. This
is the kind of judgement the demo is really about.

### In this project

| Practice | Here | Where |
|---|---|---|
| Every change through a pull request and CI | ✅ Backend tests against real MySQL 8 and MongoDB 7 service containers with coverage; frontend unit tests and a production build. Runs on every PR and push; a newer push cancels the older run | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) |
| Small, frequent releases | ✅ 27 pull requests merged in the month from 2 October to 1 November 2026 | Git history |
| Dependencies locked | ✅ `npm ci` in CI and in the images | Dockerfiles, `ci.yml` |
| Config from the environment | ✅ Every setting is an environment variable, listed with its purpose in the README | [`README.md`](../../README.md), [`backend/src/config/env.js`](../../backend/src/config/env.js) |
| Backing services attached by address | ✅ `DB_HOST`, `MONGO_URI`; local Docker, Aiven or Atlas without code changes | [`backend/src/config/database.js`](../../backend/src/config/database.js) |
| Disposability | ✅ Graceful SIGTERM shutdown; durable jobs survive a killed process | [`backend/src/server.js`](../../backend/src/server.js) |
| Logs to stdout | ✅ Collected by Render and Vercel | |
| Dev/prod parity | 🟡 Compose runs the same engines (MySQL 8, MongoDB 7) as production; but Vercel previews use the **production** API and data | [`docker-compose.yml`](../../docker-compose.yml) |
| Migrations | 🟡 Versioned, with `down` steps, applied automatically on start. Simple, but with several API instances they would race; a separate release step is the safer pattern. 8 of 39 migrations remove or change things in one step instead of expand/contract | `backend/migrations/` |
| Build once, deploy many | ❌ Render rebuilds from source; CI's tested build is not the one deployed | Fix: push an image to a registry ([Custom registries](docker-advanced.md#custom-registries)) |
| Health checks | 🟡 `/api/v1/health` exists but does not check the database | [`backend/src/routes/index.js`](../../backend/src/routes/index.js) |
| Monitoring and alerts | ❌ No uptime check, error tracking or alerts | [Monitoring and logging](deployment-monitoring-logging.md) |
| Rollback | ✅ Vercel and Render keep earlier deploys; feature switches turn tabs off without a deploy | [Rollback and DR](deployment-rollback-dr.md) |
| Backups and DR | ❌ No backups of our own, no restore drill | [Rollback and DR](deployment-rollback-dr.md) |
| Security in the pipeline | 🟡 Secrets kept out of Git and images; no dependency or image scan yet | [Security](deployment-security.md) |
| Infrastructure as code | 🟡 Compose and Dockerfiles are code; the Render and Vercel settings live only in their dashboards | |
| Versioned releases | ✅ for Android: a tag `android-v*` builds and publishes a signed release | [`.github/workflows/android.yml`](../../.github/workflows/android.yml) |
| Documentation | ✅ README covers setup, every variable, deployment and email set-up | [`README.md`](../../README.md) |

**If I could close only three gaps**, in order:

1. **Backups**, with one timed restore. Everything else can be redone; lost data cannot.
2. **An uptime check plus a database-aware health check**, so we hear about outages before users do.
3. **A staging API with its own database for Vercel previews**, so testing never touches real data.

### At larger scale

- **GitOps**: the desired state of every environment lives in Git; a tool (Argo CD, Flux) makes the
  cluster match it. Deploying is merging a pull request.
- **Progressive delivery**: canary releases with automatic rollback on bad metrics.
- **Platform teams** provide a paved road: a standard pipeline, base images, dashboards and alerts that
  every service gets by default.
- **DORA metrics** to measure delivery: deployment frequency, lead time for changes, change failure rate,
  and time to restore service.
- **Change management**: approvals for risky changes, deploy freezes around peak periods, and a written
  review after every incident.

### Common mistakes

- **Manual, undocumented deploys** that only one person knows how to do.
- **"Works on staging"** when staging differs from production in versions, data or settings.
- **Big-bang releases** after weeks of work.
- **Rebuilding for each environment**, so production runs an untested build.
- **Skipping tests to ship faster**, then spending longer fixing production.
- **Secrets in code** or copied between people over chat.
- **No way back**: destructive migrations, no kept versions, no backups.
- **Deploying on Friday evening** with nobody watching afterwards.

### Explain it in two minutes

> "The idea behind deployment best practices is to make releasing boring: small changes, through an
> automated pipeline, an artifact built once, configuration from the environment, health checks and
> monitoring, and a way back.
>
> This project does most of the pipeline side well. Every pull request runs the backend tests against real
> MySQL and MongoDB containers and builds the web app; we merged 27 pull requests in one month, all small
> and reviewed. Configuration is all environment variables, documented in the README; the API shuts down
> gracefully; Vercel and Render keep earlier deploys; and feature switches can turn a tab off without a deploy.
>
> Where it falls short, and what I would fix first: we have no backups of our own, nobody is alerted when
> the site is down, preview deployments share production data, and the image we test is not the image we
> deploy. Each of these has a small, well-known fix."

### Questions you may be asked

- **What is the twelve-factor app?** A set of twelve principles for apps that run well on modern platforms:
  config in the environment, stateless processes, logs to stdout, fast start and graceful stop, dev/prod
  parity, and so on.
- **Why "build once, deploy many"?** So the artifact that passed testing is exactly what runs in
  production. A rebuild can pull a different dependency or base image.
- **How do you deploy without downtime?** Run the new version beside the old, send traffic once its
  readiness check passes, drain and stop the old one; keep schema changes backward-compatible.
- **Should migrations run when the app starts?** Fine for one instance and simple setups, as here. With
  several instances, run them once as a separate release step before the new code takes traffic.
- **How do you measure whether deployment is going well?** The DORA metrics: how often you deploy, how long
  a change takes to reach production, what share of deploys cause a failure, and how fast you recover.
- **What is the first thing you check before deploying?** That CI is green on exactly what will be
  deployed, and that you know how to roll it back.
