/**
 * Counting requests in fixed windows, in memory: "at most N in this minute".
 *
 * Per process, like the settings cache; a restart starts the counts again,
 * which is fine for a limit whose job is to stop a flood, not to keep books.
 */
function createLimiter() {
  const windows = new Map();

  /** Count one against `key`; whether it is within `limit` for its window, and if not how long to wait. */
  function hit(key, limit, windowMs, now = Date.now()) {
    const start = Math.floor(now / windowMs) * windowMs;
    const id = `${key}@${windowMs}`;
    let w = windows.get(id);
    if (!w || w.start !== start) {
      w = { start, count: 0 };
      windows.set(id, w);
    }
    w.count += 1;
    if (windows.size > 50000) sweep(now);
    const ok = w.count <= limit;
    return { ok, count: w.count, retryAfterSeconds: ok ? 0 : Math.ceil((start + windowMs - now) / 1000) };
  }

  function sweep(now = Date.now()) {
    for (const [id, w] of windows) {
      const windowMs = Number(id.slice(id.lastIndexOf("@") + 1));
      if (w.start + windowMs <= now) windows.delete(id);
    }
  }

  return { hit, sweep, clear: () => windows.clear(), size: () => windows.size };
}

module.exports = { createLimiter };
