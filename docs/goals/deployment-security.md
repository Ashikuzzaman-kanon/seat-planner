# Security in application deployment

Goal: **App Deployment (Intermediate)**, sub-goal *Security in Application Deployment* (0%).

Container-specific security (non-root images, scanning, capabilities) is on
[Docker, advanced](docker-advanced.md#docker-security). This page is the wider picture: everything
between a developer's commit and a request being answered in production.

The checks marked *(checked 2026-11-15)* were run against this repository and the live site on that day,
read-only.

---

### In one sentence

Deployment security means protecting every step from code to running service (the code and its
dependencies, the build, the secrets, the network path, the running app, and the people with access),
so that one weak step does not open the rest.

### Why it matters

Most real breaches are not clever attacks on the code. They are a secret committed to Git, a database left
open to the internet, an old library with a known flaw, an over-powered CI token, or a test environment
wired to real data. Each is a deployment decision, not an application bug.

### Key ideas

Think of it as layers. An attacker has to get through all of them; each one you add is called
**defence in depth**.

| Layer | What to protect | The usual tools |
|---|---|---|
| **Code and dependencies** (the *supply chain*) | Third-party packages with known flaws, or malicious ones | Lock files (`package-lock.json`, `npm ci`), `npm audit`, Dependabot or Renovate, image scanning |
| **Build and CI** | The pipeline can deploy to production, so it is a target | Least-privilege tokens, protected branches, required reviews and checks, pinned versions of CI actions |
| **Secrets** | Passwords, signing keys, API keys | Never in Git or images; injected at run time from the platform's secret store or a secrets manager; rotated |
| **Transport** | Data on the wire | HTTPS everywhere (TLS), HSTS so browsers never fall back to HTTP, TLS to the database with certificate checks |
| **Network** | What can be reached at all | Only the entry point is public; databases private or IP-restricted; firewalls |
| **The running app** | Requests themselves | Authentication, authorization (permissions), input validation, CORS allow-list, rate limits, bot checks, security headers, no stack traces to users |
| **People and access** | Accounts on GitHub, Vercel, Render, Aiven | Two-factor sign-in, fewest people with production access, separate accounts, no shared passwords |
| **Data** | What is stored | Hashed passwords, encryption at rest (managed DBs do this), backups, separate test data |
| **Detection** | Knowing something happened | Audit trail, logs, alerts (see [Monitoring and logging](deployment-monitoring-logging.md)) |

Some terms you will hear:

- **Least privilege**: every account, token and container gets only the rights it needs.
- **Shift left**: catch problems early (in the editor or in CI), not in production.
- **SAST / DAST**: *static* analysis reads the code for flaws; *dynamic* testing attacks the running app (for example OWASP ZAP).
- **OWASP Top 10**: the standard list of the most common web app weaknesses (broken access control, injection, and so on).
- **CVE**: a public ID for a known vulnerability.
- **CORS**: the browser rule that decides which *other websites* may call your API from their pages.
- **HSTS**: a header telling browsers "only ever use HTTPS for this site".

### Try it yourself

```powershell
cd D:\Projects\seat-planner\backend
npm audit --omit=dev                     # known flaws in the production dependencies

# The live site's security headers (read-only):
curl.exe -sI https://seat-planner-sable.vercel.app/login
curl.exe -sI https://seat-planner-api.onrender.com/api/v1/health

# Does the API answer a page from another website? (CORS)
curl.exe -s -D - -o NUL -H "Origin: https://seat-planner-sable.vercel.app" https://seat-planner-api.onrender.com/api/v1/health
curl.exe -s -D - -o NUL -H "Origin: https://evil.example" https://seat-planner-api.onrender.com/api/v1/health

# Scan the whole Git history for committed secrets (shows findings with the secret hidden):
docker run --rm -v "D:/Projects/seat-planner:/repo" zricethezav/gitleaks:v8.21.2 git /repo --redact --no-banner
```

What to look for: in the headers, `Strict-Transport-Security` (good) and `X-Powered-By` (tells an
attacker the framework; better hidden). In the CORS test, the first answer carries
`access-control-allow-origin`, the second does not.

### In this project

**Secrets**

- `.env` is in [`.gitignore`](../../.gitignore) and both `.dockerignore` files; only `.env.example` (no
  real values) is committed. Production secrets live in Render's and Vercel's settings.
- *(checked)* A gitleaks scan of the whole Git history found **16 "possible secrets", all false positives**:
  seat-plan keys such as `EKOTA-CABIN-48` and a deliberately fake token in a test. This is normal; scanners
  are cautious, and someone has to look. Real teams record reviewed false positives in a `.gitleaksignore`.
- CI uses a throw-away `JWT_SECRET: ci-only-secret` and a database that exists only for that run
  ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).

**Transport**

- *(checked)* The web app redirects HTTP to HTTPS (`308`) and sends **HSTS** with a two-year `max-age`
  (Vercel does this). The API is HTTPS-only on Render.
- Self-hosted, Caddy gets and renews a certificate automatically ([`Caddyfile`](../../Caddyfile)).
- The connection to Aiven MySQL is encrypted (`DB_SSL=true`). **But** the certificate is not verified by
  default, because no CA file is shipped
  ([`backend/src/config/database.js`](../../backend/src/config/database.js), lines 5-9): encrypted, but a
  machine in the middle could pose as the database. The fix is to ship Aiven's CA certificate and set
  `DB_SSL_REJECT_UNAUTHORIZED=true`.

**Network**

- Self-hosted: only Caddy is published; MySQL is not reachable from outside and MongoDB only from the
  machine itself ([`docker-compose.yml`](../../docker-compose.yml)).
- In production the database is a managed service reached over TLS with a password.

**The running app**

