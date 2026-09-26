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

function normalizeError(err) {
  const message =
    err.response?.data?.error?.message ||
    err.response?.data?.message ||
    err.message ||
    "Request failed";
  const normalized = new Error(message);
  normalized.status = err.response?.status;
  normalized.details = err.response?.data?.error?.details || err.response?.data?.errors;
  return normalized;
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    const isAuthCall = original?.url?.includes("/auth/");

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
