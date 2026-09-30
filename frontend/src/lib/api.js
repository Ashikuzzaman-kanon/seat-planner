import axios from "axios";
import config from "@/config";

const ACCESS_KEY = "sp_access_token";
const REFRESH_KEY = "sp_refresh_token";

/* ---------------------------------------------------------------- *
 * Token storage
 * ---------------------------------------------------------------- */

const read = (key) => (typeof window === "undefined" ? null : localStorage.getItem(key));

export const getToken = () => read(ACCESS_KEY);
export const getRefreshToken = () => read(REFRESH_KEY);

/** Store a session, or clear it entirely when passed nothing. */
export function setTokens(session) {
  if (typeof window === "undefined") return;
  if (session?.accessToken) {
    localStorage.setItem(ACCESS_KEY, session.accessToken);
    if (session.refreshToken) localStorage.setItem(REFRESH_KEY, session.refreshToken);
  } else {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }
}

export const clearTokens = () => setTokens(null);

/* ---------------------------------------------------------------- *
 * Client
 * ---------------------------------------------------------------- */

const api = axios.create({ baseURL: config.apiBaseUrl });

api.interceptors.request.use((req) => {
  const token = getToken();
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

// Lets AuthContext react to an unrecoverable session rather than this module
// reaching for window.location.
let onSessionExpired = null;
export function setSessionExpiredHandler(handler) {
  onSessionExpired = handler;
}

/* ---------------------------------------------------------------- *
 * Waking a sleeping server
 * ---------------------------------------------------------------- */

/*
 * The API runs on Render's free tier, which puts it to sleep after 15 idle
 * minutes. A request that reaches a sleeping API through the Vercel proxy is
 * refused with 429 ("hibernate-rate-limited") instead of waking it: those
 * requests come from Vercel's servers, whose wake-ups Render rations. A request
 * the browser makes itself, straight to the API, is held while it starts
 * (about 30 seconds) — so that is how it gets woken.
 *
 * One wake-up at a time: the first refusal starts it, every request refused
 * meanwhile waits for the same one, and then each is sent once more. Only a
 * 429 without a body of ours is treated this way — it provably never reached
 * the API, so sending it again cannot, say, buy a ticket twice.
 */
let wakePromise = null;
let onServerWaking = null;

/** Lets the page show that the server is starting while requests wait for it. */
export function setServerWakingHandler(handler) {
  onServerWaking = handler;
}

const WAKE_TIMEOUT_MS = 90_000;

const refusedWhileAsleep = (err) =>
  err.response?.status === 429 && !err.response?.data?.error && Boolean(config.wakeUrl);

function wakeServer() {
  if (!wakePromise) {
    onServerWaking?.(true);
    // no-cors: the answer itself is not needed, only that one arrived. The
    // request is held until the API is up, and resolves then.
    wakePromise = fetch(config.wakeUrl, {
      mode: "no-cors",
      cache: "no-store",
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
    })
      .then(
        () => true,
        () => false
      )
      .finally(() => {
        onServerWaking?.(false);
        wakePromise = null;
      });
  }
  return wakePromise;
}

/**
 * Access tokens are deliberately short-lived, so a 401 is expected during
 * normal use rather than exceptional. One refresh is attempted per failed
 * request, and concurrent failures share a single in-flight refresh so a burst
 * of requests doesn't rotate the refresh token several times over.
 */
let refreshPromise = null;

async function refreshSession() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error("No refresh token");

  // A bare axios call: routing this through `api` would recurse into this
  // very interceptor.
  const { data } = await axios.post(`${config.apiBaseUrl}/auth/refresh`, { refreshToken });
  setTokens(data);
  return data;
}

/*
 * What to say when the answer carries no message of ours — it came from
 * something in front of the API (the hosting platform's proxy or firewall), or
 * nothing answered at all. axios's own "Request failed with status code 429"
 * means nothing to the person looking at it.
 */
const PLATFORM_MESSAGES = {
  429: "The server is starting up or busy. Wait a minute and try again.",
  502: "The server is starting up or briefly unavailable. Try again in a minute.",
  503: "The server is starting up or briefly unavailable. Try again in a minute.",
  504: "The server took too long to answer. Try again in a minute.",
};

function normalizeError(err) {
  const status = err.response?.status;
  const message =
    err.response?.data?.error?.message ||
    err.response?.data?.message ||
    PLATFORM_MESSAGES[status] ||
    (!err.response ? "Can't reach the server. Check your connection and try again." : null) ||
    err.message ||
    "Request failed";
  const normalized = new Error(message);
  normalized.status = err.response?.status;
  normalized.details = err.response?.data?.error?.details || err.response?.data?.errors;
  return normalized;
}

/*
 * The calls that issue, exchange or revoke tokens. A 401 from one of these is
 * the answer itself ("wrong password", "that refresh token is spent"), not an
 * expired access token, so it is never met with a refresh. Everything else —
 * /auth/me and the profile included — is.
 */
const TOKEN_CALL = /\/auth\/(login|refresh|logout|register|verify-email|resend-verification|forgot-password|reset-password)$/;

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    const isAuthCall = TOKEN_CALL.test(original?.url || "");

    if (refusedWhileAsleep(err) && original && !original._woken) {
      original._woken = true;
      if (await wakeServer()) return api(original);
    }

    if (err.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      try {
        refreshPromise =
          refreshPromise ||
          refreshSession().finally(() => {
            refreshPromise = null;
          });
        const session = await refreshPromise;

        original.headers.Authorization = `Bearer ${session.accessToken}`;
        return api(original);
      } catch {
        clearTokens();
        onSessionExpired?.();
      }
    }

    return Promise.reject(normalizeError(err));
  }
);

export default api;
