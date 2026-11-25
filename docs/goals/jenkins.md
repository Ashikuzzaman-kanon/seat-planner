# Jenkins

Goal: **App Deployment (Intermediate)**. Four sub-goals, all at 0%:
[Basics](#basics), [Freestyle project](#freestyle-project), [Pipeline project](#pipeline-project),
[Configuration](#configuration).

This project uses **GitHub Actions**, not Jenkins. So the worked example here is a translation: the
project's real CI file, [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), rewritten line by line
as a Jenkins pipeline. It is for study and has not been run on a Jenkins server. If you want hands-on time,
the [exercise](#try-it-yourself-optional-jenkins-in-docker) runs a real Jenkins in Docker.

---

## Basics

### In one sentence

Jenkins is a free, self-hosted automation server: it watches your repository and, on every change, runs
the jobs you define (build, test, package, deploy) on machines you control, and keeps the results.

### Why it matters

Jenkins is the oldest and still one of the most widely used CI/CD servers, especially in companies that
must run everything on their own machines. Even teams on GitHub Actions or GitLab CI meet it in older
projects, and the ideas (jobs, agents, pipelines as code) carry over to every CI tool.

### Key ideas

| Term | In plain words |
|---|---|
| **Controller** | The Jenkins server itself: web UI, configuration, scheduling, history. (Older name: *master*.) |
| **Agent** (node) | A machine that runs the builds. The controller hands work to agents. (Older name: *slave*.) A label such as `linux && docker` picks suitable agents. |
| **Executor** | One build slot on an agent. An agent with 2 executors runs 2 builds at once. |
| **Job / project** | A configured task: what to check out, when to run, what to do. |
| **Build** | One run of a job, numbered (#1, #2...), with its console log, result and saved files. |
| **Workspace** | The folder on the agent where a job's code is checked out and the build runs. |
| **Plugin** | Almost every feature is a plugin: Git, GitHub, Docker, Node.js, reports. Jenkins itself is small. |
| **Credentials** | Passwords, tokens and keys stored encrypted in Jenkins and handed to builds without showing them in logs. |
| **Trigger** | What starts a build: a webhook from GitHub on push, polling the repository, a timer (cron), another job, or a person. |
| **Artifact** | A file kept from a build (a report, a package). |
| **Freestyle vs Pipeline** | Freestyle jobs are configured by clicking in the UI. Pipeline jobs are code in a `Jenkinsfile` in the repository. |

**How it compares with GitHub Actions** (which this project uses):

| | Jenkins | GitHub Actions |
|---|---|---|
| Where it runs | Your own servers | GitHub's machines (or your own runners) |
| Configuration | UI, or a `Jenkinsfile` (Groovy) | YAML files in `.github/workflows/` |
| Extending | 1,800+ plugins | Marketplace *actions* |
| You look after | The server, its updates, plugins, backups, security | Nothing, for hosted runners |
| Typical fit | Companies needing everything on-premises, complex or long-lived setups | Projects already on GitHub |

### Explain it in two minutes

> "Jenkins is a self-hosted automation server. A controller holds the configuration and the UI, and agents,
> the machines with the right tools, run the builds. A job says what to check out, when to run and what to
> do; each run is a numbered build with its log and saved files. Nearly everything is a plugin: Git, Docker,
> Node.js, test reports.
>
> There are two kinds of job: freestyle, configured by clicking, and pipeline, written as a `Jenkinsfile`
> in the repository, which is the modern way. This project uses GitHub Actions for the same purpose, so to
> show I understand Jenkins I translated our CI file into a Jenkinsfile, step by step."

### Questions you may be asked

- **Controller vs agent?** The controller schedules and stores; agents execute. Builds should not run on
  the controller itself (set its executors to 0), for security and stability.
- **How does Jenkins know there was a push?** A GitHub webhook calls Jenkins (`/github-webhook/`); polling
  the repository is the fallback when Jenkins cannot be reached from the internet.
- **Where does Jenkins keep everything?** In `JENKINS_HOME`: jobs, build history, plugins, credentials,
  configuration. Back that folder up.
- **Why are plugins a risk as well as a strength?** Each one is code with its own updates and
  vulnerabilities; too many plugins make upgrades fragile. Keep few, keep them updated.

---

## Freestyle project

### In one sentence

A freestyle project is a Jenkins job set up entirely through web forms: where the code is, when to build,
which shell commands to run, and what to do with the results.

### Why it matters

It is the quickest way to automate something simple, and many existing Jenkins setups are made of
freestyle jobs. Knowing it also shows *why* pipelines replaced it.

### Key ideas

A freestyle job's configuration page has these sections, top to bottom:

| Section | What you set | This project's equivalent |
|---|---|---|
| **General** | Description, discard old builds, parameters, "do not allow concurrent builds" | `concurrency:` in `ci.yml` |
| **Source Code Management** | Git URL, credentials, branch (`*/master`) | `actions/checkout` |
| **Build Triggers** | GitHub hook trigger, poll SCM, build periodically (`H 2 * * *`), after other projects | `on: push / pull_request` |
| **Build Environment** | Delete workspace first, add timestamps, abort if stuck (timeout), provide Node.js, bind credentials to variables | `timeout-minutes`, `setup-node`, `env:` |
| **Build Steps** | One or more *Execute shell* (or *Windows batch*) boxes | the `run:` lines |
| **Post-build Actions** | Archive artifacts, publish test and HTML reports, email on failure, trigger another job | `upload-artifact`, the coverage summary |

**Limits of freestyle**, which is why it is now used only for small jobs:

- The configuration lives in Jenkins, not in Git: no review, no history next to the code, lost if Jenkins is lost.
- One linear list of steps: no stages, no parallel branches, awkward conditions.
- Pull requests and many branches need a separate job each, set up by hand.

### Worked example: the backend tests as a freestyle job

- **Source Code Management:** Git, the repository URL, branch `*/master`.
- **Build Triggers:** *GitHub hook trigger for GITScm polling*.
- **Build Environment:** *Abort the build if it's stuck*, 20 minutes; *Provide Node & npm*, `node-20`
  (from the NodeJS plugin).
- **Build Steps**, one *Execute shell*:

```bash
set -e
# the two databases ci.yml gets as "services:"
docker run -d --rm --name ci-mysql-$BUILD_NUMBER -e MYSQL_ROOT_PASSWORD=root -p 3306:3306 mysql:8.0
docker run -d --rm --name ci-mongo-$BUILD_NUMBER -p 27017:27017 mongo:7
trap 'docker stop ci-mysql-$BUILD_NUMBER ci-mongo-$BUILD_NUMBER' EXIT     # always clean up
until docker exec ci-mysql-$BUILD_NUMBER mysqladmin ping -h 127.0.0.1 -proot --silent; do sleep 2; done

export DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASS=root
export TEST_DB_NAME=seat_planner_test TEST_MONGO_URI=mongodb://127.0.0.1:27017/seat_planner_test
export JWT_SECRET=ci-only-secret

cd backend
npm ci
npm run coverage
npx c8 report --reporter=text-summary || true
```

- **Post-build Actions:** *Archive the artifacts* `backend/coverage/lcov.info`; *Publish HTML reports*,
  directory `backend/coverage`, index page `index.html`.

### Explain it in two minutes

> "A freestyle project is a job configured through forms: source code, triggers, build environment, build
> steps and post-build actions. For our backend tests I would point it at the repository, trigger it from a
> GitHub webhook, give it Node 20 and a 20-minute timeout, and have one shell step start MySQL and MongoDB in
> Docker, run `npm ci` and `npm run coverage`, then archive and publish the coverage report.
>
> It works, but the configuration lives only inside Jenkins, so it is not reviewed or versioned with the code,
> and it cannot run the frontend build in parallel or handle pull requests nicely. That is why the pipeline
> project, with a Jenkinsfile in the repository, replaced it."

### Questions you may be asked

- **When would you still use freestyle?** For a small, stable, one-off task: a nightly cleanup script, a
  quick experiment.
- **How do you pass a secret to a freestyle build?** *Use secret text(s) or file(s)* in Build Environment
  binds a stored credential to an environment variable, masked in the log.
- **How do you make one job start another?** *Build other projects* in post-build actions, or the
  *Parameterized Trigger* plugin to pass values along.

---

## Pipeline project

### In one sentence

A pipeline project describes the whole build, test and deploy process as code, in a `Jenkinsfile` kept in
the repository, divided into stages that Jenkins shows and runs, in order or in parallel.

### Why it matters

**Pipeline as code** means the CI process is reviewed, versioned and branched with the code it builds. It
handles stages, parallel work, conditions, approvals and many branches, which freestyle cannot do well.

### Key ideas

| Term | In plain words |
|---|---|
| **Jenkinsfile** | The pipeline's code, in the repository root. Written in Groovy. |
| **Declarative** vs **scripted** | Declarative (`pipeline { ... }`) is a fixed, readable structure: use it. Scripted (`node { ... }`) is plain Groovy, more power, more ways to go wrong. A `script { }` block lets declarative use a little scripted code. |
| **`agent`** | Where to run: `any`, a label, a Docker image, or `none` at the top so each stage picks its own. |
| **`stages` / `stage` / `steps`** | The phases (Build, Test, Deploy) and the commands in each. |
| **`environment`** | Environment variables; `credentials('id')` fills one from a stored secret, masked in logs. |
| **`options`** | Timeouts, keeping only the last N builds, no concurrent builds. |
| **`when`** | Run a stage only on some condition: a branch, a pull request, a parameter. |
| **`parallel`** | Stages that run at the same time. |
| **`post`** | What to do after: `always`, `success`, `failure`, `unstable`, `changed`. |
| **`input`** | Pause for a person to approve, for example before deploying to production. |
| **Multibranch pipeline** | One job that finds every branch and pull request with a Jenkinsfile and builds each. This is what matches GitHub Actions' `on: push / pull_request`. |
| **Shared library** | Pipeline code shared by many repositories, kept in its own repository. |

### Worked example: `ci.yml` as a Jenkinsfile

How each piece of [`ci.yml`](../../.github/workflows/ci.yml) maps to Jenkins:

| GitHub Actions (`ci.yml`) | Jenkins | Note |
|---|---|---|
| `on: push: [master, demo]`, `pull_request` | A **Multibranch Pipeline** job with the GitHub Branch Source plugin; filter branches to `master demo PR-*` | Triggered by GitHub's webhook |
| `concurrency: ... cancel-in-progress: true` | `disableConcurrentBuilds(abortPrevious: true)` | Multibranch makes one job per branch, so this is per branch, like `ci-${{ github.ref }}` |
| two `jobs:` that run side by side | two stages inside `parallel { }` | |
| `runs-on: ubuntu-latest` | `agent { label 'linux && docker' }` | Your own machine with that label |
| `timeout-minutes: 20` | `options { timeout(time: 20, unit: 'MINUTES') }` | |
| `services: mysql, mongo` with health checks | `docker.image(...).withRun(...)` (Docker Pipeline plugin), then wait until healthy | Containers stop when the block ends |
| `defaults: run: working-directory: backend` | `dir('backend') { ... }` | |
| `env:` | `environment { ... }` | A real secret would be `credentials('id')` |
| `actions/checkout@v4` | `checkout scm` | With `skipDefaultCheckout()` so it is explicit |
| `actions/setup-node@v4`, `node-version: 20` | `tools { nodejs 'node-20' }` | A Node.js installation named `node-20` under *Tools* |
| `cache: npm` | Nothing: a long-lived agent keeps `~/.npm` between builds | |
| `run: npm ci` | `sh 'npm ci'` | |
| `if: always()` | `post { always { ... } }` | |
| `$GITHUB_STEP_SUMMARY` | The console log, and the HTML Publisher plugin for the report | |
| `actions/upload-artifact@v4` | `archiveArtifacts` | |

The Jenkinsfile:

```groovy
// The same checks as .github/workflows/ci.yml, as a Jenkins declarative pipeline.
// Study example; this project runs on GitHub Actions. Plugins it assumes: Pipeline,
// GitHub Branch Source (multibranch), NodeJS, Docker Pipeline, HTML Publisher.

// Waits for a container's own health check to pass (ci.yml's "options: --health-*").
def waitUntilHealthy(String containerId) {
  sh "timeout 150 sh -c 'until [ \"\$(docker inspect -f {{.State.Health.Status}} ${containerId})\" = healthy ]; do sleep 2; done'"
}

pipeline {
  agent none                                       // each stage chooses its own agent, as each job has runs-on

  options {
    skipDefaultCheckout()                          // check out explicitly, like actions/checkout
    disableConcurrentBuilds(abortPrevious: true)   // concurrency: cancel-in-progress
    buildDiscarder(logRotator(numToKeepStr: '30'))
  }

  stages {
    stage('CI') {
      parallel {

        stage('Backend tests') {                                   // jobs.backend
          agent { label 'linux && docker' }                        // runs-on
          tools { nodejs 'node-20' }                               // setup-node, node-version: 20
          options { timeout(time: 20, unit: 'MINUTES') }           // timeout-minutes: 20
          environment {                                            // env:
            DB_HOST        = '127.0.0.1'
            DB_PORT        = '3306'
            DB_USER        = 'root'
            DB_PASS        = 'root'
            TEST_DB_NAME   = 'seat_planner_test'
            TEST_MONGO_URI = 'mongodb://127.0.0.1:27017/seat_planner_test'
            JWT_SECRET     = 'ci-only-secret'                      // a real secret: credentials('jwt-secret')
          }
          steps {
            checkout scm                                           // actions/checkout
            script {
              // services: mysql and mongo, published on the agent like GitHub's ports: lines
              docker.image('mysql:8.0').withRun('-e MYSQL_ROOT_PASSWORD=root -p 3306:3306 ' +
                  '--health-cmd="mysqladmin ping -h 127.0.0.1 -proot" --health-interval=5s --health-timeout=5s --health-retries=30') { mysql ->
                docker.image('mongo:7').withRun('-p 27017:27017 ' +
                    '--health-cmd="mongosh --quiet --eval \'db.runCommand({ ping: 1 }).ok\'" --health-interval=5s --health-timeout=5s --health-retries=30') { mongo ->
                  waitUntilHealthy(mysql.id)
                  waitUntilHealthy(mongo.id)
                  dir('backend') {                                 // working-directory: backend
                    sh 'npm ci'
                    sh 'npm run coverage'                          // "Tests and coverage"
                  }
                }
              }
            }
          }
          post {
            always {                                               // if: always()
              dir('backend') {
                sh 'npx c8 report --reporter=text-summary || true' // "Coverage summary", into the console log
              }
              publishHTML(target: [reportName: 'Backend coverage', reportDir: 'backend/coverage',
                                   reportFiles: 'index.html', allowMissing: true,
                                   keepAll: true, alwaysLinkToLastBuild: true])
              archiveArtifacts artifacts: 'backend/coverage/lcov.info', allowEmptyArchive: true   // upload-artifact
            }
          }
        }

        stage('Frontend build') {                                  // jobs.frontend
          agent { label 'linux' }
          tools { nodejs 'node-20' }
          options { timeout(time: 15, unit: 'MINUTES') }
          environment {
            NEXT_PUBLIC_API_BASE_URL = '/api'
            NEXT_TELEMETRY_DISABLED  = '1'
          }
          steps {
            checkout scm
            dir('frontend') {
              sh 'npm ci'
              sh 'npm test'                                        // the seat-plan editor's own logic
              sh 'npm run build'
            }
          }
        }
      }
    }
  }
}
```

**Adding deployment** would be one more stage after `CI`, only on `master`, optionally waiting for a person:

```groovy
    stage('Deploy API') {
      when { branch 'master' }
      agent { label 'linux' }
      steps {
        input message: 'Deploy to production?'                     // a manual approval gate
        withCredentials([string(credentialsId: 'render-deploy-hook', variable: 'HOOK')]) {
          sh 'curl -fsS -X POST "$HOOK"'                           // Render's deploy hook starts a deploy
        }
      }
    }
```

### Explain it in two minutes

> "A pipeline project keeps the whole process as code in a Jenkinsfile, next to the code it builds. A
> declarative pipeline has an agent, stages with steps, environment variables, options like timeouts, and a
> post section for clean-up and reports. A multibranch pipeline builds every branch and pull request that has
> a Jenkinsfile.
>
> I translated our GitHub Actions CI into one. The two jobs become two parallel stages. `runs-on` becomes an
> agent label; the MySQL and MongoDB services become Docker containers started with `withRun` and waited on
> until healthy; `setup-node` becomes the NodeJS tool; `if: always()` becomes `post { always }`; and the
> coverage upload becomes `archiveArtifacts`. Deploying would be one more stage, only on master, behind an
> `input` approval."

### Questions you may be asked

- **Declarative or scripted?** Declarative, for readability and built-in checks; use a `script { }` block for
  the occasional bit of logic.
- **How do you keep secrets out of the Jenkinsfile?** Store them as Jenkins credentials; use
  `credentials('id')` in `environment` or `withCredentials`. Jenkins masks them in the log.
- **How do you run stages in parallel?** A `parallel { }` block of stages, each possibly on its own agent.
- **How do you share pipeline code between repositories?** A *shared library*: Groovy in its own
  repository, loaded with `@Library('name') _`.
- **How do you add a manual approval?** The `input` step, ideally outside an agent so it does not hold an
  executor while waiting.
- **How do you test a Jenkinsfile before committing?** The *Replay* button on a build, the declarative
  linter (`Pipeline Syntax` page or the CLI's `declarative-linter`), and a feature branch in a multibranch job.

---

## Configuration

### In one sentence

Configuring Jenkins means setting up the controller once (security, tools, agents, credentials and
plugins) so that jobs can run safely, and keeping that set-up reproducible and backed up.

### Why it matters

A Jenkins server can deploy to production and holds every secret your pipelines use. A badly configured
one (open sign-up, builds running on the controller, outdated plugins) is a well-known way into a company.
A configured-by-hand one that nobody can rebuild is a single point of failure.

### Key ideas

Everything is under **Manage Jenkins**:

| Page | What you configure |
|---|---|
| **System** | Jenkins URL, number of executors on the built-in node (set to **0**), global environment variables, GitHub server connection, email |
| **Tools** | Named installations of JDK, Git, Node.js, Maven, which jobs refer to by name (`node-20`) |
| **Plugins** | Install, update, remove plugins. Keep the list short and current |
| **Nodes** (and *Clouds*) | Agents: permanent machines connected over SSH or as inbound agents, or agents started on demand in Docker or Kubernetes. Each has labels and an executor count |
| **Credentials** | Stored secrets: username + password, secret text (tokens), SSH keys, secret files; scoped *Global* (for jobs) or *System* (for Jenkins itself) |
| **Security** | How people sign in (Jenkins' own users, LDAP, GitHub or Google sign-in) and what they may do (*Matrix-based* or *Project-based* authorization); CSRF protection; agent-to-controller rules |
| **System Log** and **Script Console** | Diagnostics. The Script Console runs any code as Jenkins: admin only |

**Configuration as Code (JCasC)**: instead of clicking, describe the configuration in a `jenkins.yaml`
that the *Configuration as Code* plugin applies at start-up. It is reviewed in Git and makes the server
rebuildable. A sketch for this project:

```yaml
# jenkins.yaml, read by the Configuration as Code plugin
jenkins:
  systemMessage: "Seat Planner CI"
  numExecutors: 0                          # no builds on the controller
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: admin
          password: ${JENKINS_ADMIN_PASSWORD}   # from the environment, not the file
  authorizationStrategy:
    loggedInUsersCanDoAnything:
      allowAnonymousRead: false
tool:
  nodejs:
    installations:
      - name: node-20                      # the name the Jenkinsfile's tools { nodejs 'node-20' } uses
        properties:
          - installSource:
              installers:
                - nodeJSInstaller:
                    id: "20.18.0"
credentials:
  system:
    domainCredentials:
      - credentials:
          - string:
              scope: GLOBAL
              id: render-deploy-hook
              secret: ${RENDER_DEPLOY_HOOK}
unclassified:
  location:
    url: https://jenkins.example.com/
```

Plugins themselves are listed in a `plugins.txt` and installed into a custom image with
`jenkins-plugin-cli --plugin-file plugins.txt`, so the whole server is a Dockerfile plus two text files.

**Other configuration habits:**

- **Back up `JENKINS_HOME`** (or rely on JCasC plus job definitions in Git, and back up only build history).
- **Webhooks**: GitHub repository → *Settings → Webhooks* → `https://<jenkins>/github-webhook/`.
- **Keep Jenkins and plugins updated**; use the LTS (long-term support) line.
- **Agents in containers** so every build starts clean.

### Try it yourself (optional): Jenkins in Docker

About 15 minutes; needs no changes to this project.

```powershell
docker run -d --name jenkins -p 127.0.0.1:8081:8080 -v jenkins_home:/var/jenkins_home jenkins/jenkins:lts-jdk21
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword      # the one-time unlock password
```

1. Open http://localhost:8081, paste the password, choose **Install suggested plugins**, create an admin user.
2. **A freestyle job:** *New Item* → `hello-freestyle` → *Freestyle project*. Add an *Execute shell* step:
   `echo "Build $BUILD_NUMBER on $NODE_NAME"; uname -a; date > built.txt`. Add the post-build action
   *Archive the artifacts* `built.txt`. Save, *Build Now*, open the build's *Console Output*.
3. **A pipeline job:** *New Item* → `hello-pipeline` → *Pipeline*. Paste this as the script and build it twice:

```groovy
pipeline {
  agent any
  parameters { booleanParam(name: 'DEPLOY', defaultValue: false, description: 'Run the deploy stage?') }
  environment { GREETING = 'hello' }
  options { timeout(time: 5, unit: 'MINUTES') }
  stages {
    stage('Build') {
      steps {
        sh 'echo "$GREETING from build $BUILD_NUMBER" > result.txt'
        sh 'cat result.txt'
      }
    }
    stage('Test') {
      parallel {
        stage('Unit') { steps { sh 'echo unit tests pass' } }
        stage('Lint') { steps { sh 'echo lint passes' } }
      }
    }
    stage('Deploy') {
      when { expression { params.DEPLOY } }
      steps { echo 'Deploying...' }
    }
  }
  post {
    always  { archiveArtifacts artifacts: 'result.txt' }
    success { echo 'All green' }
    failure { echo 'Something failed' }
  }
}
```

   The stage view shows Build, the two parallel Test stages, and Deploy skipped. After the first run the
   job has a *Build with Parameters* button; tick `DEPLOY` and Deploy runs.
4. **Configuration:** open *Manage Jenkins* and find each page from the table above. Under *Credentials*
   add a *Secret text*; under *Nodes* see the built-in node and its executors.
5. Clean up: `docker rm -f jenkins` and, to delete its data too, `docker volume rm jenkins_home`.

### In this project

There is no Jenkins here. The same jobs are done by GitHub Actions:
[`ci.yml`](../../.github/workflows/ci.yml) (tests and builds on every push and pull request) and
[`android.yml`](../../.github/workflows/android.yml) (builds the Android app; on a tag `android-v*`,
publishes a signed release). The worked examples above translate the first of them.

### At larger scale

- **Agents on Kubernetes**: each build gets a fresh pod with exactly the containers it needs, then it is
  thrown away (Kubernetes plugin).
- **Shared libraries** give every team the same, maintained pipeline steps.
- **CloudBees CI** (commercial Jenkins) for many controllers, central management and support.
- Many companies are **moving from Jenkins** to GitHub Actions, GitLab CI or cloud pipelines to stop
  running the server themselves; knowing both, and how to translate between them, is the useful skill.

### Common mistakes

- Running builds on the controller (executors above 0 on the built-in node).
- Leaving sign-up open or giving anonymous users read access to builds (logs can leak details).
- Secrets typed into job configuration or the Jenkinsfile instead of credentials.
- Dozens of unused, outdated plugins.
- Configuration only in the UI, never backed up.
- Exposing Jenkins to the internet without HTTPS and proper sign-in.

### Explain it in two minutes

> "Jenkins is configured under Manage Jenkins: the System page for the URL and executors (the controller
> itself should run no builds), Tools for named installations like Node 20 that jobs refer to, Plugins,
> Nodes for agents, Credentials for secrets that pipelines use without ever seeing them in plain text, and
> Security for who can sign in and what they may do.
>
> The modern habit is Configuration as Code: a `jenkins.yaml` with all of that, plus a list of plugins, built
> into a Docker image, so the server can be rebuilt from Git instead of from memory. I wrote a sketch of that
> for this project, with no builds on the controller, no sign-up, Node 20 as a tool, and the deploy hook as a
> stored credential."

### Questions you may be asked

- **How do you secure a Jenkins server?** HTTPS; no anonymous access or sign-up; matrix or project-based
  permissions; zero executors on the controller; credentials for every secret; plugins kept updated; and
  agent-to-controller security left on.
- **What is JCasC?** The Configuration as Code plugin: Jenkins' whole system configuration in YAML, applied at
  start-up, versioned in Git.
- **How do agents connect?** The controller connects to them over SSH, or they connect to the controller
  (inbound agents); or a cloud plugin starts them on demand in Docker or Kubernetes.
- **What would you back up?** `JENKINS_HOME`, or at least its job configurations, credentials (with the
  `secrets` folder that decrypts them) and plugin list, unless all of that is already in JCasC and Git.
