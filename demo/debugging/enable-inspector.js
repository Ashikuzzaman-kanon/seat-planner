/**
 * Demo 2: attach a debugger to a Node process that is ALREADY running, started
 * without --inspect, without restarting it.
 *
 *   node demo/debugging/enable-inspector.js <pid>
 *
 * This asks that process to open its inspector on 127.0.0.1:9229 (on Linux and
 * macOS the same thing is `kill -USR1 <pid>`). Then attach with the
 * "Attach to Node (9229)" run configuration.
 *
 * To find the API's process id on Windows (PowerShell):
 *   Get-NetTCPConnection -LocalPort 4000 -State Listen | Select-Object -ExpandProperty OwningProcess
 */
const pid = Number(process.argv[2]);
if (!Number.isInteger(pid) || pid <= 0) {
  console.error("usage: node demo/debugging/enable-inspector.js <pid>");
  process.exit(2);
}

try {
  process._debugProcess(pid);
} catch (err) {
  console.error(`could not signal process ${pid}: ${err.message}`);
  process.exit(1);
}

console.log(`Asked process ${pid} to open its inspector.`);
console.log("Its own output now shows: Debugger listening on ws://127.0.0.1:9229/...");
console.log('Attach with the "Attach to Node (9229)" run configuration.');
