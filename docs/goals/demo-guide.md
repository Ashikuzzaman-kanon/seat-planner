# Demo guide

Each topic's purpose, its key points, and the commands that show it in practice, from Docker to AI, with the
live debugging demo at the end. The examples come from Seat Planner, a railway ticketing app. Longer
explanations of every topic are in [theory.md](theory.md).

Run the commands in **PowerShell**. Every exercise uses its own throw-away containers (`hello`, `web`,
`oom`...) and removes them at the end; the project's own containers are only looked at.

**Contents:**
[Docker basics](#docker-basics) ·
[Docker, advanced](#docker-advanced) ·
[Deployment](#deployment) ·
[Jenkins](#jenkins) ·
[AI](#productivity-with-ai) ·
[Debugging demo](#debugging-demo-live)

---

## Docker basics

### Basic commands

**Purpose:** build an image, run it as a container, look at it, stop it, remove it.

- **Image** = a frozen, ready-to-run package of the app. **Container** = one running copy of an image.
- Seven verbs cover daily work: `build`, `run`, `ps`, `logs`, `exec`, `stop`, `rm`.
- `docker compose down` keeps the data; `down -v` deletes the volumes with it.

```powershell
docker pull nginx:alpine           # download a small web-server image from Docker Hub
docker images                      # list the images on this machine, with their sizes

# start a container named hello in the background (-d); port 8080 on this PC goes to port 80 inside it
docker run -d --name hello -p 8080:80 nginx:alpine

docker ps                          # list running containers; PORTS shows 0.0.0.0:8080->80/tcp
curl.exe http://localhost:8080     # request the page through the published port: nginx's welcome page
docker logs hello                  # what the container printed: one line per request
docker exec -it hello sh           # open a shell inside the running container; type exit to leave
docker stop hello                  # stop it politely (SIGTERM); the container still exists
docker ps -a                       # list all containers, stopped ones too: hello shows Exited (0)
docker rm -f hello                 # delete the container (-f stops it first if it is still running)
```

The whole project stack:

```powershell
cd D:\Projects\seat-planner                 # the folder with docker-compose.yml
docker compose up -d --build                # build the images, then start MySQL, MongoDB, API, web app and Caddy
docker compose ps                           # this project's containers and their state; db shows (healthy)
docker compose logs backend --tail 20       # the API's last 20 log lines: migrations, then "API listening"
docker compose down                         # stop and delete the containers and network; data volumes are kept
# docker compose down -v                    # the same, but also deletes the data volumes: the data is gone
```

### Docker vs Docker Compose

| | Docker | Docker Compose |
|---|---|---|
| Runs | One container per command | The whole app, from one YAML file |
| Options | Typed on the command line | Written in `docker-compose.yml` |
| Network | You create it yourself | One per project, created for you |
| Use it for | Building images, one container, debugging | Several services, local development, one server |

Same engine underneath. `docker compose` (v2, built in) replaced the old `docker-compose` (v1).
**One line:** Docker runs a container; Compose runs the whole app from one file.

### Dockerfile vs Compose file

| | Dockerfile | `docker-compose.yml` |
|---|---|---|
| Answers | What goes **inside one image**? | Which containers run, and **how they connect**? |
| Holds | Base image, files, dependencies, user, start command | Ports, environment, secrets, volumes, start order, health checks |
| Used by | `docker build` | `docker compose up` |

They work together: `build: ./backend` in the Compose file builds `backend/Dockerfile`. Secrets stay in the
Compose file and `.env`, never in the image. Render uses only the Dockerfile.
**One line:** the Dockerfile builds the box; the Compose file arranges the boxes and wires them together.

### Layer cache

- Each instruction makes a **layer**. On a rebuild, a step whose inputs have not changed is reused (`CACHED`).
- `COPY` is reused when the files' **contents** are the same; `RUN` when the **command text** is the same.
- Once one step misses the cache, **every step after it rebuilds**. So: what changes least goes first.
- The API's Dockerfile copies `package*.json` and runs `npm ci` **before** `COPY . .`, so a code change
  rebuilds only the last step, in seconds.

```powershell
cd D:\Projects\seat-planner                 # the project folder
docker build -t sp-api:study backend        # build the API image from backend/Dockerfile, named sp-api:study
docker build -t sp-api:study backend        # build it again, nothing changed: every step says CACHED
# now change any file in backend/src and build again: only the last step (COPY . .) runs
docker history sp-api:study                 # list the image's layers, one row per step, with their sizes
```

Keep `sp-api:study`: the next exercises use it, and the registry one removes it at the end.

### Networking

**Purpose:** show how containers find each other, and what can be reached from outside.

- On a Compose (user-defined) network, every **service name is a host name**: the API connects to `db` and
  `mongo`. The default bridge network has no names.
- Only **published** ports are reachable from outside. Here only Caddy (80, 443) is public; MySQL publishes
  nothing; MongoDB only on `127.0.0.1`.
- Inside a container, `localhost` is the container itself. Use the service name, or
  `host.docker.internal` for your own PC.

```powershell
docker network create demo-net                             # create a user-defined network (it has name lookup)
docker run -d --name web --network demo-net nginx:alpine   # start a web server called web on that network

# from a second container on the same network, fetch http://web: it works, "web" is found by name
# (--rm deletes this helper container as soon as it finishes)
docker run --rm --network demo-net alpine wget -qO- http://web

# the same from the default network: it fails with "bad address 'web'", because there are no names there
docker run --rm alpine wget -qO- -T 3 http://web

docker rm -f web ; docker network rm demo-net              # delete the container, then the network

docker network inspect seat-planner_default                # the project's network: its containers and their IPs
docker port seat-planner-mongo-1                           # the ports it publishes: 27017/tcp -> 127.0.0.1:27017
```

### Debugging and logs

**Purpose:** find out why a container failed, in a fixed order.

1. `docker ps -a`: is it running, restarting or exited, and with which code?
2. `docker inspect`: was it killed for memory (`OOMKilled`), is its health check failing?
3. `docker logs --tail 100`: the last thing it printed.
4. `docker exec -it <name> sh` to look inside; if it dies at once, `docker run -it --entrypoint sh <image>`.

| Exit code | Means |
|---|---|
| 0 | Finished normally |
| 1 (or any small number) | The app failed: read the logs |
| 137 | Killed, often for memory |
| 143 | Stopped politely (SIGTERM) |

```powershell
# a container that prints one line to stdout and one to stderr, then exits with code 3
docker run --name broken alpine sh -c "echo starting; echo 'cannot read config' >&2; exit 3"
docker ps -a --filter name=broken      # its state: Exited (3)
docker logs broken                     # everything it printed, stdout and stderr: both lines
docker rm broken                       # delete it

# a container capped at 32 MB of memory that keeps taking more until Docker kills it
docker run --name oom -m 32m alpine sh -c "tail /dev/zero"
# read how it ended: exit code 137, and OOMKilled=true (killed for running out of memory)
docker inspect oom --format "{{.State.ExitCode}} OOMKilled={{.State.OOMKilled}}"
docker rm oom                          # delete it

docker stats --no-stream               # CPU and memory use of every running container, once
docker logs -f -t --tail 5 <name>      # a container's last 5 lines with times, then keep following (Ctrl+C stops)
```

**A real incident:** the API on Render logged `getaddrinfo ENOTFOUND` for the database. The free
database had been switched off. Power it on, redeploy. Logs first, then the fix.

---

## Docker, advanced

### Optimizing images

**Purpose:** smaller images that build, push and start faster.

- Small base (Alpine), layer order for the cache, a `.dockerignore`, multi-stage builds.
- Measured: the API image is **328 MB**; cleaning npm's cache in the same step makes it **289 MB**.
- The web app builds in a `builder` stage and copies only the result into the `runner` stage.

```dockerfile
# install the production dependencies, then delete npm's download cache in the same layer: 328 MB -> 289 MB
RUN npm ci --omit=dev && npm cache clean --force
```

```powershell
docker images sp-api                 # the sp-api images and their total sizes
docker history sp-api:study          # the size of each layer: shows where the megabytes are
```

### Docker security

**Purpose:** limit what an attacker gets if they break into the app.

- Small official base; runs as the `node` user, not root; no secrets in the image; only the proxy is public.
- Scan images for known flaws (Trivy); fix by rebuilding, never by patching a running container.
- Next: read-only file system and dropped capabilities in Compose, and the scan in CI.

```powershell
docker run --rm sp-api:study id        # which user the app runs as: uid=1000(node), not root

# start it with a read-only file system and try to write a file: refused, "Read-only file system"
docker run --rm --read-only sp-api:study sh -c "touch /app/x"

# scan the image for known HIGH and CRITICAL vulnerabilities, with Trivy running in its own container
docker run --rm -v //var/run/docker.sock:/var/run/docker.sock aquasec/trivy:0.58.1 image --scanners vuln --severity HIGH,CRITICAL sp-api:study
```

```yaml
# docker-compose.yml, per app service
read_only: true                           # the container cannot change its own files
tmpfs: [/tmp]                             # except /tmp, which lives in memory
cap_drop: [ALL]                           # drop every Linux capability (special privileges)
security_opt: ["no-new-privileges:true"]  # no process inside can gain more rights later
```

### Resource management

**Purpose:** stop one container from taking the whole machine.

- Over the **memory** limit: the container is killed (137, `OOMKilled`). Over the **CPU** limit: it only slows down.
- Tell Node its heap size, and rotate logs.
- The production MySQL pool is capped at 3 connections: the free plan allows only a few.

```powershell
# a container limited to half a CPU, running an endless loop as fast as it can
docker run -d --name busy --cpus 0.5 alpine sh -c "while :; do :; done"
docker stats --no-stream             # live use, once: busy stays at about 50% CPU, its limit
docker rm -f busy                    # stop and delete it
```

```yaml
backend:
  deploy:
    resources:
      limits: { memory: 512M, cpus: "1.0" }      # at most 512 MB of memory and one CPU
  environment:
    NODE_OPTIONS: --max-old-space-size=384      # keep Node's heap below the memory limit
  logging:
    options: { max-size: "10m", max-file: "3" } # rotate logs: at most 3 files of 10 MB
```

### Custom registries

**Purpose:** store images somewhere you control, so CI builds once and the server deploys that exact image.

- Name: `ghcr.io/owner/seat-planner-api:<tag>`. The **tag** can move; the **digest** (`sha256:...`) never changes.
- Build once in CI, tag with the commit, push; deploy that image; roll back by deploying the previous tag.
- Today Render builds from Git; a registry is the next step.

```powershell
# run a private registry on this PC, on port 5000
docker run -d --name registry -p 127.0.0.1:5000:5000 registry:2

# give the API image a second name that points at that registry (the same image, nothing is copied)
docker tag sp-api:study localhost:5000/seat-planner-api:1.0.0

docker push localhost:5000/seat-planner-api:1.0.0     # upload the image to the registry
curl.exe http://localhost:5000/v2/_catalog            # ask the registry what it holds: seat-planner-api
docker rmi localhost:5000/seat-planner-api:1.0.0      # delete that name from this PC
docker pull localhost:5000/seat-planner-api:1.0.0     # download it back from our own registry
docker rm -f -v registry                              # delete the registry and its storage (-v)
docker rmi localhost:5000/seat-planner-api:1.0.0 sp-api:study   # delete the images these exercises used
```

---

## Deployment

### Security in application deployment

**Purpose:** protect every step from commit to production.

- **Secrets:** never in Git or images; in Render's and Vercel's settings. A gitleaks scan of the history: 16
  hits, all false positives.
- **Transport:** HTTPS with HSTS. **Network:** only the proxy is public.
- **App:** bcrypt passwords and a sign-in pause; routes check permissions; input validated; CORS allow-list;
  no stack traces in production; sensitive actions audited.
- **Supply chain:** `npm ci` from the lock file; Next.js patched for CVE-2025-66478 when announced.
- **Next:** staging data for previews, a verified database certificate, security headers, scans in CI.

```powershell
cd D:\Projects\seat-planner\backend          # the API's folder
npm audit --omit=dev                         # list known vulnerabilities in the production dependencies

# the live site's response headers only (-I); look for strict-transport-security (HSTS)
curl.exe -sI https://seat-planner-sable.vercel.app/login

# scan the whole Git history for committed secrets, with any secret hidden in the output (--redact)
docker run --rm -v "D:/Projects/seat-planner:/repo" zricethezav/gitleaks:v8.21.2 git /repo --redact --no-banner
```

### Monitoring and logging

**Purpose:** know **that** something is wrong (monitoring), **why** (logs), and make sure a person hears (alerts).

- Signals: logs, metrics, traces. Watch latency, traffic, errors and saturation.
- Here: `/api/v1/health`, logs to stdout (Render, Vercel), a request ID per request, the **Audit** analysis
  screen, the **Jobs** screen.
- Next: an external uptime check, a health check that tests the databases, JSON logs, Sentry.

```powershell
curl.exe -s http://localhost:4000/api/v1/health     # ask the local API whether it is up: {"status":"ok",...}

# the same check, printing only the status code and how long the answer took
curl.exe -s -o NUL -w "status %{http_code}, %{time_total}s`n" http://localhost:4000/api/v1/health

# run Uptime Kuma, a self-hosted uptime monitor, on port 3001
docker run -d --name kuma -p 127.0.0.1:3001:3001 louislam/uptime-kuma:1
# open http://localhost:3001, add an HTTP monitor for http://host.docker.internal:4000/api/v1/health,
# then stop the API for a minute and watch the monitor turn red
docker rm -f -v kuma                                # delete it and its data
```

### Rollback and disaster recovery

**Purpose:** get back to a working version fast (rollback), and get service and data back after a big loss (DR).

- **RPO** = how much data we may lose. **RTO** = how long we may be down. A start: RPO 24 h, RTO 2 h.
- Web app: Vercel keeps every deploy. API: Render keeps its deploys. A feature: switch it off in Settings.
- Database: 31 of 39 migrations only add; 8 change or remove, so check before rolling back past them.
  Expand, then contract. Undo a migration only by name.
- Next: nightly backups, one timed restore drill, a written runbook.

```powershell
# ----- backup and restore, on a throw-away MySQL -----

# start MySQL 8 with an empty database called shop
docker run -d --name dr-db -e MYSQL_ROOT_PASSWORD=secret -e MYSQL_DATABASE=shop mysql:8

# wait about 20 seconds for MySQL to start, then create a table with two rows
docker exec dr-db mysql -uroot -psecret shop -e "CREATE TABLE orders (id INT PRIMARY KEY, item VARCHAR(20)); INSERT INTO orders VALUES (1,'ticket'),(2,'refund');"

# the backup: dump the whole database into a file
docker exec dr-db sh -c "mysqldump -uroot -psecret --single-transaction shop > /tmp/shop.sql"

# the disaster: delete the table
docker exec dr-db mysql -uroot -psecret shop -e "DROP TABLE orders;"

# the recovery: load the dump back into the database
docker exec dr-db sh -c "mysql -uroot -psecret shop < /tmp/shop.sql"

# check: both rows are back
docker exec dr-db mysql -uroot -psecret shop -e "SELECT * FROM orders;"

docker rm -f -v dr-db                                          # delete the database container and its data

# ----- rollback by image tag -----

docker run -d --name app -p 8080:80 nginx:1.27-alpine          # deploy "the new release", version 1.27
curl.exe -sI http://localhost:8080 | Select-String Server       # which version answers: nginx/1.27.x
docker rm -f app                                               # take it down
docker run -d --name app -p 8080:80 nginx:1.26-alpine          # roll back: the same command, the previous tag
curl.exe -sI http://localhost:8080 | Select-String Server       # now nginx/1.26.x answers
docker rm -f app                                               # clean up

# ----- undo one migration, by name only (in backend/; shown for reference, not run here) -----

# runs only that migration's "down" step; naming it means only the one you mean is undone
npx sequelize-cli db:migrate:undo --name 20260205000000-subscription-continue.js
```

### Best practices

**Purpose:** make releasing boring and safe.

- Small changes through pull requests and CI; build once; configuration from the environment; health checks;
  monitoring; a way back.
- Here: 27 pull requests in a month, each through CI; every setting an environment variable; graceful
  shutdown; earlier deploys kept; feature switches; signed Android releases from a tag.
- First three to add: **backups** with a restore drill; **uptime check** plus a database-aware health check;
  **staging** for previews.
- Measure with DORA: deploy frequency, lead time, change failure rate, time to recover.

```powershell
cd D:\Projects\seat-planner          # the folder with docker-compose.yml
docker compose config --quiet        # check the Compose file is valid; warns about variables missing from .env
```

---

## Jenkins

### Basics

**Purpose:** a self-hosted automation server that builds, tests and deploys.

- **Controller** (UI, configuration, scheduling) and **agents** (run the builds, picked by label).
- **Job** = what to do; **build** = one numbered run, with log and artifacts. Almost everything is a plugin.
- Compared with GitHub Actions (this project): your own servers, a Groovy `Jenkinsfile`, and you maintain it.

```powershell
# run Jenkins (the LTS version) on port 8081, keeping everything it stores in a volume called jenkins_home
docker run -d --name jenkins -p 127.0.0.1:8081:8080 -v jenkins_home:/var/jenkins_home jenkins/jenkins:lts-jdk21

# print the one-time password that unlocks the first sign-in
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword

# open http://localhost:8081, paste the password, choose "Install suggested plugins", create an admin user

docker rm -f jenkins ; docker volume rm jenkins_home    # delete Jenkins, then everything it stored
```

### Freestyle project

**Purpose:** a job set up through web forms.

- Sections: source code, triggers, build environment, build steps, post-build actions.
- Example: the backend tests. Git repo, GitHub webhook, Node 20, 20-minute timeout, a shell step
  (`npm ci`, `npm run coverage`), archive the coverage report.
- Limits: the configuration lives only in Jenkins (not reviewed or versioned), no parallel stages.

### Pipeline project

**Purpose:** the whole process as code, in a `Jenkinsfile` in the repository.

- Declarative pipeline: `agent`, `stages`, `steps`, `environment`, `options`, `post`.
- Multibranch pipeline: builds every branch and pull request.
- Our `ci.yml` translated: two jobs → `parallel`; `runs-on` → `agent { label }`; services →
  `docker.image().withRun`; `if: always()` → `post { always }`; `upload-artifact` → `archiveArtifacts`.

```groovy
pipeline {
  agent none                                  // no default machine: each stage picks its own
  stages {
    stage('CI') {
      parallel {                              // the two stages below run at the same time
        stage('Backend tests') {
          agent { label 'linux && docker' }   // run on an agent with these labels
          tools { nodejs 'node-20' }          // put the Node 20 installation on the PATH
          steps {
            checkout scm                      // get the code of the branch being built
            // (the full version starts MySQL and MongoDB here, with docker.image(...).withRun)
            dir('backend') {                  // run the next steps in backend/
              sh 'npm ci'                     // install the locked dependencies
              sh 'npm run coverage'           // run the tests and measure coverage
            }
          }
        }
        stage('Frontend') {
          agent { label 'linux && docker' }
          tools { nodejs 'node-20' }
          steps {
            checkout scm
            dir('frontend') {
              sh 'npm ci && npm test && npm run build'   // install, unit tests, production build
            }
          }
        }
      }
    }
  }
}
```

### Configuration

**Purpose:** set the controller up once, safely, and keep it reproducible.

- Manage Jenkins: **System** (URL, zero executors on the controller), **Tools** (`node-20`), **Plugins**,
  **Nodes** (agents), **Credentials** (secrets never shown in logs), **Security** (who may do what).
- **Configuration as Code:** `jenkins.yaml` plus `plugins.txt`, baked into a Docker image, kept in Git.
- Back up `JENKINS_HOME`, or keep everything in JCasC and Git.

```yaml
jenkins:
  numExecutors: 0             # the controller runs no builds itself; agents do
  securityRealm:
    local:                    # accounts kept in Jenkins itself
      allowsSignup: false     # nobody can create their own account
tool:
  nodejs:
    installations:
      - name: node-20         # the name a Jenkinsfile uses: tools { nodejs 'node-20' }
```

---

## Productivity with AI

### AI skills

**Purpose:** a saved procedure the assistant loads only when a task needs it.

- A `SKILL.md`: name and description (always loaded), instructions and scripts (loaded when relevant).
- Used here for charts (a script checks the colour palette), page design, and code review.
- Gain: consistency. Written once, followed the same way every time.

### AI agents

**Purpose:** a model with tools in a loop: plan, read, edit, run, check, repeat.

- Here the agent ran the 57 integration suites and the browser tests against the running app, and fixed
  failures, before each pull request.
- Checking caught its own wrong assumption: 8 of 39 migrations were not additive.
- My role: set the goal, approve risky steps, review every change.

### Git worktrees

**Purpose:** several working folders for one repository, each on its own branch, for parallel work.

- Same history, no second clone; one agent per worktree.
- Per folder: installed dependencies, `.env`, ports.

```powershell
git worktree add ../seat-planner-demo demo   # a second folder next to this one, with the demo branch checked out
git worktree list                            # every folder of this repository, and the branch in each
git worktree remove ../seat-planner-demo     # delete that folder (refused if it has uncommitted changes)
```

### A proper AI setup

**Purpose:** good results, safely.

- **Context:** a project instructions file and a memory of my rules.
- **Verification:** the app runs locally with seed data; unit, integration and browser tests.
- **Limits:** routine commands allowed, everything else asks; no production secrets on the machine; I merge.

### Keeping up to date

**Purpose:** keep using the features that save time, as the tools change.

- Release notes 20 minutes a week; try each new feature on one real task; keep it or drop it.
- Adopted this way: background test runs, subagents, skills, worktrees.

### Measuring a 200% increase

**Purpose:** show the gain with numbers, honestly.

- 200% more = three times the useful output in the same time. Count delivered, tested work.
- 2 October to 1 November 2026: **27** pull requests merged (about 6 a week), **11** in one 12-day stretch.
- Tests: **337** backend unit tests, **57** integration suites (2,156 checks), **10** frontend unit tests,
  **20** browser scripts. CI runs the unit and integration tests on every pull request.
- Method: 3 to 5 tasks, an estimate without AI written down first, the actual time, and the quality.

```powershell
# count the pull requests merged from 2 October to 1 November 2026, with GitHub's command-line tool: 27
gh pr list --state merged --search "merged:2026-10-02..2026-11-01" --limit 100 --json number --jq length
```

---

## Debugging demo (live)

In IntelliJ IDEA or PhpStorm, about 30 minutes. The run configurations load from `.run/`; the scripts are in
`demo/debugging/`. Step by step: [debugging-demo.md](debugging-demo.md).

| # | Technique | Run configuration | What it shows |
|---|---|---|---|
| 1 | Conditional breakpoints and actions | **1 Refunds (conditional breakpoints)** | Condition `refund < 0` stops at booking 1056; a logging breakpoint that does not stop |
| 2 | Attach to process | **Attach to Node (9229)** | The API started with `npm start`, opened with `node demo/debugging/enable-inspector.js <pid>`; stop in the health route |
| 3 | Child processes | **3 Child processes**, then **Integration tests (concurrency)** | A breakpoint in a child; then in a suite the test runner starts |
| 4 | Mixed code bases | **Full stack (debug)** | One click from `createHold` in the browser into `holdService.js` in the API |
| 5 | Multi-threaded | **5 Worker threads (race)**, then **(fixed)** | 4 × 1,000,000 sales counted short; fixed with `Atomics.add` |
| 6 | Core dump analysis | **6 Crash report**, **6 Memory leak (heap snapshot)** | The report's stack; the snapshot's growing Map |
| 7 | Another environment | **7 Timezone (Dhaka laptop)** vs **(UTC server)**, **7 Paths** | A date that changes with `TZ`; a path that breaks only on Linux |

| Shortcut | Does |
|---|---|
| `Ctrl+F8` | Toggle a breakpoint |
| `Ctrl+Shift+F8` | Edit breakpoints (condition, logging) |
| `Shift+F9` / `F9` | Debug / resume |
| `F8` / `F7` / `Shift+F8` | Step over / into / out |
| `Alt+F8` | Evaluate an expression |
| `Ctrl+Alt+F5` | Attach to a process |

Part 2, attaching to the running API:

```powershell
# which process is listening on port 4000 (the API): prints its process id
Get-NetTCPConnection -LocalPort 4000 -State Listen | Select-Object -ExpandProperty OwningProcess

# ask that running process to open its debugger port (9229) without restarting it
node demo/debugging/enable-inspector.js <pid>
```
