const config = {
  // Relative by default, so the browser only ever talks to this origin and the
  // Next rewrite proxies through to the API — no CORS, one public URL.
  // Set NEXT_PUBLIC_API_BASE_URL to call a backend directly instead.
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1",
  // The API's health URL, called directly (not through the proxy) to wake it
  // when it has gone to sleep. Set from BACKEND_ORIGIN in next.config.mjs.
  wakeUrl: process.env.NEXT_PUBLIC_WAKE_URL || null,
};

export default config;
