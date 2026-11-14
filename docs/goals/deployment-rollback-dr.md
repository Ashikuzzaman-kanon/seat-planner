# Rollback and disaster recovery

Goal: **App Deployment (Intermediate)**, sub-goal *Rollback and Disaster Recovery* (0%).

Two related questions: **"the new version is broken, how do we get back?"** (rollback), and **"something
much bigger went wrong, data or servers are gone, how do we get back?"** (disaster recovery, DR).

---

### In one sentence

Rollback is returning quickly to the last version that worked; disaster recovery is getting the whole
service and its data back after a serious loss, within a time and a data-loss limit you agreed beforehand.

### Why it matters

Every team ships a bad release eventually, and every system eventually loses something: a database, a
region, an account, a table someone dropped. What decides whether it is a five-minute blip or a lost week is
what was prepared **before**: kept versions to go back to, backups that have actually been restored once,
and written steps.

### Key ideas

**Rollback**

| Idea | In plain words |
|---|---|
| **Rollback vs roll forward** | Rollback: put the previous version back. Roll forward (fix forward): ship a quick fix instead. Roll back when the cause is unclear or the fix is not trivial; it is usually the faster, safer first move. |
| **Immutable, versioned releases** | Every release is a kept, labelled artifact (an image tag, a Vercel deployment). Rolling back is choosing the previous one, not rebuilding old code. |
| **The database is the hard part** | Code goes back in seconds; data and schema do not. A rollback is only safe if the **old code still works with the new schema**. |
| **Expand / contract** (also called *parallel change*) | Change the schema in backward-compatible steps: first **add** (new column, old code ignores it), deploy code that uses it, and only **later remove** the old thing. Every step can then be rolled back. |
| **Down migrations** | A migration's undo step. It often **deletes data** (a dropped column takes its values with it), so it is a last resort, not the rollback plan. |
| **Feature flags / kill switches** | Turn a feature off at run time, without a deploy. The fastest rollback of all. |
| **Deployment strategies that make rollback easy** | *Blue-green* (two environments, switch traffic back), *canary* (a small share of users first; stop if errors rise), *rolling* (replace instances gradually). |
| **`git revert`** | Makes a new commit that undoes an old one. History stays intact; the revert itself goes through review and CI. |

**Disaster recovery**

