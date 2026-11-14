# Docker, advanced

Goal: **App Deployment (Intermediate)**. Four sub-goals, all at 0%:
[Optimizing images](#optimizing-images), [Docker security](#docker-security),
[Resource management](#resource-management), [Custom registries](#custom-registries).

Read [Docker basics](deployment-basic.md) first; this page assumes `build`, `run`, `logs` and `inspect`.
Run the commands in **PowerShell** (see the note at the top of the basics page).

The numbers on this page were measured on this machine on 2026-11-15, by building the real
`backend/Dockerfile`. They will drift a little as dependencies change.

---

## Optimizing images

### In one sentence

A good image contains only what the app needs to run, is built in an order that lets Docker reuse
earlier work, and is therefore small, fast to build and fast to start.

### Why it matters

- **Speed.** Every deploy pushes and pulls the image. Smaller means faster deploys and faster scale-up.
  On Render's free plan the API sleeps when idle, so start-up time is something users feel.
- **Build time.** A build that reuses its cached dependency step takes seconds instead of minutes.
- **Security.** Every extra program in the image is something that can have a vulnerability. Less in it,
  less to patch.
- **Cost.** Registries and servers store every version you push.

### Key ideas

| Idea | In plain words |
|---|---|
| **Base image** | Where the image starts. `node:20` (Debian, with compilers and tools) is about a gigabyte; `node:20-slim` is Debian without the extras; `node:20-alpine` is built on Alpine Linux, which is tiny. **Distroless** images go further: no shell, no package manager, only the runtime. |
| **Layer cache** | Docker reuses a step's result if that step and everything before it is unchanged. So put what changes **rarely** (installing dependencies) before what changes **often** (your code). |
| **Build context** | The folder you build from, sent to Docker in full. `.dockerignore` keeps `node_modules`, `.git` and `.env` out of it: faster, and no secrets in the image. |
| **Multi-stage build** | Several `FROM`s in one Dockerfile. An early stage has the compilers and dev tools and builds the app; the last stage copies **only the result**. The tools never reach the final image. |
| **Production dependencies only** | `npm ci --omit=dev` skips test and build tools. |
| **One layer, cleaned in the same step** | A file deleted in a *later* step still takes space in the earlier layer. Download, install and clean up in the **same** `RUN`. |
| **Inspecting** | `docker history <image>` lists each layer's size; the free tool `dive` lets you browse what is in each one. |

### Try it yourself

```powershell
cd D:\Projects\seat-planner                      # the project folder
docker build -t sp-api:study backend             # first build: every step runs
docker build -t sp-api:study backend             # again: every step says CACHED, done in seconds
docker images sp-api                             # SIZE
docker history sp-api:study                      # one row per layer, with its size
docker run --rm --user root sp-api:study du -sh /root/.npm /app/node_modules
```

Now see the cache work for you: add a blank line to any file under `backend/src`, build again, and
note that `npm ci` is still `CACHED` and only `COPY . .` runs. Undo the blank line afterwards.

Clean up with `docker rmi sp-api:study`.

### In this project

**[`backend/Dockerfile`](../../backend/Dockerfile)** already does the main things right, and says why in its comments:

- an Alpine base (`node:20-alpine`);
- `COPY package*.json` **before** `COPY . .`, so code changes do not reinstall dependencies;
- `npm ci --omit=dev` for production dependencies only;
- a `.dockerignore` ([`backend/.dockerignore`](../../backend/.dockerignore)) that leaves out `node_modules`
  (it is built for Windows and would break native modules in Linux), `.env` and `.git`.

What the measurement shows:

| Layer | Size |
|---|---|
| Node 20 on Alpine (the base) | about 220 MB |
| `npm ci --omit=dev` | 103 MB, of which **24 MB is npm's download cache** and 75 MB is `node_modules` |
| `COPY . .` (our code) | 3.9 MB, of which 1 MB is the `tests` folder |
| **Whole image** | **328 MB** |

**Two small improvements, not made yet** (the second one was built and measured):

1. Add `tests` to `.dockerignore`: tests do not need to ship.
2. Clean npm's cache in the same step: `RUN npm ci --omit=dev && npm cache clean --force`.
   **328 MB → 289 MB, about 12% smaller, for one line.**

**[`frontend/Dockerfile`](../../frontend/Dockerfile)** is a two-stage build. The `builder` stage installs
everything, including the Next.js compiler, and runs `npm run build`. The `runner` stage copies only
`.next/standalone` (a minimal server with just the modules it uses), `.next/static` and `public`. The
compiler and all dev dependencies stay behind in the discarded stage.

### At larger scale

- **Distroless or "chiseled" images** (Google's `gcr.io/distroless/nodejs20`, Chainguard images): no
  shell at all. Smaller and safer, but you cannot `exec` into them to debug.
- **BuildKit cache mounts** keep npm's cache *between* builds without putting it in the image:
  `RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev`.
- **CI layer caching** (`cache-from` / `cache-to` with a registry or the GitHub Actions cache) so a fresh
  CI machine still reuses yesterday's layers.
- **Multi-platform builds** (`docker buildx build --platform linux/amd64,linux/arm64`) for ARM servers.

### Common mistakes

- `COPY . .` before `npm ci`: every code change reinstalls all dependencies.
- No `.dockerignore`: the host's `node_modules` and `.env` end up in the image.
- `RUN apt-get install ...` and then `RUN rm -rf /var/lib/apt/lists/*` in a **separate** step: no saving.
- Installing dev dependencies in the final image.
- Chasing size at the cost of debuggability, then having no shell when production breaks. Decide on purpose.

### Explain it in two minutes

> "Optimizing an image means it holds only what the app needs, built in an order Docker can cache. Our API
> image starts from Node 20 on Alpine, copies `package.json` first and installs production dependencies,
> then copies the code. A code change only redoes the last step, so a rebuild takes seconds.
>
> I measured it: 328 MB, of which our own code is 4 MB. The base is about 220 MB and dependencies 103 MB,
> and 24 MB of that is npm's cache, which serves no purpose at run time. Cleaning it in the same step brings
> the image to 289 MB, 12% smaller, for one line. The web image uses a multi-stage build: one stage has
> the compiler and builds, the final stage copies only Next.js's standalone output."

### Questions you may be asked

- **Why copy `package.json` separately?** So the dependency layer is reused when only code changes.
- **What is a multi-stage build for?** To build with heavy tools and ship without them.
- **Alpine vs slim vs distroless?** Alpine is smallest with a shell, but uses `musl` instead of `glibc`, which
  occasionally breaks native modules. Slim is Debian, bigger but fewer surprises. Distroless is smallest
  in attack surface, with no shell.
- **Does deleting files in a later `RUN` make the image smaller?** No. Layers only add; delete in the same step.
- **How do you find what makes an image big?** `docker history`, or `dive` to browse each layer.

---

## Docker security

### In one sentence

Keep the image small and up to date, run it as a normal user with no secrets inside, give the
container no more power or network access than it needs, and scan images for known vulnerabilities.

### Why it matters

A container is not a virtual machine; it shares the host's kernel. If an attacker gets into the app,
everything the container is allowed to do, they can do: read its secrets, reach its networks, and, if it
runs as root with extra privileges, possibly the host itself.

### Key ideas

| Idea | In plain words |
|---|---|
| **Non-root user** | By default a container runs as `root`. `USER node` makes it run as an ordinary user. |
| **No secrets in images** | Anyone who can pull an image can read every layer. Passwords and keys come in at run time as environment variables or secret files, never through `COPY` or `ARG`. |
| **Vulnerability scanning (CVEs)** | Tools compare the packages in an image against public lists of known flaws: `docker scout`, Trivy, Grype, Snyk. |
| **Patching by rebuilding** | You do not update a running container; you rebuild on the latest base image and redeploy. |
| **Least privilege for the container** | `cap_drop: [ALL]` removes Linux special powers, `read_only: true` makes the file system read-only, `no-new-privileges` stops a process from gaining more. |
| **Never `--privileged`, never mount `docker.sock`** | Either one hands the container control of the host. |
| **`init`** | A tiny first process (`docker run --init`, `init: true` in Compose) that passes signals on and cleans up finished child processes, for apps that cannot. |
| **Pin and verify** | Use exact tags or digests (`node:20-alpine@sha256:...`) and, where supported, signed images, so what you run is what you meant. |
| **Network exposure** | Publish only what must be public; keep databases on the private network. |

### Try it yourself

```powershell
docker build -t sp-api:study D:\Projects\seat-planner\backend
docker run --rm sp-api:study id                                   # uid=1000(node): not root
docker run --rm --read-only sp-api:study sh -c "touch /app/x"     # Read-only file system
docker run --rm --cap-drop ALL --security-opt no-new-privileges sp-api:study node -v   # still runs fine

# Scan for HIGH and CRITICAL vulnerabilities (Trivy, run from its own container):
docker run --rm -v //var/run/docker.sock:/var/run/docker.sock aquasec/trivy:0.58.1 image --scanners vuln --severity HIGH,CRITICAL sp-api:study
# Or, after `docker login`:  docker scout quickview sp-api:study
```

(Yes, the scanner is given `docker.sock`, the thing you must never give an app. A trusted tool you run
by hand on your own machine is the accepted exception; a long-running service is not.)

### In this project

Done:

- **Both images run as a non-root user** (`USER node` in [`backend/Dockerfile`](../../backend/Dockerfile) and
  [`frontend/Dockerfile`](../../frontend/Dockerfile)). Checked: `id` prints `uid=1000(node)`.
- **No secrets in the images.** `.env` and `.env.*` are in both `.dockerignore` files; every secret
  (`JWT_SECRET`, database password, mail keys) is passed at run time by Compose or set in Render's dashboard.
- **Small, official base images** (`node:20-alpine`, `mysql:8`, `mongo:7`, `caddy:2-alpine`).
- **Only Caddy is published to the outside.** MySQL has no published port; MongoDB is published on
  127.0.0.1 only, with a comment explaining why ([`docker-compose.yml`](../../docker-compose.yml)).
- **The MySQL container uses a separate, non-root database user** for the app (`MYSQL_USER`), not root.
- **Signals reach the app** without an extra `init` process (checked; see
  [Docker basics](deployment-basic.md#debugging-and-logs)).

**What a scan found** (Trivy, HIGH and CRITICAL only, 2026-11-15): **49 findings, in three places**, and
each place is fixed a different way. That split is the main thing to learn from a scan:

| Where | Findings | How it is fixed |
|---|---|---|
| Alpine system packages (OpenSSL, musl, zlib) | 7 | Rebuild on a newer `node:20-alpine`; nothing to change in our code |
| The copy of **npm** inside the Node base image | 22 | npm is only needed to *install*; a multi-stage build (or a base without npm) leaves it out of the final image |
| **Our own dependencies** in `node_modules` | 20 | Update the packages; most fixes are within the version ranges `package.json` already allows |

No scan runs in CI today, so these were only found by looking. The fix for the third row is a normal
change to `master`, separate from these study notes.

Could be added, cheaply:

```yaml
# docker-compose.yml, per app service (backend, frontend)
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
```

and a scan step in CI that fails the build on a CRITICAL finding.

### At larger scale

- **Scanning in the pipeline and in the registry**: every pushed image is scanned, and the deploy is blocked
  on critical findings.
- **Signed images and policies**: images signed with Sigstore `cosign`; the cluster refuses unsigned ones.
- **SBOMs** (software bill of materials): a list of every package in the image, kept with it, so "are we
  affected by the new OpenSSL bug?" takes one search (`docker buildx build --sbom=true`).
- **Rootless Docker / user namespaces**: even "root" inside the container is an ordinary user on the host.
- **Runtime security tools** (Falco) that alert on unusual behaviour, such as a shell starting in a web container.
- **Secrets managers** (Vault, AWS Secrets Manager, Kubernetes Secrets) instead of plain environment variables.

### Common mistakes

- Running as root because "it works".
- `COPY . .` without `.dockerignore`, shipping `.env`.
- Passing a secret as `ARG`: it is saved in the image history (`docker history` shows it).
- Never rebuilding: the base image's fixes never reach you.
- `ports: "3306:3306"` on a server.
- Mounting `/var/run/docker.sock` into a web app "for convenience".

### Explain it in two minutes

> "A container shares the host's kernel, so container security is about limiting what an attacker gets if
> they break into the app. Our images start from small official bases, run as the `node` user rather than
> root, and contain no secrets: `.env` is excluded, and every secret is given at run time. Only the Caddy
> proxy has public ports; MySQL is not published at all and MongoDB only on the loopback address.
>
> What I would add: a read-only file system and dropped capabilities in Compose, and an image scan in CI.
> I scanned the API image with Trivy: the findings came from three places: Alpine's own packages, the copy
> of npm in the Node base image, and our dependencies. Each is fixed differently: rebuild on a newer base,
> leave npm out of the final image, update our packages. Patching a container always means rebuilding and
> redeploying, never changing it in place."

### Questions you may be asked

- **Why not run as root inside a container?** If the app is compromised, root inside plus a kernel or
  configuration flaw can mean root on the host. A normal user removes that step.
- **How do you pass secrets to a container?** Environment variables or mounted secret files at run time,
  ideally from a secrets manager. Never in the image.
- **What is a CVE?** A public ID for a known vulnerability (`CVE-2025-66478` was the Next.js one this
  project upgraded for). Scanners match your packages against these lists.
- **What does `--privileged` do?** Gives the container nearly all the host's powers. Avoid it.
- **How do you keep images patched?** Rebuild regularly on the latest base (pinned to a version, not
  `latest`), let a bot like Dependabot or Renovate propose base-image updates, and scan.

---

## Resource management

### In one sentence

Limit how much memory, CPU and other resources each container may use, so one misbehaving container
cannot starve the rest, and size those limits from what the app really uses.

### Why it matters

By default a container may use **all** the memory and CPU of the machine (on Windows: of Docker
Desktop's Linux VM, 3.7 GB here). A memory leak in one service then slows or kills every service on the
host. Limits turn "the whole server froze" into "one container restarted".

### Key ideas

| Idea | In plain words |
|---|---|
| **Memory limit** | `-m 512m`. If the container goes over, the kernel kills it: exit code 137, `OOMKilled: true`. |
| **Memory reservation** | A soft floor the container is guaranteed when memory is tight. |
| **CPU limit** | `--cpus 1.5` = at most one and a half CPU cores' worth of time. Going over **slows** the container down; it is not killed. |
| **CPU shares** | A relative weight, used only when CPUs are busy: 2048 gets twice the time of 1024. |
| **PIDs limit** | `--pids-limit 200`: the most processes it may start. Stops a runaway loop from exhausting the host. |
| **cgroups** | The Linux kernel feature that enforces all of these. |
| **Disk** | Logs (no limit by default), volumes and old images all fill disks. Rotate logs, prune images. |
| **Limits for the app inside** | Node decides its heap size itself. Set `NODE_OPTIONS=--max-old-space-size=...` a little below the container limit (about 75%), so Node cleans up harder before the kernel kills it. |
| **Connections are resources too** | A database accepts only so many connections. A connection pool caps how many the app opens. |

### Try it yourself

```powershell
docker run -d --name capped -m 64m --cpus 0.5 nginx:alpine
docker run -d --name busy --cpus 0.5 alpine sh -c "while :; do :; done"   # spins one CPU as hard as it can
docker stats --no-stream            # busy ~50% CPU (its cap), capped shows "/ 64MiB" as its memory limit
docker update --memory 128m --memory-swap 128m capped    # change a limit on a running container
docker stats --no-stream capped     # now "/ 128MiB"
docker rm -f capped busy
```

And the out-of-memory kill, from the basics page:

```powershell
docker run --name oom -m 32m alpine sh -c "tail /dev/zero"
docker inspect oom --format "{{.State.ExitCode}} OOMKilled={{.State.OOMKilled}}"   # 137 OOMKilled=true
docker rm oom
```

### In this project

- **No container limits are set** in [`docker-compose.yml`](../../docker-compose.yml) today. For a
  single small server, a sensible start would be:

  ```yaml
  # docker-compose.yml, per service
    backend:
      deploy:
        resources:
          limits:   { cpus: "1.0", memory: 512M }
          reservations: { memory: 256M }
      environment:
        NODE_OPTIONS: --max-old-space-size=384
      logging:
        driver: json-file
        options: { max-size: "10m", max-file: "3" }
  ```

  The numbers should come from `docker stats` under real load, not guesses.
- **In production the platform sets the limits.** Render's free plan gives the API a small memory and
  CPU allowance (check Render's pricing page for the current figures) and restarts it if it goes over;
  Vercel limits each server function's memory and run time.
- **The database connection pool is resource management.** Sequelize's pool is capped by `DB_POOL_MAX`
  (default 10, [`backend/src/config/database.js`](../../backend/src/config/database.js)); production runs
  with **3**, because Aiven's free MySQL allows only a few connections. Without the cap a traffic burst
  would open more connections than the database accepts, and requests would fail.
- **Other built-in limits:** a request-rate limit on the public Seat Allocation API
  ([`backend/src/utils/rateLimiter.js`](../../backend/src/utils/rateLimiter.js)), a sign-in lockout after
  too many wrong passwords ([`backend/src/services/authService.js`](../../backend/src/services/authService.js)),
  and every email send gives up after 15 seconds
  ([`backend/src/services/emailService.js`](../../backend/src/services/emailService.js)) so a stuck mail
  server cannot hold requests open.

### At larger scale

- **Kubernetes `requests` and `limits`** per container: the scheduler places containers by their
  requests and enforces the limits. Pods without them are first to be evicted.
- **Autoscaling**: add containers when CPU or request rate is high (Horizontal Pod Autoscaler, ECS
  service auto-scaling), remove them when quiet.
- **Quotas per team or namespace**, so one team cannot use the whole cluster.
- **Right-sizing** from monitoring data (see [Monitoring and logging](deployment-monitoring-logging.md)).

### Common mistakes

- **No limits at all.** One leak takes down the host.
- **Limits too tight.** The container is killed with 137 under normal load; it looks like a random crash.
- **A memory limit without telling Node.** Node's heap may grow past the limit and get killed instead of
  collecting garbage.
- **Treating a CPU limit like a memory limit.** Over the CPU limit you are slowed, not killed; slow
  responses may be throttling.
- **Forgetting disk.** Unrotated logs and old images fill the disk; then everything fails at once.

### Explain it in two minutes

> "Without limits a container can use all the memory and CPU on the machine, so one leak takes everything
> down. Docker lets me cap memory, where going over gets the container killed with exit code 137, and CPU,
> where going over just slows it down. I tested both: a container capped at half a CPU sits at 50% even when
> it spins as hard as it can, and one capped at 32 MB is killed and flagged `OOMKilled`.
>
> Our Compose file has no limits yet; I would add about 512 MB and one CPU for the API, tell Node its heap
> limit, and rotate logs. In production Render enforces limits for us. And resource management is not only
> Docker: our MySQL connection pool is capped at 3 in production because Aiven's free plan allows only a few
> connections."

### Questions you may be asked

- **What happens when a container hits its memory limit?** The kernel's OOM killer stops it: exit 137,
  `OOMKilled: true`. With a restart policy it starts again.
- **And its CPU limit?** It is throttled, never killed.
- **How do you choose the numbers?** Measure normal and peak use (`docker stats`, monitoring), set the
  limit with some headroom, then watch for OOM kills and throttling.
- **Do limits in `deploy:` work outside Swarm?** Yes, with Docker Compose v2 `limits` are applied.
- **What else besides CPU and memory?** Processes (`--pids-limit`), disk (log rotation, prune), open files,
  and outside resources such as database connections.

---

## Custom registries

### In one sentence

A registry is a server that stores and serves images; a custom (private) registry is one your team
controls, so your own images are kept private, close to your servers, and scanned and cleaned up on your terms.

### Why it matters

`docker pull` uses Docker Hub by default, which is public and limits how often anonymous users may pull.
Your own app's images usually must not be public, should be close to where they run, and should be
**built once, then deployed many times**: the same image that passed the tests goes to staging and to
production, which needs a place to keep it.

### Key ideas

| Idea | In plain words |
|---|---|
| **Image name anatomy** | `registry.example.com:5000/team/app:1.4.2`: registry host, then repository path, then tag. No host means Docker Hub. |
| **Tag vs digest** | A tag (`1.4.2`) is a label that can be moved to a new image. A digest (`@sha256:...`) is the image's fingerprint and never changes. |
| **Push / pull** | `docker tag` gives an image the registry's name; `docker push` uploads it; `docker pull` downloads it. |
| **Login** | `docker login <host>`. On Windows the password is kept in Windows Credential Manager. CI uses short-lived tokens, not a person's password. |
| **Hosted registries** | Docker Hub (private repositories), **GitHub Container Registry** (`ghcr.io`), AWS ECR, Google Artifact Registry, Azure Container Registry, GitLab's registry. |
| **Self-hosted registries** | `registry:2` (the basic open-source one), **Harbor** (adds users, scanning, replication), Nexus, Artifactory. |
| **Pull-through cache / mirror** | A local registry that keeps copies of Docker Hub images, to avoid rate limits and speed up pulls. |
| **Retention and immutability** | Rules that delete old images, and that forbid overwriting a tag once pushed. |

### Try it yourself

Run a registry on your own machine, push an image to it, delete it locally and pull it back:

```powershell
docker run -d --name registry -p 127.0.0.1:5000:5000 registry:2
docker build -t sp-api:study D:\Projects\seat-planner\backend
docker tag sp-api:study localhost:5000/seat-planner-api:1.0.0     # same image, a registry name
docker push localhost:5000/seat-planner-api:1.0.0
curl.exe http://localhost:5000/v2/_catalog                        # {"repositories":["seat-planner-api"]}
curl.exe http://localhost:5000/v2/seat-planner-api/tags/list      # {"name":"seat-planner-api","tags":["1.0.0"]}
docker rmi localhost:5000/seat-planner-api:1.0.0
docker pull localhost:5000/seat-planner-api:1.0.0                 # comes back from your registry
docker images --digests localhost:5000/seat-planner-api           # the sha256 digest
docker rm -f -v registry                                          # -v also removes its storage
docker rmi localhost:5000/seat-planner-api:1.0.0 sp-api:study
```

(`localhost` is the one address Docker lets you use without HTTPS. Any other registry host needs TLS.)

### In this project

- **No registry of our own is used today.** Render builds `backend/Dockerfile` straight from the Git
  repository on every deploy, and Vercel builds the web app from source. The only images pulled are
  official ones from Docker Hub: `node:20-alpine`, `mysql:8`, `mongo:7`, `caddy:2-alpine`.
- **What a registry would change**, as a worked design:
  1. CI builds the API image **once** per merge to `master`, tags it with the commit's ID, and pushes it to
     GitHub Container Registry: `ghcr.io/<owner>/seat-planner-api:<commit>`.
  2. Render deploys **that image** (it supports deploying an existing image) instead of rebuilding.
  3. The image that passed CI is exactly the image in production; **rolling back** is choosing the previous
     tag (see [Rollback and disaster recovery](deployment-rollback-dr.md)).

  The CI part would be a few lines in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml):

  ```yaml
  # a new job, after the tests pass on master
    image:
      needs: [backend]
      if: github.ref == 'refs/heads/master'
      runs-on: ubuntu-latest
      permissions: { contents: read, packages: write }    # the token may push packages, nothing more
      steps:
        - uses: actions/checkout@v4
        - uses: docker/login-action@v3
          with: { registry: ghcr.io, username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" }
        - uses: docker/build-push-action@v6
          with:
            context: backend
            push: true
            tags: ghcr.io/${{ github.repository_owner }}/seat-planner-api:${{ github.sha }}
  ```

### At larger scale

- One registry per company (Harbor, Artifactory or a cloud registry), with **projects per team**, access
  rules, **scanning on push**, **signing**, and **replication** to registries near each region.
- **Promotion**: an image moves from `dev` to `staging` to `prod` repositories by copying the same digest,
  never by rebuilding.
- **Retention policies**: keep the last N images per branch, keep every release forever.
- **Mirrors** for Docker Hub so builds do not hit its pull limits.

### Common mistakes

- Pushing private images to a **public** Docker Hub repository.
- Deploying `:latest`: you cannot tell which version runs or roll back to "the previous latest".
- Overwriting a tag (`1.4.2`) with a different image. Make tags immutable.
- Using a person's password in CI instead of a token with only the rights it needs.
- No cleanup: the registry grows forever and costs money.

### Explain it in two minutes

> "A registry stores images. Docker Hub is the public default; a custom registry is one we control, such as
> GitHub Container Registry, a cloud registry, or a self-hosted one like Harbor. An image's name says where
> it lives, `ghcr.io/owner/app:tag`, and its digest is a fingerprint that never changes.
>
> I ran one locally: `registry:2` on port 5000, tagged our API image for it, pushed it, deleted it from my
> machine and pulled it back. Today this project does not use one: Render builds from Git on every deploy.
> With a registry, CI would build the image once, tag it with the commit, and Render would deploy exactly that
> image, so what we tested is what runs, and a rollback is just picking the previous tag."

### Questions you may be asked

- **Why not just use Docker Hub?** You can, with private repositories. Teams choose others to be close to
  their cloud, for access control tied to their organisation, for scanning, or to avoid pull limits.
- **Tag or digest for deploys?** A unique tag (like the commit ID) for people to read; the digest for the
  strongest guarantee. Never `latest`.
- **How does CI log in safely?** A short-lived token with only push rights to that repository, such as
  GitHub's built-in `GITHUB_TOKEN` with `packages: write`.
- **What is Harbor?** An open-source registry that adds users and projects, vulnerability scanning,
  signing and replication on top of the basic registry.
- **How do you clean up old images?** Retention rules in the registry (keep last N, delete untagged), and
  `docker image prune` on build machines.
