/**
 * Demo 5: debugging multi-threaded code.
 *
 * Four booking workers (real threads, `worker_threads`) each record 1,000,000
 * sales in one shared counter. The total should be 4,000,000. Without
 * `--fixed`, it comes out short: two threads read the same value, both add
 * one, both write it back, and one sale is lost (a "lost update" race).
 *
 *   node demo/debugging/workers.js           the race: the total comes out short
 *   node demo/debugging/workers.js --fixed   Atomics.add: always exactly right
 *
 * Breakpoint: the line marked BREAKPOINT, with the condition `i === 500000`,
 * stops each worker once, half-way, so the debugger shows several threads.
 */
const { Worker, isMainThread, workerData, threadId } = require("worker_threads");

const WORKERS = 4;
const SALES_EACH = 1_000_000;

if (isMainThread) {
  const fixed = process.argv.includes("--fixed");
  const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const sold = new Int32Array(shared);

  console.log(`${WORKERS} workers x ${SALES_EACH.toLocaleString("en-US")} sales, ${fixed ? "with Atomics.add" : "with a plain sold[0] += 1"}`);
  const started = Date.now();
  let running = WORKERS;
  for (let n = 1; n <= WORKERS; n++) {
    const worker = new Worker(__filename, { workerData: { shared, fixed, name: `booking-${n}` } });
    worker.on("error", (err) => console.error(err));
    worker.on("exit", () => {
      if (--running > 0) return;
      const expected = WORKERS * SALES_EACH;
      const lost = expected - Atomics.load(sold, 0);
      console.log(`expected ${expected.toLocaleString("en-US")}, counted ${Atomics.load(sold, 0).toLocaleString("en-US")}` +
        (lost ? `: ${lost.toLocaleString("en-US")} sales LOST` : ": correct") + ` (${Date.now() - started} ms)`);
      process.exitCode = lost ? 1 : 0;
    });
  }
} else {
  const sold = new Int32Array(workerData.shared);
  for (let i = 0; i < SALES_EACH; i++) {
    if (workerData.fixed) {
      Atomics.add(sold, 0, 1); // read, add and write as one step no other thread can split
    } else {
      sold[0] += 1; // BREAKPOINT (condition: i === 500000). Read, add, write: three steps another thread can interleave
    }
  }
  console.log(`  ${workerData.name} (thread ${threadId}) done`);
}
