# Multiply productivity using AI

Goal: **Multiply productivity using AI**, six sub-goals, all at 0%:
[AI skills](#ai-skills), [AI agents](#ai-agents), [Git worktrees for parallel work](#git-worktrees-for-parallel-work),
[A proper AI setup](#a-proper-ai-setup), [Keeping up to date](#keeping-up-to-date),
[Productivity: measuring 200%](#productivity-measuring-200).

This goal is likely judged on everyday work more than on a presentation. So this page is a **summary**: what
each sub-goal means, how it shows up in this project's history, and the numbers to back it up. The tool
used throughout is **Claude Code** (in the terminal and the VS Code extension); the ideas apply to other
AI coding tools too.

All numbers come from this repository's Git history and GitHub, as of 2026-11-15.

---

## AI skills

### In one sentence

A skill is a packaged set of instructions (and optionally scripts and reference files) that teaches an AI
assistant how to do one kind of task well, loaded only when that task comes up.

### Why it matters

Without skills you re-explain the same procedure every time ("our charts use these colours", "review code
this way"), and the result varies. A skill writes the procedure down once, so the assistant follows it the
same way every time, and the whole team gets the same quality.

### Key ideas

- **What a skill is (in Claude Code):** a folder with a `SKILL.md` file. Its header has a `name` and a
  `description`; the body has the instructions. It can carry scripts and reference documents alongside.
- **Loaded on demand:** only the short description is always visible to the assistant; the full
  instructions load when a task matches. So many skills can be installed without crowding the context.
- **Where they live:** personal (`~/.claude/skills/`), per project (`.claude/skills/`, shared through Git),
  or in plugins. Many can also be started by name, like a command: `/skill-name`.
- **Good candidates:** anything you do repeatedly with a fixed procedure or house style: release notes,
  code review checklist, a chart style, a migration template, a test-writing pattern.
- **A skill is not a model upgrade:** it is a written, reusable procedure. Its quality is the quality of
  the instructions in it.

### In this project

- **Skills used in this work:** *dataviz* (a procedure for charts that checks colour palettes with a script,
  used for the dashboards' charts), *artifact-design* (page design rules), and *code-review* (a structured
  review of a branch before a pull request).
- The project's own house rules (plan before coding, numbered option tables, a checklist for multi-part
  requests, never committing the railway JSON files) are kept as **memory** rather than skills: they are
  rules for every task, not a procedure for one kind of task. Knowing which belongs where is part of the skill.

### Try it yourself

Write a small personal skill, for example `~/.claude/skills/pr-description/SKILL.md`:

```markdown
---
name: pr-description
description: Write a pull request description for the current branch in this team's format.
---
1. Read `git log master..HEAD` and `git diff master...HEAD --stat`.
2. Write: a one-line summary; "What changed" as short bullets grouped by area; "How it was tested"
   with the exact commands; "Not in this PR".
3. Plain words, no marketing language. Never invent test results: only report commands that were run.
```

Then, on a branch, ask for a PR description (or type `/pr-description`) and compare it with one written without it.

### Explain it in two minutes

> "A skill is a written procedure the assistant loads when a task needs it: a `SKILL.md` with a name, a
> description and instructions, plus any scripts. Only the description is always loaded; the rest comes in
> when relevant. In my work I used skills for charts, where the skill runs a script to validate the colour
> palette instead of guessing, for page design, and for code review before a pull request. The point is
> consistency: I write the procedure once, and every time after it is followed the same way."

### Questions you may be asked

- **Skill vs prompt?** A prompt is one-off; a skill is a saved, reusable procedure that loads itself when relevant.
- **Skill vs project instructions (`CLAUDE.md`)?** Project instructions apply to every task; a skill is for one
  kind of task and stays out of the way otherwise.
- **How would a team use them?** Commit project skills to `.claude/skills/` so everyone gets the same review
  checklist, release-note format and so on.

---

## AI agents

### In one sentence

An AI agent is a model that works in a loop with tools: it plans, reads files, runs commands, checks the
results and continues until the task is done, instead of only answering in text.

### Why it matters

A chat assistant suggests code you then copy, run and debug. An agent does the whole loop: it runs the tests,
reads the failure, fixes it and runs them again. That changes the work from typing code to **specifying,
reviewing and deciding**, which is where the large productivity gains come from.

### Key ideas

- **The loop:** goal → plan → act with a tool (read, search, edit, run) → observe the result → repeat.
- **Tools:** reading and editing files, running shell commands, searching code, browsing docs, and external
  systems through **MCP** (Model Context Protocol) servers.
- **Subagents:** an agent can hand a side task (a broad code search, a plan, a review) to a helper agent
  with its own fresh context, and get back only the conclusion.
- **Background work:** long commands (test suites, servers, CI watchers) run in the background while the
  agent continues; it is notified when they finish.
- **Human in the loop:** permissions decide what the agent may do without asking. The person sets the goal,
  approves risky steps, and reviews the result.
- **Verification is the agent's real job:** an agent that runs the tests and the app is worth far more than
  one that only writes code.

### In this project

- Features were built in an agent loop: the agent wrote the code, the migrations and the tests, ran the
  **57 integration suites** and the **browser end-to-end scripts** against a locally running API and web app,
  read the failures and fixed them, before opening each pull request.
- **Background tasks:** the API and the web app ran as background processes while tests ran against them;
  CI runs on GitHub were watched until green.
- **Verification while writing these study notes:** every *Try it yourself* command on the deployment pages
  was actually run in Docker on this machine before being written down. Running things also caught the
  agent's own wrong assumptions and corrected them before they reached the page:
  - it first assumed all migrations only add things; checking all 39 showed 8 that change or remove something;
  - it assumed the rate limiter covered sign-in; the code showed it covers the public API, and sign-in has a lockout;
  - running an image scanner and a live CORS check turned up real issues worth fixing.

  That is the right way to use an agent: let it check its claims against the real system.

### Try it yourself

Give an agent a task with a built-in check, and watch the loop: *"Add a unit test for
`utils/money.js` covering rounding, run it, and fix anything that fails."* Note how often it runs the
tests on its own, and what it does with a failure.

### Explain it in two minutes

> "An agent is a model with tools in a loop: it plans, reads the code, edits, runs commands, looks at the
> result and keeps going. My role shifts to setting the goal, approving risky steps and reviewing.
>
> In this project the agent didn't just write features; it ran the 57 integration suites and the browser
> tests against the running app, fixed what failed, and only then opened the pull request. For my study notes
> it ran every Docker command before writing it down, and that caught its own mistakes: it had assumed all our
> migrations were additive, and checking showed eight were not. Verification is what makes agents trustworthy."

### Questions you may be asked

- **Agent vs chatbot?** A chatbot answers; an agent acts with tools and checks the results itself.
- **How do you keep an agent safe?** Permission rules (what it may run without asking), working on a branch,
  reviewing every diff, no production credentials on the machine, and a human merges.
- **What is MCP?** An open protocol for connecting AI tools to external systems (issue trackers, docs,
  databases) through small servers, so the agent can use them as tools.
- **When would you use a subagent?** For a broad side task whose details you do not need (searching a large
  codebase, an independent review) so the main conversation stays focused.

---

## Git worktrees for parallel work

### In one sentence

`git worktree` gives one repository several working folders at once, each on its own branch, so you (or
several AI sessions) can work on different tasks in parallel without stashing or switching branches.

### Why it matters

With one folder, starting a second task means stashing or committing half-done work and switching branches,
and a running server or test suite gets confused. With AI agents doing the typing, the bottleneck becomes how
many tasks can progress **at the same time**: one agent per worktree, each in its own folder and branch.

### Key ideas

- **One repository, many folders:** all worktrees share the same Git history and objects (no second clone), but
  each has its own checked-out files, branch, and uncommitted changes.
- **A branch can be checked out in only one worktree at a time**, which prevents two sessions from editing
  the same branch by accident.
- **Commands:**

| Command | What it does |
|---|---|
| `git worktree add ../app-fix -b fix/login origin/master` | New folder `../app-fix` on a new branch `fix/login`, starting from `origin/master` |
| `git worktree add ../app-review feature/x` | A folder for an existing branch (to review or test it) |
| `git worktree list` | All worktrees and their branches |
| `git worktree remove ../app-fix` | Delete the folder (refuses if there are uncommitted changes) |
| `git worktree prune` | Clean up records of folders deleted by hand |

- **Things that are per folder:** `node_modules`, `.env` files, build output, and **ports**. Two worktrees
  running the API at once need different ports.

### In this project

- **These study notes were written in a worktree.** The main folder `D:\Projects\seat-planner` stayed on the
  feature branch with its API and web app running, while `D:\Projects\seat-planner-demo` was created on a new
  branch from `demo`:

  ```text
  $ git worktree list
  D:/Projects/seat-planner       b0d0d6c [feature/subscription-continue]
  D:/Projects/seat-planner-demo  dc52796 [demo-goals]
  ```

  `master` was merged into the demo branch there, the guides regenerated and these pages written, without
  touching the main folder's work in progress.
- The same pattern serves parallel tasks: one worktree per pull request, each with its own agent session.

### Try it yourself

```powershell
cd D:\Projects\seat-planner
git worktree add ..\sp-try -b try/worktree origin/master
git worktree list
cd ..\sp-try ; git status                 # a full checkout, on its own branch
cd ..\seat-planner                        # back; nothing here changed
git worktree remove ..\sp-try ; git branch -D try/worktree
```

### Explain it in two minutes

> "A Git worktree is a second working folder for the same repository, on a different branch. Same history,
> no second clone, but separate files and uncommitted changes. That makes parallel work practical, especially
> with AI agents: one agent per worktree, each on its own task and branch.
>
> I used it for these notes: my main folder stayed on a feature branch with the app running, and a second
> worktree on the demo branch got master merged in and the documents written. Neither disturbed the other. The
> things to watch are what is per folder: dependencies, `.env` files and ports."

### Questions you may be asked

- **Worktree vs a second clone?** A worktree shares the object store and branches with the main repository:
  less disk, and a commit made in one is immediately visible in the other.
- **Why can't two worktrees use the same branch?** Git prevents it so two folders do not overwrite each other's
  work on one branch.
- **How many parallel tasks are sensible?** As many as you can *review* properly. The limit is your attention,
  not the tool.

---

## A proper AI setup

### In one sentence

A proper setup gives the AI the project's context and your rules up front, lets it run what it needs to
verify its work, and stops it from doing anything risky without asking.

### Why it matters

The same model gives very different results depending on what it knows and what it may do. Without context
it guesses your conventions; without the ability to run tests it cannot check itself; with too much freedom
it can do damage. Setup is a one-time investment that improves every task after it.

### Key ideas

| Part | What it is | Example |
|---|---|---|
| **Project instructions** | A file the assistant reads at the start of every session (`CLAUDE.md` in Claude Code): how to run, test and lint; conventions; things never to do | "Run `npm test` in `backend/` before saying a task is done" |
| **Memory** | Facts and preferences kept between sessions | "Plan in chat first; write files only after an explicit go" |
| **Permissions** | What may run without asking (an allow-list), what is always refused, and a mode for how cautious to be | Allow `npm run *`; ask before `git push` |
| **Plan first** | For bigger tasks, agree the plan before any code | A plan mode, or a house rule |
| **Hooks** | Commands that run automatically at set moments, such as a formatter after every edit | Run the linter after each file change |
| **Tools and connectors (MCP)** | Access to issue trackers, docs, databases | Read the ticket the task came from |
| **Editor integration** | The assistant inside the IDE sees open files and selections | The VS Code extension |
| **A runnable project** | Tests, a local database, seed data, e2e scripts | So every change can be verified locally |
| **Safety** | No production secrets on the machine; `.env` never shared; review every diff; a human merges | |

### In this project

- **Memory with house rules**, built up over the project and applied in every session, for example:
  - plan before code: settle requirements in chat; write nothing until an explicit "go";
  - offer choices as a numbered table; the reply is just the numbers;
  - for multi-part requests, keep a checklist and do the items in order;
  - topics 1-27 of the learning guide are frozen and must never change;
  - the local railway data files must never be committed;
  - undo migrations only by name;
  - the person merges pull requests, never the assistant.
- **Permissions:** a local allow-list of about 30 routine commands (running npm scripts, local `curl` checks),
  kept out of Git; anything else asks first.
- **A runnable project:** local MySQL and a MongoDB container, development seed data, unit and integration
  tests, and browser e2e scripts, so every change is checked before a pull request.
- **Editor:** Claude Code inside VS Code, so it sees the file and selection being worked on.
- **Attribution:** commits and pull requests made with the assistant say so in their trailers.

### Try it yourself

Run `/init` in a project without a `CLAUDE.md` and read what it generates; correct it by hand; then add the
three rules you find yourself repeating most often.

### Explain it in two minutes

> "Setup decides how good the AI is on my project. It needs context: a project instructions file and memory
> of my rules, like 'plan in chat before writing code' and 'offer choices as numbered options'. It needs to
> verify: our project runs locally with seed data, tests and browser scripts, so the agent checks its own
> work. And it needs limits: an allow-list of routine commands, everything else asks, no production secrets
> on the machine, and I review and merge every pull request myself."

### Questions you may be asked

- **What goes in a project instructions file?** How to build, test and run; conventions; where things are;
  what never to do. Short and specific; not a copy of the README.
- **How do you stop the AI from doing something dangerous?** Permissions (allow-list, ask for the rest), working
  on branches, no production credentials locally, and human review and merge.
- **What do you never give an AI tool?** Production secrets, personal data it does not need, and
  unreviewed merge rights.

---

## Keeping up to date

### In one sentence

AI tools change every few weeks, so set a small, regular habit for following what changed and trying the
features that matter for your work.

### Why it matters

Many productivity gains come from features that did not exist a few months earlier: agents that run tests,
subagents, background tasks, skills, better models. Someone using last year's workflow on this year's tools
leaves most of the gain unused.

### Key ideas

- **Follow a few primary sources**, not every headline: the tool's release notes and changelog, the vendor's
  documentation and announcements, and one or two trusted engineers or newsletters.
- **Try, then keep or drop:** every new feature gets one real task. Keep what saved time; drop the rest.
- **Know the current models and their trade-offs:** larger models for hard reasoning and long tasks, faster
  ones for simple, high-volume work. (At the time of writing the Claude 5 family: Opus 5.5, Sonnet 5.5,
  Haiku 5.5, and Fable 5.1.)
- **Share what works** with the team: a short note or a skill beats everyone discovering it separately.

### A simple routine

| When | What |
|---|---|
| Weekly, 20 minutes | Read the release notes of the tools you use; note one thing to try |
| Each new feature | Try it on one real task; write one line: kept or dropped, and why |
| Monthly | Review your setup (instructions, memory, skills, permissions); remove what is stale |
| Quarterly | Look at your numbers (next section): is the way you work actually getting faster? |

### In this project

Features adopted as they appeared during the project: running tests and servers in the **background**,
**subagents** for broad searches and reviews, **skills** for charts and code review, **memory** for house rules,
**worktrees** for parallel work, and publishing study material and dashboards as shareable pages.

### Explain it in two minutes

> "AI tools change every few weeks, so I keep a small routine: twenty minutes a week on release notes, one real
> task for every new feature, then keep it or drop it. Over this project that brought in background test runs,
> subagents, skills and worktrees, each adopted because it saved time on real work, not because it was new."

### Questions you may be asked

- **How do you judge whether a new feature is worth adopting?** Try it on a real task and compare time and
  quality with the old way.
- **How do you avoid chasing hype?** Primary sources only, and a rule that nothing changes my workflow until it
  has helped on real work.

---

## Productivity: measuring 200%

### In one sentence

A 200% increase means three times the useful output for the same time, and the honest way to claim it is to
measure delivered work (features, tests, reliability) before and after, not lines of code.

### Why it matters

"AI makes me faster" is easy to say and hard to prove. A goal with a number needs a measurement, and the
measurement must reward **finished, tested, working** features, otherwise it rewards producing more code to review.

### Key ideas

- **Output, not activity.** Lines of code and commit counts are activity. Useful output is features shipped,
  bugs fixed, tests that protect them, and time from request to working software.
- **Quality must not drop.** Speed that brings more production bugs is not productivity. Track bugs found
  after release, and test coverage.
- **A baseline is needed.** Compare with how long similar work took before: your own past tasks, the team's
  usual pace, or an estimate made before starting.
- **Where AI saves the most:** boilerplate, tests, migrations, documentation, reading unfamiliar code,
  debugging with the failing output in hand, and verifying (running everything).
- **Where it saves the least:** deciding *what* to build, and reviewing. That work stays yours, and grows as
  output grows.

### The numbers from this project

| Measure | Value |
|---|---|
| Pull requests merged | **27**, from 2 October to 1 November 2026: **about 6 per week** |
| Fastest stretch | 11 pull requests (#18 to #28) in **12 days**, about 20,000 lines added |
| Size of the change | +77,108 / −3,168 lines across 783 file changes, in those 27 pull requests |
| Features documented in the feature guide | **41** ([`docs/FEATURES.md`](../FEATURES.md)) |
| Tests alongside them | **57** integration suites (about 2,150 checks), **337** backend unit tests, **10** frontend unit tests, **22** browser end-to-end scripts |
| CI | Every pull request runs all backend tests against real MySQL and MongoDB, and a full frontend build |
| Scope | A ticketing system with seat plans, bookings, refunds, subscriptions with a public check API, seat allocation, audit analysis, an Android app with signed releases, and a production deployment |
| These study notes | Nine pages, every exercise run before being written, in one working session |

**How to turn this into a "200%" statement honestly:**

1. Pick 3-5 recent tasks of different kinds (a feature, a bug fix, a migration with tests, documentation).
2. For each, write down how long it would have taken you without AI. Use your own past work or the team's
   usual estimate for that size, not a guess made afterwards to look good.
3. Write down how long it actually took, including review and fixes.
4. Compare the totals, and check quality: tests added, bugs found after release.

| Task | Estimate without AI | Actual with AI | Tests added | Bugs after release |
|---|---|---|---|---|
| *(fill in)* | | | | |

If the estimates add up to three times the actual time, with equal or better quality, that is 200%.

### Explain it in two minutes

> "I measure productivity by finished, tested work, not lines of code. In the month from early October to early
> November I merged 27 pull requests, about six a week, including one stretch of eleven in twelve days. Each
> came with tests: the project has 57 integration suites, over 300 unit tests and 22 browser tests, and CI runs
> them on every pull request, so the speed did not cost quality.
>
> For the 200% figure I compare tasks against how long they would have taken me before, using my own past work
> as the baseline. Where AI helps most is the volume work (tests, migrations, documentation, verification) and
> where it helps least is deciding what to build and reviewing it. That part is still mine, and it is where my
> time goes now."

### Questions you may be asked

- **Isn't more code just more to maintain?** Yes, so the measure is features and their tests, not lines. Each
  pull request here came with tests and passed CI.
- **How do you know AI-written code is correct?** The same way as any code: tests, CI, review, and running it.
  The agent is asked to verify, and I review every diff.
- **What is your baseline?** My own estimates for comparable past tasks, written down per task (the table above).
- **Where does AI not help?** Unclear requirements, product decisions, and judgement calls about trade-offs;
  and it can be confidently wrong, which is why verification is part of the workflow.
