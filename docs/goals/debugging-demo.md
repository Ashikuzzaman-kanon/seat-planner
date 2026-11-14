# Debugging demo (live, in IntelliJ IDEA or PhpStorm)

Goal: **Debugging Techniques (Advanced)**. Marked done on the sheet; this is the live demo for it.
Seven parts, in the sheet's order:

1. [Conditional breakpoints and actions](#1-conditional-breakpoints-and-actions)
2. [Attach to process](#2-attach-to-process)
3. [Debugging child processes](#3-debugging-child-processes)
4. [Debugging mixed code bases](#4-debugging-mixed-code-bases)
5. [Debugging in multi-threaded applications](#5-debugging-in-multi-threaded-applications)
6. [Core dump analysis](#6-core-dump-analysis)
7. [Reproducing an issue from a different environment](#7-reproducing-an-issue-from-a-different-environment)

Unlike the theory pages, this is a **runbook**: set-up first, then for each part the steps to click
through, what to say, and what to do if something does not behave. Rehearse it once end to end before
the real demo.

**What is ready-made for you:**

- **Run configurations** in [`.run/`](../../.run): the IDE loads them automatically when you open the
  project. Two folders appear in the run list: *Seat Planner* (the app, tests, attaching) and
  *Debugging demo* (one per part).
- **Small demo scripts** in [`demo/debugging/`](../../demo/debugging), each with a deliberate problem
  and a line marked `BREAKPOINT`. They need no database. Parts 3 and 4 also use the real app.
- Every script was run on this machine (Node 20, Windows 11, Docker Desktop) and does what this page
  says. The IDE steps follow JetBrains' standard UI, but no JetBrains IDE was installed here to click
  through them, so **the rehearsal is where you confirm them**.

---

## Before the demo

### The IDE

- **IntelliJ IDEA Ultimate**: JavaScript and Node.js debugging come from bundled plugins. Check under
  *Settings → Plugins → Installed* that **JavaScript and TypeScript**, **JavaScript Debugger** and
  **Node.js** are enabled. (IntelliJ IDEA *Community* cannot debug JavaScript.)
- **PhpStorm**: all of it is built in. Every step below is the same; PhpStorm's menus and shortcuts match
  IntelliJ's for everything on this page.
- *Settings → Languages & Frameworks → Node.js*: **Node interpreter** = your Node 20
  (`C:\Program Files\nodejs\node.exe`).
- *Settings → Tools → Web Browsers*: if Chrome is not installed, make sure **Edge** is listed; part 4 uses it.

### The project

1. Open the repository folder (`D:\Projects\seat-planner`) as the project, on the `demo` branch.
2. The run list (top right) now has the *Seat Planner* and *Debugging demo* folders. If it does not, see
   [If a run configuration does not load](#if-a-run-configuration-does-not-load).
3. MongoDB running (`docker compose up -d mongo`, or the **MongoDB (Docker)** run configuration), and the
   local MySQL running, as for everyday development. `backend/.env` in place.
4. **Stop** the API and web app you normally run (ports 4000 and 3000): the debug versions start their own.

### Shortcuts (Windows keymap, same in both IDEs)

| Action | Keys |
|---|---|
| Toggle breakpoint on the current line | `Ctrl+F8` |
| Edit a breakpoint (condition, actions) | right-click the red dot, or `Ctrl+Shift+F8` on its line |
| All breakpoints (incl. exception breakpoints) | `Ctrl+Shift+F8` |
| Debug the selected configuration | `Shift+F9` |
| Resume | `F9` |
| Step over / into / out | `F8` / `F7` / `Shift+F8` |
| Run to cursor | `Alt+F9` |
| Evaluate expression | `Alt+F8` |
| Set a variable's value (in Variables) | `F2` |
| Attach to process | `Ctrl+Alt+F5` |
| Stop | `Ctrl+F2` |

### Timing

| Part | Minutes |
|---|---|
| 1 Conditional breakpoints and actions | 5 |
| 2 Attach to process | 3 |
| 3 Child processes | 4 |
| 4 Mixed code bases | 5 |
| 5 Multi-threaded | 4 |
| 6 Core dump analysis | 5 |
| 7 Different environment | 4 |
| **Total** | **about 30** |

---

## 1. Conditional breakpoints and actions

**In one sentence:** a breakpoint can stop only when a condition is true, and can *do* something
instead of (or as well as) stopping: log a message, evaluate an expression, remove itself, or wait for
another breakpoint.

**Script:** [`demo/debugging/refunds.js`](../../demo/debugging/refunds.js). 2,000 cancellations go through
the refund rules; **23 come out negative**, the first being booking **1056**. The finance check at the
end throws an error.

### Steps

1. Run **1 Refunds (conditional breakpoints)** normally (not debug). Show the result:
   `Error: 23 refunds are negative, e.g. booking 1056`.
2. Open `refunds.js`, put a breakpoint on line 48 (`return Math.round(refund);`, marked `BREAKPOINT`).
   Say: *"A plain breakpoint here would stop 2,000 times."*
3. Right-click the red dot → **Condition**: `refund < 0`. Debug the configuration (`Shift+F9`).
   It stops on booking **1056**. In *Variables*: `c.hoursBeforeDeparture` is `-1` (the train has left),
   `fee` equals `paid`, and `serviceCharge` makes the result negative.
4. **Evaluate** (`Alt+F8`): `cancellationRate(-1)` → `1`; `paid - fee` → `0`. The whole fare is kept as the
   fee, *and then* the service charge is taken on top.
5. **A logging breakpoint (no stopping):** right-click → **More** (`Ctrl+Shift+F8`). Untick **Suspend**,
   tick **Evaluate and log** with:
   `` `#${c.id}: ${c.seats} seat(s), ${c.hoursBeforeDeparture} h, refund ${refund}` ``
   Keep the condition. Debug again: the console lists all 23, and the run never pauses. Say: *"A
   tracepoint: logging added without changing the code or restarting anything."*
6. **More actions, same dialog:** **Remove once hit** (a one-time breakpoint) and **Disable until hitting the
   following breakpoint** (a breakpoint that only arms after another one fires, for "only after X happened").
7. **Exception breakpoint:** `Ctrl+Shift+F8` → *JavaScript Exception Breakpoints* → tick it, any exception.
   Remove the line breakpoint, debug: it stops on the `throw` at the end, with `negative` in *Variables*.
8. **The fix**, to say (or type and rerun): the service charge can only come out of money being returned:
   `const refund = Math.max(0, paid - fee - serviceCharge);`

**On the real app (optional):** the same condition idea on the API. Breakpoint in
[`backend/src/services/holdService.js`](../../backend/src/services/holdService.js) line 108
(`const ids = ...`), condition `seatIds.length >= 3`: holding one or two seats on the site does not stop;
three does.

**What to say:** *"Conditions stop only on the case I care about; logging breakpoints add output without
touching the code; exception breakpoints stop where an error is thrown, not where it is finally reported.
Together they replace both 'step a thousand times' and 'add console.log and restart'."*

**If it does not stop:** the condition must use values that exist **before** the line runs (a breakpoint
pauses before its line). That is why it is on the `return` line, not the `const refund =` line.

---

## 2. Attach to process

**In one sentence:** connect the debugger to a program that is **already running** (a server you cannot
restart, a process started by something else, or one in a container) instead of starting it from the IDE.

### Steps (the real API, started without any debug flag)

1. In a terminal, start the API normally: `cd backend` then `npm start`.
2. Find its process id (PowerShell):
   `Get-NetTCPConnection -LocalPort 4000 -State Listen | Select-Object -ExpandProperty OwningProcess`
3. Ask it to open its debugger port, without restarting it:
   `node demo/debugging/enable-inspector.js <pid>`
   The API's own terminal now prints `Debugger listening on ws://127.0.0.1:9229/...`.
   (On Linux and macOS the same thing is `kill -USR1 <pid>`.)
4. In the IDE, debug **Attach to Node (9229)**. It connects.
5. Breakpoint in [`backend/src/routes/index.js`](../../backend/src/routes/index.js) line 31 (the health route).
   Open http://localhost:4000/api/v1/health in a browser: the IDE stops inside the running server.
6. Stop the debug session (`Ctrl+F2`): the IDE detaches, **the API keeps running**.

**The IDE's own list:** a process started with `node --inspect src/server.js` shows up in
**Run → Attach to Process...** (`Ctrl+Alt+F5`); pick it from the list instead of using a configuration.

**In a container or on another machine (to explain):** start Node with `--inspect=0.0.0.0:9229`, publish the
port **only to 127.0.0.1** (`-p 127.0.0.1:9229:9229`), attach with the same configuration, and in it map the
container's `/app` to the local `backend` folder so breakpoints line up.

**What to say:** *"Attaching is for when the problem is in a process that is already running and must not be
restarted, because restarting would lose the state that shows the bug. Node can even switch its debugger on
in a live process. The debugger port gives full control of the process, so it only ever listens on
localhost; never expose it."*

**If it does not connect:** check the API's terminal printed the `Debugger listening` line; port 9229 must
be free (a previous session still attached holds it).

---

## 3. Debugging child processes

**In one sentence:** when a program starts other processes, the debugger follows into those children, so a
breakpoint in code that only runs in a child still stops.

### Steps: stand-alone first

1. Breakpoint in [`demo/debugging/children.js`](../../demo/debugging/children.js) line 19 (`BREAKPOINT`):
   that line only runs in a child.
2. Debug **3 Child processes**. The parent starts two children, one with `fork` and one with `spawn`. The IDE
   attaches to each; the Debug window shows each process separately, and it stops in child A, then child B,
   each with its own process id in *Variables* (`process.pid`, `process.argv`).

### Steps: the real thing, the integration test runner

[`backend/tests/integration/run.js`](../../backend/tests/integration/run.js) is a parent that hosts the API
and runs every test suite as a **child process** (line 101: `spawn(process.execPath, [file, ...])`).

1. Breakpoint in [`backend/tests/integration/suites/concurrency.js`](../../backend/tests/integration/suites/concurrency.js)
   line 72: two buyers try to take the same seat at the same moment.
2. Breakpoint in [`backend/src/services/inventoryService.js`](../../backend/src/services/inventoryService.js)
   line 112: the branch that refuses the loser (`SequelizeUniqueConstraintError`).
3. Debug **Integration tests (concurrency)**. The first run builds the test database (`seat_planner_test`,
   never the development one), which takes a while; then it stops at line 72 **in the child**. Resume: it
   stops at line 112 for the losing buyer. Say: *"The database's unique constraint rejected the second
   buyer. That is the safety the whole product rests on."*

**What to say:** *"Test runners, build tools, servers with workers: lots of programs start other processes.
The debugger follows the children automatically, so I can stop in a test suite that runs in its own process,
and in the service code it calls."*

**If it does not stop in the child:** debug the child on its own: `children.js` with the program arguments
`child A` runs just the child's code. For the test suite, check *Settings → Build, Execution, Deployment →
Debugger* for the option about Node child processes, and that the run configuration has not been changed to
pass its own `NODE_OPTIONS`.

---

## 4. Debugging mixed code bases

**In one sentence:** one problem often crosses several languages and runtimes; debug them together and
follow a single request from one to the next.

Seat Planner is a good example: **browser JavaScript** (React, the page), the **Next.js server** (Node,
which forwards `/api`), the **Express API** (Node), **SQL** (MySQL), and the **Android app** (Kotlin, around a
WebView that runs the same web pages).

### Steps: one click, followed across the stack

1. Debug **Full stack (debug)**. It starts the API under the debugger, the Next.js dev server, and a browser
   tab connected to the IDE. (If the tab opens before Next.js is ready, refresh it.)
2. Breakpoints:
   - **Browser:** [`frontend/src/lib/booking.js`](../../frontend/src/lib/booking.js) line 91, `createHold`: the
     page asking the API to hold seats.
   - **API:** [`backend/src/services/holdService.js`](../../backend/src/services/holdService.js) line 108.
3. In the browser tab: sign in (a development account), choose a departure, pick seats, continue.
   - The IDE stops **in the browser code** first. *Variables* shows `seatIds`. Resume.
   - It stops **in the API** next, the same `seatIds` arriving as `req.body`. Step to the transaction; resume.
4. **The SQL:** in the IDE's *Database* window (IntelliJ Ultimate and PhpStorm include it), connect to the
   development MySQL and run `SELECT * FROM seat_holds ORDER BY id DESC LIMIT 1;`: the row the click just made.

**The Android app (to explain, or show with a phone):** open `android/` in the IDE with the Android plugin
for breakpoints in the Kotlin code (for example [`MainActivity.kt`](../../android/app/src/main/java/com/seatplanner/app/MainActivity.kt));
the web pages inside its WebView are debugged from the desktop browser at `edge://inspect` (or
`chrome://inspect`) with the phone connected by USB.

**What to say:** *"The bug is rarely where the symptom is. Here one click goes through React in the browser,
the Next.js server, the Express API and MySQL; with breakpoints on both sides I can see the exact values
leave the page and arrive at the server, and the row it wrote. The IDE debugs the browser and Node in one
session, and its database console closes the loop."*

**If browser breakpoints do not bind:** use the dev server (this configuration does), not `next start`; and
make sure the browser tab was opened by the IDE (the JavaScript Debug configuration), not by hand.

---

## 5. Debugging in multi-threaded applications

**In one sentence:** with real threads, several pieces of code run at the same time and can interfere; the
debugger shows each thread separately, and pausing one does not stop the others, which is exactly how you
see a race.

**Script:** [`demo/debugging/workers.js`](../../demo/debugging/workers.js). Four worker threads each record
1,000,000 sales in one shared counter. Expected 4,000,000. On this machine it counted **1,320,863:
2,679,137 sales lost** (the exact number changes every run; that is typical of races).

### Steps

1. Run **5 Worker threads (race)** normally: show the lost sales. Run it again: a different number.
2. Breakpoint on line 46 (`sold[0] += 1`, marked `BREAKPOINT`), condition `i === 500000`. Debug it.
3. It stops in one worker. The Debug window lists the **threads** (main and the workers; the drop-down above
   *Frames*, or the *Threads & Variables* tab in newer versions). Switch between them.
4. **The race, visible:** with one worker paused, **Evaluate** `sold[0]` (`Alt+F8`), wait a second, evaluate it
   again. It has grown: the other threads kept running and changing it while this one was paused. *"This is the
   whole problem: between my read and my write, another thread wrote."*
5. Remove the breakpoint and run **5 Worker threads (fixed)**: `Atomics.add` makes read-add-write one step.
   Always exactly 4,000,000.

**The other kind of concurrency in this project:** the API is single-threaded but handles many requests at
once. Two buyers for one seat is the same race; the database's unique constraint is our `Atomics`. That is
what part 3's test proved.

**What to say:** *"Three lessons. Each thread is its own line of execution, and the debugger lists them. A race
depends on timing, so the debugger can make it disappear by pausing things; I use conditional or logging
breakpoints and run it many times. In Node a breakpoint pauses that whole thread, all of its requests, which is
why for concurrency bugs in the API I prefer logging breakpoints. In Java, IntelliJ lets you choose per
breakpoint whether to suspend one thread or all of them."*

**If the IDE does not show the workers:** use the browser's tools: run
`node --inspect-brk demo/debugging/workers.js`, open `edge://inspect`, *Open dedicated DevTools for Node*; the
workers appear there as separate targets.

---

## 6. Core dump analysis

**In one sentence:** when a process crashes or runs out of memory you cannot step through it any more, so
you analyse what it left behind: a snapshot of its state at the moment it died.

**For Node, the practical "core dumps" are two files:**

| File | What it holds | Produced by |
|---|---|---|
| **Diagnostic report** (JSON) | The error and JavaScript stack, the native stack, heap sizes, open handles (timers, sockets), versions, command line, **environment variables** | `--report-uncaught-exception`, `--report-on-fatalerror`, or `process.report.writeReport()` |
| **Heap snapshot** | Every object in memory and what keeps it alive | `--heapsnapshot-near-heap-limit`, `v8.writeHeapSnapshot()`, or the `--heapsnapshot-signal` flag |

A true **OS core dump** (the whole process memory) matters for native crashes. On Linux it needs
`ulimit -c unlimited` and `node --abort-on-uncaught-exception`, and is read with `llnode` (an lldb plugin);
on Windows the equivalent is a crash dump read with WinDbg. It cannot be shown here: on Docker Desktop for
Windows the Linux kernel hands core files to WSL's crash handler (checked:
`core_pattern = |/wsl-capture-crash ...`), so none is written in the container. That is worth saying.

Everything the demo writes goes to `demo/debugging/out/`, which Git ignores: **reports contain environment
variables** (88 of them on this machine), so never attach one to a ticket without checking it.

### Steps: A, the crash report

1. Run **6 Crash report**. It prints two trains, then crashes:
   `TypeError: Cannot read properties of null (reading 'stops')`.
2. Open the new `report.*.json` in `demo/debugging/out/` in the IDE. Walk through it:
   - `header`: Node version, command line, working folder, when;
   - `javascriptStack`: the message and `firstStopOf (crash.js:39)`, the line that failed;
   - `javascriptHeap`, `resourceUsage`: memory and CPU at the time;
   - `libuv`: what was open (timers, handles);
   - `environmentVariables`: the configuration it ran with, and why the file is sensitive.
3. Point out what is **missing**: the stack shows `firstStopOf`, but not `nightlyJob` that called it, because
   that call went through `await`. A report shows the moment of the crash; for the whole async path, reproduce
   it under the debugger with an exception breakpoint (part 1).

### Steps: B, the memory leak

1. Run **6 Memory leak (heap snapshot)**. It caches "visitors" in a `Map` that is never cleared, with only 48 MB
   allowed. In about half a minute it dies (exit code 134) and leaves a heap snapshot (about 100 MB) and a fatal
   error report in `demo/debugging/out/`.
2. Open the snapshot: in Edge, `edge://inspect` → *Open dedicated DevTools for Node* → **Memory** → **Load**
   (or your IDE's V8 heap snapshot viewer, if your version has one). In **Summary**, sort by **Retained size**:
   a `Map` holds nearly everything. Its **Retainers** lead to `seenVisitors`.
3. **Comparing two snapshots** (the usual way to find a leak in a running server): run
   **6 Two heap snapshots**, load `1-before` and `2-after`, select `2-after` and switch the view to
   **Comparison** against `1-before`: 40,000 new entries and their strings, all added to the same `Map`.
4. **In this project:** the rate limiter keeps counts in a `Map` too, and that is why it sweeps out old entries
   once it passes 50,000 ([`backend/src/utils/rateLimiter.js`](../../backend/src/utils/rateLimiter.js) line 20).
   Without that line, it would be this leak.

**What to say:** *"After a crash there is nothing left to step through, so I make the process leave evidence.
A diagnostic report gives the failing line, the state and the configuration at the moment of the crash; a heap
snapshot shows what was filling memory and what was keeping it alive. Comparing two snapshots is how you find a
slow leak in a server. A full OS core dump is the same idea for native crashes, read with llnode or WinDbg."*

---

## 7. Reproducing an issue from a different environment

**In one sentence:** a bug that only happens "on the server" is reproduced by finding what differs between
the environments and recreating that one difference locally, under the debugger.

### Steps: A, the timezone

**Script:** [`demo/debugging/timezone.js`](../../demo/debugging/timezone.js). "Which day is it?" decides which
departures are on sale. Asked of the computer's clock, a laptop in Dhaka and a server in UTC disagree for six
hours every night. The moment is pinned (`DEMO_NOW=2026-11-15T20:00:00Z`, 2 a.m. on 16 November in Dhaka) so the
demo works at any hour.

1. Run **7 Timezone (Dhaka laptop)**: naive and Dhaka answers agree. *"On my machine it works."*
2. Run **7 Timezone (UTC server)**: the **only** change is the environment variable `TZ=UTC` (open the run
   configuration to show it). Now they differ: `2026-11-15` vs `2026-11-16`.
3. Breakpoint in `naiveToday`, debug the UTC configuration, and evaluate `date.getDate()` and
   `date.getUTCDate()`: the host's calendar, not Dhaka's.
4. **In this project:** this is not invented. The API runs on Render in UTC, and
   [`backend/src/utils/dhakaTime.js`](../../backend/src/utils/dhakaTime.js) exists for exactly this reason; its
   comment reads: *"A server running in UTC would otherwise roll the horizon over six hours early and generate
   the wrong day."*

### Steps: B, a path that only breaks on Linux

**Script:** [`demo/debugging/paths.js`](../../demo/debugging/paths.js) asks for `./lib/Format`; the file is
`lib/format.js`.

1. Run **7 Paths (works on Windows)**: it prints the fare. Windows ignores upper and lower case in file names.
2. Run it on Linux, the way CI, the Docker image and Render do, with its own copy of the files:

   ```powershell
   docker run --rm -v "${PWD}/demo/debugging:/src:ro" node:20-alpine sh -c "cp -r /src /work && node /work/paths.js"
   ```

   `Error: Cannot find module './lib/Format'`.
3. **A trap worth showing:** run the same thing on the **mounted** folder instead
   (`docker run --rm -v "${PWD}:/app" -w /app node:20-alpine node demo/debugging/paths.js`) and it **works**,
   because a folder shared from Windows stays case-insensitive. Reproducing "Linux" this way would have hidden
   the bug. (Found while preparing this demo.)

**Debugging inside Linux from the IDE:** *Settings → Languages & Frameworks → Node.js → Node interpreter →
Add → Docker*, image `node:20-alpine`. Run configurations can then run and debug the script **inside the
container**, with breakpoints, from the same IDE.

**The checklist of what can differ** (say it while the second run is going):

| Difference | Here vs production | How to reproduce |
|---|---|---|
| Timezone and locale | Dhaka vs UTC | `TZ` in the run configuration |
| Operating system | Windows vs Linux (case-sensitive paths, line endings) | Docker image, or the IDE's Docker interpreter |
| Node version | v20.11.0 here vs the newest 20.x in `node:20-alpine` | Same image, or a pinned version |
| Configuration | `NODE_ENV=production` hides stack traces and request logs | Same variables, with test values |
| Feature switches and settings | Per environment | Copy the settings, not the data |
| Data | Real data vs seed data | An anonymised copy |
| Resources | Render's memory limit vs a 16 GB laptop | Docker `-m` (see the Docker pages) |
| Network | CORS origins, proxies, HTTPS | The same origins in `CORS_ORIGINS` |

**What to say:** *"'Works on my machine' means something about my machine is different. I list the
differences, change one at a time locally, and stop when the bug appears. Here a single environment variable,
`TZ=UTC`, reproduces a production-only date bug, and a Linux container reproduces a path bug that Windows hides,
but only with a real copy of the files, not a mounted folder."*

---

## Rehearsal checklist

- [ ] The IDE opens the project and shows both run configuration folders.
- [ ] Part 1: the conditional breakpoint stops at booking 1056; the logging breakpoint prints 23 lines.
- [ ] Part 2: `enable-inspector.js` makes the API print *Debugger listening*; attaching stops at the health route.
- [ ] Part 3: the debugger stops inside a child of `children.js`; the concurrency suite stops at line 72.
- [ ] Part 4: one seat selection stops in the browser and then in the API.
- [ ] Part 5: the thread list shows the workers; `sold[0]` grows between two evaluations.
- [ ] Part 6: the report and the heap snapshot appear in `demo/debugging/out/`, and the snapshot opens.
- [ ] Part 7: the two timezone runs differ; the Linux copy fails, the mounted folder does not.
- [ ] Afterwards: empty `demo/debugging/out/` (snapshots are large), restart the everyday API and web app.

## If a run configuration does not load

Create it by hand (*Run → Edit Configurations → +*) with these fields:

| Name | Type | Settings |
|---|---|---|
| API (debug) | Node.js | JavaScript file `src/server.js`, working directory `backend` |
| Web app (dev server) | npm | package.json `frontend/package.json`, command `run`, script `dev` |
| Web app (browser) | JavaScript Debug | URL `http://localhost:3000`, browser Chrome or Edge |
| Full stack (debug) | Compound | the three above |
| Attach to Node (9229) | Attach to Node.js/Chrome | host `localhost`, port `9229`, reconnect automatically |
| Backend unit tests | npm | `backend/package.json`, script `test` |
| Integration tests (concurrency) | npm | `backend/package.json`, script `test:integration`, arguments `-- concurrency`, environment `TEST_MONGO_URI=mongodb://127.0.0.1:27017/seat_planner_test` |
| MongoDB (Docker) | Docker Compose | file `docker-compose.yml`, service `mongo` |
| 1 Refunds (conditional breakpoints) | Node.js | `demo/debugging/refunds.js`, working directory = project folder |
| 3 Child processes | Node.js | `demo/debugging/children.js` |
| 5 Worker threads (race) / (fixed) | Node.js | `demo/debugging/workers.js`; for *fixed*, application parameters `--fixed` |
| 6 Crash report | Node.js | `demo/debugging/crash.js`, application parameters `report`, Node parameters `--report-uncaught-exception --diagnostic-dir=demo/debugging/out --report-directory=demo/debugging/out` |
| 6 Memory leak (heap snapshot) | Node.js | `demo/debugging/crash.js`, parameters `leak`, Node parameters `--max-old-space-size=48 --heapsnapshot-near-heap-limit=1 --report-on-fatalerror --diagnostic-dir=demo/debugging/out --report-directory=demo/debugging/out` |
| 6 Two heap snapshots | Node.js | `demo/debugging/crash.js`, parameters `snapshots` |
| 7 Timezone (Dhaka laptop) / (UTC server) | Node.js | `demo/debugging/timezone.js`, environment `TZ=Asia/Dhaka` or `TZ=UTC`, and `DEMO_NOW=2026-11-15T20:00:00Z` |
| 7 Paths (works on Windows) | Node.js | `demo/debugging/paths.js` |

## Questions you may be asked

- **Conditional breakpoint vs `if (...) debugger;` in the code?** Same effect, but the breakpoint needs no code
  change, no restart, and cannot be committed by accident.
- **What does a logging breakpoint give you over `console.log`?** Output without editing or restarting; it can
  be switched on in a running process you attached to.
- **Is attaching to a production process a good idea?** Rarely: pausing it stops every user's request. Use
  logging breakpoints, a copy of the environment, or a single instance taken out of traffic. And never expose the
  debug port.
- **Why can a bug disappear under the debugger?** Pausing changes timing; races and timeouts depend on timing.
  Use non-suspending breakpoints, logs, and repeated runs.
- **How do you find a memory leak?** Watch memory grow over time, take two heap snapshots some time apart,
  compare them, and follow the retainers of what grew to the code that holds on to it.
- **What is the first thing you do with a "works on my machine" bug?** Write down every difference between the
  two environments, then reproduce them one at a time: timezone, OS, versions, configuration, data.