- **Passwords** are hashed with bcrypt (`bcryptjs`), and repeated wrong passwords pause sign-in for that
  email address for a configurable time ([`backend/src/services/authService.js`](../../backend/src/services/authService.js)).
- **Routes check permissions** ([`backend/src/middleware/authorize.js`](../../backend/src/middleware/authorize.js)),
  and **input is validated** before it reaches the services
  ([`backend/src/middleware/validate.js`](../../backend/src/middleware/validate.js)).
- **CORS allow-list** ([`backend/src/utils/allowedOrigin.js`](../../backend/src/utils/allowedOrigin.js)):
  only the listed origins, with a careful `*` that matches one piece of a host name and never a dot, so
  `seat-planner-x.evil.com` cannot pass as a Vercel preview. *(checked)* The live API answers the real site
  with `access-control-allow-origin` and refuses another origin. The refusal currently comes back as a
  `500` error rather than a `403`: safe, but untidy, and it writes an error to the log each time.
- **The public Seat Allocation API** only answers through the web app: the app proves it with a shared
  `PUBLIC_EDGE_SECRET`, compared in constant time so the comparison's timing does not leak it
  ([`backend/src/utils/publicRequest.js`](../../backend/src/utils/publicRequest.js)); it is rate-limited and
  can require a Cloudflare Turnstile bot check.
- **No stack traces in production:** the error handler adds the stack only outside production, and only
  our own error codes are passed on, never system ones such as `ECONNREFUSED`
  ([`backend/src/middleware/errorHandler.js`](../../backend/src/middleware/errorHandler.js)).
- **Audit trail:** sensitive actions are recorded in MongoDB
  ([`backend/src/services/auditService.js`](../../backend/src/services/auditService.js)). For the
  subscription check API the record keeps the reason, while the caller only ever sees *valid: false*.

**Supply chain**

- `npm ci` installs exactly what `package-lock.json` says, in CI and in the image.
- Next.js was upgraded for **CVE-2025-66478** when it was announced: the textbook response.
- No automatic check yet: there is no Dependabot and no scan in CI, and the image scan on
  [Docker, advanced](docker-advanced.md#docker-security) found dependency updates waiting.

**Gaps worth saying out loud**

| Gap | Why it matters | The fix |
|---|---|---|
| Vercel **preview deployments use the production API and data** | Anyone testing a branch works on real data | A separate staging API and database for previews |
| Database certificate not verified | Encrypted, but open to impersonation | Ship the CA, set `DB_SSL_REJECT_UNAUTHORIZED=true` |
| API has no security headers (`X-Powered-By: Express` is visible) | Small, but free to fix | `app.disable("x-powered-by")` and the `helmet` middleware |
| No dependency or image scan in CI | Known flaws arrive unnoticed | Dependabot, plus `npm audit --audit-level=high` or Trivy as a CI step |
| `ci.yml` does not set `permissions:` | The CI token gets the repository default | `permissions: { contents: read }` at the top, as `android.yml` already does for its job |

### At larger scale

- **Secrets managers** (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault) with automatic rotation and
  an audit log of who read what.
- **Single sign-on and short-lived credentials**: engineers get temporary production access when needed
  and it expires; CI authenticates to the cloud with OpenID Connect instead of stored keys.
- **Policy as code**: rules like "no public databases" or "images must be signed" checked automatically.
- **A web application firewall (WAF)** and DDoS protection in front of the app (Cloudflare, AWS WAF).
- **Separate environments and accounts**: development, staging and production cannot reach each other's data.
- **Regular penetration tests** and a security review in the release process.

### Common mistakes

- Committing `.env`, or a key "just for a minute". Git keeps it forever; rotate the key, do not just delete the file.
- Test or preview environments connected to production data.
- `CORS: *` together with cookies or tokens.
- One admin account shared by the team; no two-factor sign-in.
- Error pages that show stack traces or SQL.
- A CI token or cloud key with full admin rights.
- Updating dependencies only when something breaks.
- Treating HTTPS to the browser as "done" while the database connection is unverified.

### Explain it in two minutes

> "Deployment security is about every step from commit to production, because most breaches come from a
> leaked secret, an open database or an old library, not from clever attacks.
>
> In this project: secrets never enter Git or the images; they live in Render's and Vercel's settings. I
> scanned the whole history with gitleaks: sixteen hits, all false positives, like seat-plan keys. The site
> forces HTTPS and sends HSTS; the API allows only our own origins through CORS, which I checked live; every
> route checks permissions and validates input; passwords are bcrypt-hashed with a lockout; errors never
> show stack traces in production; and sensitive actions go to an audit trail.
>
> And I would be upfront about what is missing: preview deployments share production data, the database
> certificate is not verified, and nothing scans dependencies automatically. Each has a small, known fix."

### Questions you may be asked

- **Where should secrets live?** In the platform's secret settings or a secrets manager, injected at run
  time. Never in Git, images, logs, or front-end code.
- **A secret was committed. What now?** Rotate it first (it is already compromised), then remove it from
  history if needed, then add scanning so it does not happen again.
- **What is least privilege?** Every user, token and service gets only the access it needs, so one
  compromise stays small.
- **What does CORS protect, and what does it not?** It stops *other websites' pages* from calling your API
  through a visitor's browser. It does not stop scripts or servers calling the API directly; that is what
  authentication and rate limits are for.
- **What is HSTS?** A response header telling browsers to use only HTTPS for the site, for a set time, so
  a downgrade to HTTP is not possible.
- **How do you keep dependencies safe?** Lock files and `npm ci`, automated update pull requests, a scan in
  CI that fails on high-severity findings, and acting quickly on announced CVEs.
- **Why separate staging from production?** So testing cannot damage or expose real data, and a bad change
  is caught before customers see it.
