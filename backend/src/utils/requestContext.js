const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

/**
 * Per-request context, carried implicitly through the call stack.
 *
 * Audit entries need to know who acted, from where, and as part of which
 * request. Threading that through every service signature would put plumbing
 * into every function that has nothing to do with it, so it rides in
 * AsyncLocalStorage instead — set once by middleware, read wherever needed.
 *
 * The same `requestId` is what will correlate structured log lines later.
 */
const storage = new AsyncLocalStorage();

function runWithContext(context, fn) {
  return storage.run({ requestId: crypto.randomUUID(), ...context }, fn);
}

/** The current request's context, or an empty object outside a request (e.g. seeders). */
function getContext() {
  return storage.getStore() || {};
}

/** Attach values to the live context — used by `authenticate` once the caller is known. */
function setContext(values) {
  const store = storage.getStore();
  if (store) Object.assign(store, values);
}

module.exports = { runWithContext, getContext, setContext };
