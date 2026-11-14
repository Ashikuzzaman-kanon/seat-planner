/**
 * Demo 7, second example: a path that works on Windows and fails on Linux.
 *
 * The file is lib/format.js; this asks for lib/Format.js. Windows does not
 * care about upper and lower case in file names, so it runs. Linux (the
 * Docker image, CI, Render) does, so it crashes with "Cannot find module".
 *
 *   node demo/debugging/paths.js        Windows: works
 *
 *   Linux: fails, but only on a COPY of the files. A folder mounted from Windows
 *   (docker run -v) stays case-insensitive and hides the bug; a Dockerfile's
 *   COPY, CI and Render all have their own case-sensitive copy. So:
 *   docker run --rm -v "${PWD}/demo/debugging:/src:ro" node:20-alpine sh -c "cp -r /src /work && node /work/paths.js"
 */
const { taka } = require("./lib/Format"); // the real file is lib/format.js

console.log(`Fare: ${taka(1250)} on ${process.platform}`);
