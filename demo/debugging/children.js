/**
 * Demo 3 (stand-alone version): debugging child processes.
 *
 * The parent starts two children, one with `fork` and one with `spawn` of the
 * same Node executable, the two ways the project's own test runner and tools
 * start Node processes. Each child prices a batch of seats and reports back.
 *
 * Put a breakpoint on the line marked BREAKPOINT: it only ever runs in a child.
 * The real-project version of this demo is the integration test runner
 * (tests/integration/run.js), which runs every suite in a child process.
 */
const { fork, spawn } = require("child_process");

const role = process.argv[2];

if (role === "child") {
  const batch = process.argv[3];
  const fares = Array.from({ length: 5 }, (_, i) => 400 + i * 150);
  const total = fares.reduce((sum, fare) => sum + fare, 0); // BREAKPOINT
  console.log(`[child ${batch}, pid ${process.pid}] priced ${fares.length} seats: ${total} taka`);
  if (process.send) process.send({ batch, total });
  process.exit(0);
} else {
  console.log(`[parent, pid ${process.pid}] starting two children`);

  const forked = fork(__filename, ["child", "A"]);
  forked.on("message", (m) => console.log(`[parent] child A reported ${m.total} taka`));

  const spawned = spawn(process.execPath, [__filename, "child", "B"], { stdio: "inherit" });

  let left = 2;
  const done = (name) => (code) => {
    console.log(`[parent] child ${name} exited with ${code}`);
    if (--left === 0) console.log("[parent] both children finished");
  };
  forked.on("exit", done("A"));
  spawned.on("exit", done("B"));
}
