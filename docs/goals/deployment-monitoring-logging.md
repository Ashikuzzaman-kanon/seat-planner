# Monitoring and logging

Goal: **App Deployment (Intermediate)**, sub-goal *Monitoring and Logging* (0%).

This is about **watching a deployed app**: knowing it is up, noticing when it gets slow or starts
failing, and having the records to find out why. How to read a single container's logs is on
[Docker basics](deployment-basic.md#debugging-and-logs).

---

### In one sentence

Monitoring tells you **that** something is wrong (ideally before users do), logging tells you **why**,
and alerts make sure a person finds out in time.

### Why it matters

Without monitoring, users are your monitoring: you find out the site is down when someone complains. And
without good logs, even when you know something broke, you cannot tell what, for whom, or since when. A
deployment is not finished when it is live; it is finished when you can see whether it is healthy.

### Key ideas

**The three kinds of signal** (often called the three pillars of *observability*):

| Signal | What it is | Answers | Example |
|---|---|---|---|
| **Logs** | Timestamped records of events | *What happened, exactly?* | `ERROR booking 4521 failed: seat taken` |
| **Metrics** | Numbers measured over time | *How much, how fast, how often?* | requests per second, 95th-percentile response time, memory |
| **Traces** | One request's path through every service, with timings | *Where did the time go?* | web 20 ms → API 180 ms → MySQL 150 ms |

**What to watch: the four golden signals** (from Google's SRE book):

1. **Latency**: how long requests take. Watch the slow ones (the 95th or 99th percentile), not the average.
2. **Traffic**: how many requests.
3. **Errors**: how many fail (HTTP 5xx, exceptions).
4. **Saturation**: how full the resources are: CPU, memory, database connections, disk.

**Health checks**

- **Liveness**: "is the process alive?" If not, restart it.
- **Readiness**: "can it serve requests right now?" (database reachable, start-up finished). If not, stop
  sending it traffic.
- **Uptime / synthetic checks**: an outside service calls your site every minute from the internet, as a
  user would.

**Good logs**

- **Levels**: `debug` < `info` < `warn` < `error`. Production usually keeps `info` and above.
- **Structured** (JSON) rather than free text, so a tool can filter `level=error AND userId=42`.
- **A correlation ID** on every line of one request, so you can pull out everything that request did.
- **To stdout**, collected by the platform, then **centralised** in one searchable place with a retention period.
- **No secrets or personal data** in logs.

**Alerts**

- Alert on **symptoms users feel** (errors up, site down, slow), not on every internal blip.
- Every alert should be **actionable**; alerts nobody acts on train people to ignore alerts.
- **SLI / SLO / SLA**: an *indicator* you measure (share of successful requests), the *objective* you aim
  for (99.5% per month), and the *agreement* you promise customers. The gap between 100% and the SLO is
  the **error budget**.

**Business monitoring** matters too: sign-ups per day, bookings per hour, failed payments. A healthy
server with zero bookings for three hours is still an incident.

### Try it yourself

**1. A health check and its response time** (with the API running locally on port 4000):

```powershell
curl.exe -s http://localhost:4000/api/v1/health
curl.exe -s -o NUL -w "status %{http_code}, %{time_total}s`n" http://localhost:4000/api/v1/health
```

**2. Your own uptime monitor in Docker** (Uptime Kuma, a free self-hosted tool):

```powershell
docker run -d --name kuma -p 127.0.0.1:3001:3001 louislam/uptime-kuma:1
# open http://localhost:3001, create a user, then "Add New Monitor":
#   type HTTP(s), URL http://host.docker.internal:4000/api/v1/health, interval 20 s
# stop the API for a minute and watch it go red, with the response-time chart; start it again
docker rm -f -v kuma
```

**3. Live resource numbers** (the saturation signal): `docker stats`.

**4. Filtering logs** the hard way, to see why structured logs help:

```powershell
docker logs seat-planner-mongo-1 --tail 500 2>&1 | Select-String '"s":"W"' | Select-Object -First 5   # MongoDB logs JSON; "W" = warning
```

MongoDB already writes structured JSON logs, one object per line, so finding its warnings is one filter.
Compare that with searching free text.

### In this project

**What exists**

- **A health endpoint**, `GET /api/v1/health`, returning `{ status: "ok", time }`
  ([`backend/src/routes/index.js`](../../backend/src/routes/index.js)). It is linked from the
  [README](../../README.md) and is what you would point an uptime monitor at.
- **Logs to stdout/stderr**, collected by Render (API) and Vercel (web app) in their dashboards. Start-up
  and shutdown lines, errors with stack traces on the server side, failed background jobs
  (`[jobs] <name> failed: ...`), and request lines from `morgan` in development.
- **A request ID** for every request ([`backend/src/utils/requestContext.js`](../../backend/src/utils/requestContext.js)),
  stored on audit entries.
- **An audit trail with its own analysis screen**: every sensitive action is stored in MongoDB, and the
  dashboard's **Audit** page breaks it down by operation, person, outcome, hour of the day and day of the
  week, with counts over time ([`backend/src/services/auditAnalysisService.js`](../../backend/src/services/auditAnalysisService.js)).
  That is business and security monitoring: a burst of failed sign-ins at 3 a.m. stands out on the
  weekday × hour grid.
- **A Jobs page** for background work (dashboard → Jobs): each durable job's status and progress, with a
  retry button for failed ones ([`backend/src/jobs/index.js`](../../backend/src/jobs/index.js)).
- **CI reports** test coverage on every run, in the run's summary
  ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).
- **The Docker healthcheck** on MySQL (see [Docker basics](deployment-basic.md#debugging-and-logs)).

**What is missing, and what to add first**

| Gap | Why | First step |
|---|---|---|
| No outside uptime check | Nobody is told when the site is down | A free uptime service (UptimeRobot, Better Stack) calling `/api/v1/health` every few minutes, alerting by email |
| The health check does not check the database | It says "ok" even when MySQL is unreachable (as in the Aiven incident) | A readiness check that runs `SELECT 1` and pings MongoDB, returning 503 if either fails |
| Plain-text logs, request ID not on log lines | Hard to filter, hard to follow one request | A JSON logger (`pino`) with the request ID on each line |
| No error tracking | A browser error or a server exception is only in a log nobody reads | Sentry (free tier) on the API and the web app: grouped errors, alerts on new ones |
| No metrics over time | Cannot see "slower since Tuesday's deploy" | Render's built-in charts to start; a `/metrics` endpoint for Prometheus later |
| No log retention of our own | Platform logs are kept only for a limited time | Ship logs to a store such as Better Stack or Grafana Cloud |

**A real example of why the readiness check matters:** when Aiven powered off the free database, the API
logged `getaddrinfo ENOTFOUND` and every request failed, but `/health` would still have answered "ok",
because it does not touch the database. An uptime monitor watching only that endpoint would have stayed
green.

### At larger scale

- **Metrics**: Prometheus scrapes a `/metrics` endpoint from every service; **Grafana** draws the dashboards;
  Alertmanager sends alerts to Slack, email or a pager.
- **Logs**: the ELK / OpenSearch stack, Grafana Loki, or cloud services (CloudWatch, Google Cloud Logging).
- **Traces**: **OpenTelemetry** instruments the code once; Jaeger, Tempo or a vendor shows the traces.
- **All-in-one platforms (APM)**: Datadog, New Relic, Dynatrace, Elastic.
- **On-call**: PagerDuty or Opsgenie rotate who gets woken up; every incident gets a written review (a
  *post-mortem*) without blame.
- **SLOs with error budgets** decide when to ship features and when to stop and fix reliability.

### Common mistakes

- **Watching averages.** An average of 200 ms can hide 5% of users waiting 10 seconds.
- **A health check that checks nothing.** "The process answers" is not "the app works".
- **Too many alerts.** People mute the channel and miss the real one.
- **Logging everything at `debug` in production**, or logging passwords, tokens and personal data.
- **Free-text logs with no request ID.** Following one user's failing request becomes guesswork.
- **Monitoring only the servers.** CPU can be fine while sign-ups have stopped.
- **Logs only inside the container**, gone when it is replaced.

### Explain it in two minutes

> "Monitoring tells me *that* something is wrong, logging tells me *why*, and alerts make sure someone
> finds out. The signals are logs, metrics and traces, and the four things worth watching are latency,
> traffic, errors and saturation.
>
> In this project the API has a health endpoint, logs go to stdout and are collected by Render and Vercel,
> every request gets an ID, and there are two monitoring screens built into the app: the Audit page, which
> breaks down every sensitive action by person, hour and weekday, and the Jobs page for background work.
>
> The honest gap is that nobody is alerted. I would add an external uptime check first, make the health
> check actually test the database, because when our free database was switched off the health check
> would still have said OK, then JSON logs with the request ID on every line, and Sentry for errors."

### Questions you may be asked

- **Monitoring vs observability?** Monitoring watches known signals for known problems. Observability is
  being able to answer *new* questions about the system from its logs, metrics and traces, without
  shipping new code.
- **Liveness vs readiness?** Liveness: is it alive (restart it if not). Readiness: can it serve now (stop
  routing to it if not). A database outage should fail readiness, not liveness; restarting would not help.
- **Why percentiles instead of averages?** Averages hide the slow tail; p95/p99 show what the unluckiest
  users experience.
- **What makes a good alert?** It is about a user-visible symptom, it needs a human to act, and it says
  what to look at first.
- **What is structured logging?** Logs as data (usually one JSON object per line) with fixed fields such
  as time, level, message, request ID and user ID, so they can be filtered and counted.
- **What would you never log?** Passwords, tokens, full card numbers, and personal data beyond what is
  needed, because logs are copied widely and kept a long time.
