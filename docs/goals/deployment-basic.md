# Docker basics

Goal: **App Deployment (Basic)**. Three sub-goals, each at 50%: [Basic commands](#basic-commands),
[Networking](#networking), [Debugging and logs](#debugging-and-logs).

The project already uses Docker (that was the first 50%). This page fills in the rest: the commands
behind it, how the containers find each other, and how to find out what went wrong.

> **Where to type the commands:** use **PowerShell**. Git Bash rewrites anything that looks like a
> Linux path (`/usr/share/...` becomes `C:/Program Files/Git/usr/share/...`) and has trouble with
> `-it`. If you do use Git Bash, start the line with `MSYS_NO_PATHCONV=1` and put `winpty` before
> `docker ... -it`.
>
> Every exercise uses its own throw-away containers (`hello`, `web`, `broken`...). The project's
> running `seat-planner-mongo-1` is only ever **looked at**, never stopped or removed.

---

## Basic commands

### In one sentence

An **image** is a frozen, ready-to-run copy of an app and everything it needs; a **container** is
one running copy of that image; a handful of commands builds, starts, inspects, stops and removes them.

### Why it matters

"It works on my machine" happens because machines differ: Node version, operating system, a missing
library. An image carries all of that with it, so the same image runs the same way on your laptop,
in CI and on the server. The commands are how you drive it; without them Docker is a black box.

### Key ideas

| Term | In plain words |
|---|---|
| **Image** | A read-only package: a small Linux, the runtime (Node 20), your code, its libraries, and the command to start it. Built from a `Dockerfile`. |
| **Layer** | Each line of a Dockerfile adds a layer on top of the last. Unchanged layers are reused from cache, which is why rebuilds can be fast. |
| **Container** | A running (or stopped) copy of an image, with its own files, process list and network address. Many containers can come from one image. |
| **Tag** | A name for an image version: `node:20-alpine`, `mysql:8`. Without a tag Docker assumes `:latest`. |
| **Registry** | A server that stores images. Docker Hub is the default; `docker pull` downloads from it. |
| **Volume** | Storage that lives outside the container, so data survives when the container is removed. |
| **Port mapping** | `-p 8080:80` means "traffic to port 8080 on my machine goes to port 80 in the container". |
| **Docker Compose** | One YAML file that describes several containers and starts them together. |

**The commands you need, grouped by what they do:**

| Job | Command | Notes |
|---|---|---|
| Get an image | `docker pull nginx:alpine` | `run` pulls automatically if missing |
| Build an image | `docker build -t myapp:1.0 .` | `.` is the *build context*: the folder sent to Docker |
| List images | `docker images` | |
| Start a container | `docker run -d --name hello -p 8080:80 nginx:alpine` | `-d` runs it in the background |
| List containers | `docker ps` (running) · `docker ps -a` (all, stopped too) | |
| Stop / start / restart | `docker stop hello` · `docker start hello` · `docker restart hello` | `stop` asks politely (SIGTERM), then forces after 10 s |
| Run a command inside | `docker exec -it hello sh` | Alpine images have `sh`, not `bash` |
| Read its output | `docker logs hello` | See [Debugging and logs](#debugging-and-logs) |
| Remove | `docker rm hello` · `docker rm -f hello` (even if running) · `docker rmi nginx:alpine` | |
| See disk use | `docker system df` | |
| Clean up unused things | `docker system prune` | Asks first. **Never** add `--volumes` unless you mean to delete data |

**Flags worth knowing on `docker run`:** `-d` (background), `--name` (a name you choose), `-p host:container`
(publish a port), `-e KEY=value` (an environment variable), `-v name:/path` (attach a volume),
`--rm` (delete the container when it stops), `-it` (an interactive terminal).

**Compose versions of the same:**

| Command | What it does |
|---|---|
| `docker compose up -d --build` | Build what needs building, start everything in the background |
| `docker compose ps` | The project's containers and their state |
| `docker compose logs -f backend` | Follow one service's output |
| `docker compose exec backend sh` | A shell inside the running backend |
| `docker compose stop` | Stop, keep the containers |
| `docker compose down` | Stop and remove the containers and network; **volumes (data) are kept** |
| `docker compose down -v` | The same, **and delete the volumes: the database is gone** |

### Try it yourself

```powershell
docker pull nginx:alpine                          # download a small web server image
docker images                                     # it is listed, with its size
docker run -d --name hello -p 8080:80 nginx:alpine
docker ps                                         # running; PORTS shows 0.0.0.0:8080->80/tcp
curl.exe http://localhost:8080                    # the nginx welcome page (or open it in a browser)
docker logs hello                                 # one line per request you just made
docker exec -it hello sh                          # now you are INSIDE the container
  ls /usr/share/nginx/html                        #   the files it serves
  cat /etc/os-release                             #   it is Alpine Linux, not Windows
  exit
docker stop hello ; docker ps -a                  # stopped, not gone: STATUS says Exited (0)
docker start hello                                # same container again, same name
docker rm -f hello                                # gone
docker rmi nginx:alpine                           # image removed too
```

Then look, without touching, at the project's own container:

```powershell
docker ps --filter name=seat-planner              # seat-planner-mongo-1, Up ... days
docker system df                                  # how much space images, containers and volumes use
```

### In this project

- [`backend/Dockerfile`](../../backend/Dockerfile): every line is commented. Read it top to bottom once;
  it is the clearest summary of what an image is.
- [`frontend/Dockerfile`](../../frontend/Dockerfile): a two-stage build (covered in
  [Docker, advanced](docker-advanced.md#optimizing-images)).
- [`docker-compose.yml`](../../docker-compose.yml): five services (`db`, `mongo`, `backend`, `frontend`,
  `caddy`) and four volumes.
- [`README.md`, "Everything in Docker"](../../README.md#everything-in-docker): `docker compose up --build`,
  then `docker compose exec backend npm run seed:superadmin`.
- Day to day only MongoDB runs in Docker: `docker compose up -d mongo`. The API and web app run
  directly with Node, which is faster to restart while coding.
- In production, Render builds `backend/Dockerfile` itself on every deploy and runs the container.

### At larger scale

Nobody types `docker run` on production servers. A CI pipeline builds and tags the image, pushes it to a
registry, and an orchestrator (Kubernetes, Amazon ECS, or a platform like Render) pulls and runs it.
The commands above are still what you use to reproduce a problem on your own machine.

### Common mistakes

- **`docker compose down -v` "to start fresh"** deletes every database volume. Use plain `down`.
- **Using `:latest`** for real deployments. It changes under you; pin a version (`mysql:8`, `node:20-alpine`).
- **Forgetting `-d`** and then closing the terminal, which stops the container.
- **Editing files inside a running container** with `exec`. The change is lost when the container is
  recreated. Change the source and rebuild.
- **`docker system prune -a --volumes`** copied from the internet. It removes every unused image and volume.

### Explain it in two minutes

> "A Docker image is a package with our code, Node 20 and a small Linux inside. A container is that
> image running. In this project the API's [Dockerfile](../../backend/Dockerfile) starts from
> `node:20-alpine`, copies `package.json` first so the `npm ci` step is cached, copies the code, switches
> to a non-root user, and starts with `npm run migrate && npm start`. Render builds that same file on
> every deploy, so what runs in production is exactly what I can run here.
>
> The day-to-day commands are `build`, `run`, `ps`, `logs`, `exec`, `stop` and `rm`. With Compose the same
> verbs work on the whole stack: `docker compose up -d --build` starts MySQL, MongoDB, the API, the web
> app and the Caddy proxy together. One thing I am careful with: `down` keeps the data, `down -v`
> deletes it."

### Questions you may be asked

- **What is the difference between an image and a container?** An image is the read-only template; a
  container is a running instance of it, with its own writable layer on top. One image, many containers.
- **`docker stop` vs `docker kill`?** `stop` sends SIGTERM, waits 10 seconds, then SIGKILL. `kill` sends
  SIGKILL straight away, so the app gets no chance to finish.
- **`CMD` vs `ENTRYPOINT`?** `ENTRYPOINT` is the fixed program; `CMD` is the default arguments, which
  `docker run image <something>` replaces. This project only uses `CMD`.
- **`COPY` vs `ADD`?** Use `COPY`. `ADD` also unpacks archives and downloads URLs, which surprises people.
- **What does `EXPOSE` do?** Nothing at run time; it documents the port. `-p` (or `ports:` in Compose)
  actually publishes it.
- **Where does a container's data go when it is removed?** Gone, unless it was in a volume. That is
  why MySQL writes to the `db_data` volume.

---

## Networking

### In one sentence

Docker gives each container its own network address and puts the containers of one Compose project on a
private network where they find each other **by service name**; only the ports you publish can be
reached from outside.

### Why it matters

Most "it cannot connect" problems in Docker are networking mistakes: using `localhost` in the wrong
place, publishing a database to the whole network by accident, or containers on different networks.
Knowing the rules turns those from hours into minutes.

### Key ideas

| Term | In plain words |
|---|---|
| **Network namespace** | Each container has its own network stack. `localhost` inside a container means **that container**, not your PC. |
| **Bridge network** | A private virtual network on your machine. The default type. |
| **User-defined network** | A bridge network you (or Compose) create. It has **built-in DNS**: containers reach each other by name. The original default `bridge` network does not. |
| **Service discovery** | Finding a service by name instead of IP. In Compose the service name (`db`, `mongo`, `backend`) is the host name. |
| **Publishing a port** | `-p 8080:80` / `ports:` opens a door from your machine into the container. Without it the container is reachable only from its own network. |
| **Bind address** | `127.0.0.1:27017:27017` publishes on your machine only. `27017:27017` publishes on **every** network card, so other computers on the Wi-Fi can reach it. |
| **`host.docker.internal`** | A name Docker Desktop provides so a container can reach a program running on your PC. |
| **Other drivers** | `host` (share the PC's network, Linux only), `none` (no network), `overlay` (across several machines, for Swarm/Kubernetes-style clusters). |

The picture for this project:

```text
your browser ──▶ :80 / :443 ──▶ caddy ──┬── /api/* ──▶ backend:4000 ──┬──▶ db:3306      (MySQL, not published)
                (published)              │                              └──▶ mongo:27017  (MongoDB)
                                         └── else ───▶ frontend:3000
                                                                            127.0.0.1:27017 ──▶ mongo
                                                                            (published to this PC only)
                       all five on the private network  seat-planner_default
```

### Try it yourself

**1. Names work on a user-defined network, not on the default one:**

```powershell
docker network create demo-net
docker run -d --name web --network demo-net nginx:alpine
docker run --rm --network demo-net alpine wget -qO- http://web    # HTML: "web" was found by name
docker run --rm alpine wget -qO- -T 3 http://web                  # fails: "bad address 'web'" (default bridge, no DNS)
docker network inspect demo-net                                    # "Containers": web, with its IP
docker rm -f web ; docker network rm demo-net
```

**2. `localhost` inside a container is the container itself:**

```powershell
docker run -d --name web -p 8080:80 nginx:alpine
docker run --rm alpine wget -qO- -T 3 http://localhost:8080              # "Connection refused": nothing listens on 8080 in THIS container
docker run --rm alpine wget -qO- -T 3 http://host.docker.internal:8080   # works: goes out to your PC, back in through -p
docker rm -f web
```

**3. Look at the project's network (read-only):**

```powershell
docker network ls                                   # seat-planner_default is there
docker network inspect seat-planner_default         # mongo's IP on it
docker port seat-planner-mongo-1                    # 27017/tcp -> 127.0.0.1:27017
```

### In this project

- [`docker-compose.yml`](../../docker-compose.yml) never writes an IP address. The backend is told
  `DB_HOST: db` and `MONGO_URI: mongodb://mongo:27017/seat_planner`; Compose's DNS does the rest.
- [`Caddyfile`](../../Caddyfile): `reverse_proxy backend:4000` and `reverse_proxy frontend:3000`, again by name.
  Caddy is the **single entry point**; it is the only service with public ports (80 and 443).
- **MySQL has no `ports:` at all**, so nothing outside the Compose network can reach it.
- **MongoDB is published on `127.0.0.1` only**, with a comment explaining why: it has no password, so it
  must not be reachable from the rest of the network. The port exists so the API, run directly with
  Node during development, can use it.
- The web image is built with `NEXT_PUBLIC_API_BASE_URL=/api`, a **relative** address, so the same image
  works behind any domain: the proxy decides where `/api` goes.
- In production the same idea holds across services: Vercel rewrites `/api/*` to the Render API, and the
  API reaches Aiven MySQL over TLS by host name.

### At larger scale

Kubernetes keeps the same model with different names: a **Service** gives a stable name and address to
a group of containers, an **Ingress** (or gateway) is the single entry point like Caddy, and **network
policies** say which services may talk to which. Across several machines the network is an *overlay*.

### Common mistakes

- **`DB_HOST=localhost` in a container.** It points at the container itself. Use the service name.
- **Publishing a database with `"3306:3306"`.** That is every network interface. On a Linux server Docker
  also adds its own firewall rules, which can bypass `ufw`. Do not publish it, or bind to `127.0.0.1`.
- **Mixing up the two port numbers.** `-p HOST:CONTAINER`. The app listens on the container's port;
  you browse to the host's port.
- **The app listening on `127.0.0.1` inside the container.** Then nothing outside it can connect, even
  with `-p`. It must listen on `0.0.0.0`. (That is why the web image sets `HOSTNAME=0.0.0.0`.)
- **Containers in different Compose projects** cannot see each other by name unless you attach them to a
  shared network.

### Explain it in two minutes

> "Compose creates a private network for the project, `seat-planner_default`, and every service joins it.
> On that network each service name is a host name, so the API connects to `db` for MySQL and `mongo`
> for MongoDB, and Caddy forwards to `backend:4000` and `frontend:3000`. There is not a single IP address
> in the configuration.
>
> From outside, only what is published can be reached. Caddy publishes 80 and 443 and is the one door
> in. MySQL is not published at all. MongoDB is published only on 127.0.0.1, because it has no password
> and should never be visible to the office network. The one trap everyone hits once: inside a container,
> `localhost` is that container, so you use the service name, or `host.docker.internal` to reach your own PC."

### Questions you may be asked

- **How do two containers talk to each other?** Put them on the same user-defined network and use the
  container or service name. Compose does this automatically.
- **Why can't containers on the default `bridge` network use names?** The default bridge has no built-in
  DNS; only user-defined networks have it. (`--link` was the old workaround; it is deprecated.)
- **What is the difference between `EXPOSE` and `-p`?** `EXPOSE` documents; `-p` publishes.
- **How would you check whether a container can reach another?** `docker exec -it <a> sh`, then
  `wget -qO- http://<b>:<port>` or `nc -zv <b> <port>`; and `docker network inspect` to see who is on which network.
- **What does the `host` network driver do?** The container uses the machine's network directly, no
  isolation and no port mapping. Linux only; rarely needed.

---

## Debugging and logs

### In one sentence

When a container misbehaves you read what it printed (`docker logs`), check how it ended (`docker ps -a`,
`docker inspect`), and, if it is still running, look inside it (`docker exec`), in that order.

### Why it matters

A container that exits straight away, restarts forever or "cannot connect" gives no error on screen.
The answer is almost always in its logs or its exit code; you just need to know where to look.

### Key ideas

| Term | In plain words |
|---|---|
| **stdout / stderr** | The two output streams of a program. Docker captures both and keeps them as the container's log. |
| **Log driver** | Where Docker stores those logs. The default, `json-file`, keeps them in a file per container, **with no size limit** unless you set one. |
| **Exit code** | The number a program ends with. `0` = fine, `1` = the app reported an error, `137` = killed (SIGKILL, often **out of memory**), `143` = stopped by SIGTERM, `127` = command not found. |
| **Restart policy** | `restart: unless-stopped` makes Docker restart a crashed container. Good for uptime, but a crash loop then looks like "Up 2 seconds". |
| **Healthcheck** | A command Docker runs every few seconds to ask "are you ready?". State is `starting`, `healthy` or `unhealthy`. |
| **`docker inspect`** | Everything Docker knows about a container as JSON: state, exit code, OOM flag, environment, mounts, networks, health. |
| **`docker events`** | A live feed of what Docker is doing: start, die, kill, oom, health_status. |
| **`docker stats`** | Live CPU, memory and network per container, like Task Manager. |

**Where to look, in order:**

1. `docker ps -a`: is it running, restarting, or exited, and with what code?
2. `docker logs <name> --tail 100`: the last thing it said.
3. `docker inspect <name>`: why it stopped (`State.ExitCode`, `State.OOMKilled`, `State.Error`), and
   what it was given (environment, mounts, network).
4. `docker exec -it <name> sh`: look around inside, if it stays up long enough.
5. If it dies too fast to `exec`: start the image with a shell instead of its normal command:
   `docker run -it --rm --entrypoint sh <image>` (or `docker compose run --rm backend sh`), then run the
   start command by hand and watch it fail.

**`docker logs` options:** `-f` follow, `--tail 100` last lines, `--since 10m` time window, `-t` add
timestamps. The Compose form `docker compose logs -f backend` merges and colours several services.

### Try it yourself

**1. A container that fails, and how to find out why:**

```powershell
docker run --name broken alpine sh -c "echo starting; echo 'cannot read config' >&2; exit 3"
docker ps -a --filter name=broken                         # Exited (3)
docker logs broken                                        # both lines: stdout and stderr
docker inspect broken --format "{{.State.ExitCode}}"      # 3
docker rm broken
```

**2. Killed for running out of memory (exit code 137):**

```powershell
docker run --name oom -m 32m alpine sh -c "tail /dev/zero"     # eats memory until stopped
docker inspect oom --format "{{.State.ExitCode}} OOMKilled={{.State.OOMKilled}}"   # 137 OOMKilled=true
docker rm oom
```

**3. Following logs live, with timestamps, and watching events in a second window:**

```powershell
# window 1
docker events --filter type=container
# window 2
docker run -d --name hello -p 8080:80 nginx:alpine
curl.exe http://localhost:8080 ; curl.exe http://localhost:8080/nope
docker logs -f -t --tail 5 hello            # a 200 and a 404, with times; Ctrl+C to stop following
docker stats --no-stream                     # memory and CPU of each container
docker rm -f hello                           # window 1 shows kill, die, destroy
```

**4. Read-only look at the project's MongoDB:**

```powershell
docker logs seat-planner-mongo-1 --tail 5 -t
docker inspect seat-planner-mongo-1 --format "{{.State.Status}} since {{.State.StartedAt}}, restarts {{.RestartCount}}"
```

### In this project

- **The API logs to stdout/stderr**, which is what Docker and Render expect. Startup prints
  `🚀 API listening on ...` ([`backend/src/server.js`](../../backend/src/server.js)); a failed start prints
  `❌ Failed to start server:` and exits with code 1, so the restart policy and Render both notice.
- **Request lines** come from `morgan("dev")`, switched on only outside production and tests
  ([`backend/src/app.js`](../../backend/src/app.js)). Every request also gets a `requestId`
  ([`backend/src/utils/requestContext.js`](../../backend/src/utils/requestContext.js)); today it ties a
  request's audit entries together, and it is ready to tag log lines the same way.
- **Graceful stop:** on SIGTERM the API stops its job worker and closes the server, with a 5-second
  backstop ([`backend/src/server.js`](../../backend/src/server.js)). The signal does get there: Alpine's
  `sh` hands its process number 1 (PID 1) over to the last command, so PID 1 is `npm start`, and npm passes
  SIGTERM on to Node. Checked with a copy of this setup: `docker stop` took about half a second and exited 0.
  If a container ever takes the whole grace period and ends in 137, the signal did not reach the app
  (see [`init`](docker-advanced.md#docker-security)).
- **Healthcheck:** MySQL's `mysqladmin ping` in [`docker-compose.yml`](../../docker-compose.yml), and the
  backend waits for `service_healthy`. Check it with
  `docker inspect seat-planner-db-1 --format "{{json .State.Health}}"`.
- **A real production incident:** the API on Render failed with `getaddrinfo ENOTFOUND` for the database
  host. The logs said "cannot resolve the database's name"; the cause was that Aiven had powered the
  free database off after a period without use. Powering it on and redeploying fixed it. The lesson:
  read the first error in the log, not the last.
- **In production** the logs are in the Render dashboard (*Logs* tab) and the Vercel dashboard. The free
  Render plan has no shell, so `exec`-style debugging is not available there; logs are all you have,
  which is a good reason to log clearly.

### At larger scale

Logs are shipped off the machine to a central store (Loki, Elasticsearch/OpenSearch, CloudWatch,
Datadog) so they survive the container and can be searched across many of them. Kubernetes has the same
verbs: `kubectl logs`, `kubectl describe`, `kubectl exec`. See [Monitoring and logging](deployment-monitoring-logging.md).

### Common mistakes

- **Writing logs to a file inside the container.** Docker never sees them and they vanish with it. Log
  to stdout/stderr.
- **No log size limit.** `json-file` grows until the disk is full. Set it per service:
  `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }`.
- **Reading only the last line.** In a crash loop the useful error is usually the first one.
- **"It keeps restarting"** with a restart policy hides the crash. `docker ps -a` shows `Restarting (1)`;
  `docker inspect` shows `RestartCount`.
- **Debugging a container that is not the one running.** After a code change, rebuild
  (`docker compose up -d --build`), otherwise the old image is still running.
- **Printing secrets** in logs when dumping the environment to debug.

### Explain it in two minutes

> "When a container misbehaves I go in a fixed order. `docker ps -a` tells me whether it is running,
> restarting or exited, and the exit code: 1 means the app itself failed, 137 means it was killed, often
> for memory, which `docker inspect` confirms with `OOMKilled`. Then `docker logs --tail 100` shows the
> last thing it printed, which is why our API logs to stdout and prints a clear line when it fails to
> start. If it is running, `docker exec -it ... sh` lets me look inside; if it dies too fast, I start the
> image with `--entrypoint sh` and run its command by hand.
>
> A real example: our API on Render logged `getaddrinfo ENOTFOUND` for the database. That pointed
> straight at the database host, and the cause was Aiven had switched the free database off. Logs first,
> then the fix."

### Questions you may be asked

- **The container exits immediately. What do you do?** `docker ps -a` for the exit code, `docker logs`
  for the message; if that is not enough, run the image with `--entrypoint sh` and start it by hand.
- **What does exit code 137 mean?** 128 + 9: it got SIGKILL. Either memory ran out (`OOMKilled: true`) or
  `docker stop` gave up waiting after 10 seconds.
- **Where are Docker's logs stored?** With the default `json-file` driver, in a JSON file per container
  on the Docker host (inside Docker Desktop's Linux machine on Windows). Use `docker logs`, not the file.
- **How do you stop logs filling the disk?** Log-rotation options (`max-size`, `max-file`) or a driver
  that ships logs elsewhere.
- **How do you see the environment a container was started with?**
  `docker inspect <name> --format "{{json .Config.Env}}"`, carefully, because it includes secrets.
- **How do you debug a failing `docker build`?** `docker build --progress=plain --no-cache .` shows every
  step's full output; then build up to the failing step and run the previous layer with `sh` to look around.