| Idea | In plain words |
|---|---|
| **RPO** (recovery point objective) | How much data you can afford to lose, as time. Nightly backups mean an RPO of up to 24 hours. |
| **RTO** (recovery time objective) | How long you can afford to be down while recovering. |
| **Backups** | Copies of data kept **somewhere else**. The **3-2-1 rule**: 3 copies, on 2 kinds of storage, 1 off-site. |
| **A backup is only real once restored** | Test restores regularly. An untested backup is a hope. |
| **Point-in-time recovery (PITR)** | A full backup plus the database's change log, so you can restore to, say, 10:41, just before the mistake. |
| **Replicas and multi-region** | A standby copy of the database or the whole system elsewhere, to switch to. Expensive; used when the RTO is minutes. |
| **Infrastructure as code** | The servers and settings are described in files (Terraform, Render's `render.yaml`), so they can be recreated, not remembered. |
| **Runbook** | Written step-by-step instructions for a known kind of incident, so whoever is on duty can follow them under stress. |
| **DR drill** | Practising the recovery on purpose, on a schedule, and timing it. |

### Try it yourself

**1. Back up a database, lose it, and restore it** (a throw-away MySQL in Docker):

```powershell
docker run -d --name dr-db -e MYSQL_ROOT_PASSWORD=secret -e MYSQL_DATABASE=shop mysql:8
# wait about 20 seconds for MySQL to start, then:
docker exec dr-db mysql -uroot -psecret shop -e "CREATE TABLE orders (id INT PRIMARY KEY, item VARCHAR(20)); INSERT INTO orders VALUES (1,'ticket'),(2,'refund');"

# the backup: dump inside the container, then copy the file out
docker exec dr-db sh -c "mysqldump -uroot -psecret --single-transaction shop > /tmp/shop.sql"
docker cp dr-db:/tmp/shop.sql .\shop.sql

# the disaster
docker exec dr-db mysql -uroot -psecret shop -e "DROP TABLE orders;"
docker exec dr-db mysql -uroot -psecret shop -e "SELECT * FROM orders;"      # ERROR: table doesn't exist

# the recovery
docker cp .\shop.sql dr-db:/tmp/restore.sql
docker exec dr-db sh -c "mysql -uroot -psecret shop < /tmp/restore.sql"
docker exec dr-db mysql -uroot -psecret shop -e "SELECT * FROM orders;"      # both rows are back

docker rm -f -v dr-db ; Remove-Item .\shop.sql
```

(The dump is written inside the container and copied out on purpose: in Windows PowerShell 5.1, `>`
saves files as UTF-16, which `mysql` cannot read back.)

**2. Roll back by running the previous image tag:**

```powershell
docker run -d --name app -p 8080:80 nginx:1.27-alpine          # "the new release"
curl.exe -sI http://localhost:8080 | Select-String Server       # nginx/1.27.x
docker rm -f app
docker run -d --name app -p 8080:80 nginx:1.26-alpine          # roll back: same command, previous tag
curl.exe -sI http://localhost:8080 | Select-String Server       # nginx/1.26.x
docker rm -f app
```

**3. `git revert`, in a scratch folder:**

```powershell
mkdir $env:TEMP\revert-demo ; cd $env:TEMP\revert-demo ; git init -q
"v1" > app.txt ; git add . ; git commit -qm "release 1"
"v2 (broken)" > app.txt ; git commit -qam "release 2"
git revert --no-edit HEAD ; Get-Content app.txt ; git log --oneline     # back to v1, three commits, nothing rewritten
cd .. ; Remove-Item -Recurse -Force revert-demo
```

### In this project

**Rolling back code**

- **Web app (Vercel):** every deployment is kept with its own address. Rolling back is choosing an earlier
  production deployment in the Vercel dashboard and promoting it (*Instant Rollback*); no rebuild.
- **API (Render):** Render keeps the deploy history; an earlier deploy can be redeployed from the
  dashboard. **The catch:** the container runs `npm run migrate` on start, but going *back* does not undo
  migrations. The old code then runs against the newer schema. That is fine when the migration only
  **added** things. The latest, for example, adds two columns to `user_subscriptions`, which the previous
  code simply does not read
  ([`backend/migrations/20260205000000-subscription-continue.js`](../../backend/migrations/20260205000000-subscription-continue.js)).
  **31 of the 39 migrations only add.** The other 8 change or remove something, so rolling the code back
  past one of them needs checking first. For example,
  [`20260126000000-subscription-version-rules.js`](../../backend/migrations/20260126000000-subscription-version-rules.js)
  moved app-version rules to a new table and, *in the same migration*, dropped the old table and two old
  columns. Code from before it would look for those and fail. The expand/contract way would have been two
  releases: add and copy first, drop a release later.
- **Through Git:** every change arrives as a pull request, so GitHub's *Revert* button on a merged PR opens a
  new PR that undoes it, which then goes through CI like any change.

**Undoing a migration (last resort)**

- Each migration has a `down` step. Its status: `npm run migrate:status`.
- This project's rule: **undo only by name**, never "the last one":
  `npx sequelize-cli db:migrate:undo --name 20260205000000-subscription-continue.js`.
  Plain `migrate:undo` undoes whichever migration ran last, which may not be the one you mean.
- A `down` that removes a column also removes the data in it. Take a backup first.

**Turning a feature off without a deploy**

- **Feature switches** ([`backend/src/services/featureService.js`](../../backend/src/services/featureService.js)):
  each tab can be switched off for everyone, or for chosen users and roles, from Settings. The tab
  disappears and the server refuses the API calls only it makes. Settings itself has no switch, so there is
  always a way back. This is a kill switch: a broken feature is turned off in seconds while the fix is made.

**Recovering from a crash in the middle of work**

- **Durable jobs** ([`backend/src/jobs/index.js`](../../backend/src/jobs/index.js)): work that must not be lost,
  like a cancelled departure's mass refund, is stored in a jobs table with a lease. If the process dies
  half-way, the lease lapses and the next worker picks the job up. The recurring sweeps are written so that
  running them twice is the same as running once.

**A real small disaster**

Aiven powered off the free MySQL database after a period without use. The API's logs showed
`getaddrinfo ENOTFOUND` (the database's name no longer resolved) and every request failed. Recovery: power
the database on in Aiven's console, then redeploy the API on Render. Data was intact. Lessons: free tiers can
be switched off, and an external uptime check would have noticed first
(see [Monitoring and logging](deployment-monitoring-logging.md)).

**The gaps, honestly**

| Gap | Risk | What to add |
|---|---|---|
| **No backups of our own** | If the Aiven service or account is lost, so is the data. What a free managed plan keeps, and for how long, must be checked, not assumed. | A scheduled job (for example a nightly GitHub Actions workflow) running `mysqldump` and storing the file privately, plus `mongodump` for the audit log |
| **No restore ever tested** | Unknown whether a backup would work, or how long it takes | A restore drill into a scratch database; write down the time it took |
| **No written RPO / RTO** | Nobody knows what "recovered" means | A sensible start for this project: RPO 24 hours, RTO 2 hours |
| **No runbook** | Recovery depends on memory | The steps below, kept in the repository |
| **Settings live only in dashboards** | Render and Vercel settings would have to be re-entered by hand | A `render.yaml` blueprint; the variable list is already in the README |

A first runbook, *"the production database is lost"*:

1. Turn on maintenance: switch off the affected tabs with feature switches, or stop the Render service.
2. Create a new MySQL service (Aiven, or any MySQL 8 with TLS).
3. Restore the latest dump into it (`mysql ... < backup.sql`).
4. On Render, change `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`; redeploy (pending migrations run on start).
5. Check `/api/v1/health`, sign in, open a booking; then switch the tabs back on.
6. Write down what was lost (the time between the backup and the failure) and how long it took.

### At larger scale

- **Progressive delivery**: canary releases that roll back **automatically** when error rates rise
  (Argo Rollouts, Flagger, AWS CodeDeploy).
- **Managed databases with PITR** and cross-region replicas; RPO of seconds.
- **Multi-region active-active** for services that must not go down; very costly, used sparingly.
- **Feature-flag platforms** (LaunchDarkly, Unleash, Flagsmith) with gradual rollouts and instant off.
- **Scheduled DR drills** and *chaos engineering* (switching things off on purpose to prove recovery works).
- **Backups protected from deletion** (immutable / write-once storage), so ransomware or a mistaken
  admin cannot delete the backups along with the data.

### Common mistakes

- **Never testing a restore.** The backup turns out empty, incomplete, or takes 14 hours to load.
- **Backups in the same place as the data.** Losing the account loses both.
- **Destructive migrations in the same release as the code change**, so going back is impossible.
- **Relying on `down` migrations** as the rollback plan; they delete data.
- **Rolling back code without thinking about the data** written by the new version in the meantime.
- **No decision rule**: debating fix-forward for an hour while users are affected. Decide in advance:
  "if it is not fixed in 15 minutes, roll back".
- **No written steps**, so recovery depends on whoever happens to remember.

### Explain it in two minutes

> "Rollback is going back to the last version that worked; disaster recovery is getting the service and its
> data back after a serious loss, within limits agreed in advance: the RPO, how much data we can lose, and
> the RTO, how long we can be down.
>
> For rollback this project is in good shape. Vercel keeps every deployment, so the web app goes back in one
> click. Render keeps the API's deploys. The database is the hard part: 31 of our 39 migrations only add
> things, so old code still works after a rollback, but 8 change or remove something, and one dropped the
> old table in the same release that added the new one. Done again, I would split that into
> expand-then-contract over two releases. Undoing a migration is a last resort, by name only. Feature switches let us turn a
> broken tab off in seconds without deploying, and background jobs survive a crash because they are stored
> with a lease.
>
> For DR the honest answer is: we have no backups of our own yet. I practised the procedure, dump, drop,
> restore, on a test MySQL in Docker, and the next step is a nightly dump job and one timed restore drill.
> We had a small real incident when Aiven switched off the free database; recovery was to power it on and
> redeploy."

### Questions you may be asked

- **RPO vs RTO?** RPO: how much data you may lose (time since the last good copy). RTO: how long you may be
  down. Backups mostly set the RPO; preparation and automation set the RTO.
- **How do you roll back a release that included a database change?** Design so you do not have to: make the
  change backward-compatible (expand first, contract in a later release). Then rolling back the code is enough.
- **Rollback or fix forward?** Roll back if the cause is unclear, the impact is large, or the fix is not
  trivial. Fix forward only for a small, obvious fix you can ship faster than a rollback.
- **What makes a good backup strategy?** Automated, off-site (3-2-1), encrypted, kept for a defined time,
  protected from deletion, and restored on a schedule to prove it works.
- **What is a feature flag's role in rollback?** It turns a feature off without a deploy, faster than any
  rollback, and only for the part that is broken.
- **Blue-green vs canary?** Blue-green switches all traffic between two full environments (instant switch
  back). Canary sends a small share to the new version first and grows it while the numbers stay good.
