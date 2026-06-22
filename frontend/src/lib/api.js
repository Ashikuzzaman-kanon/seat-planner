import axios from "axios";
import config from "@/config";

const TOKEN_KEY = "sp_token";

export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

const api = axios.create({ baseURL: config.apiBaseUrl });

// Attach the bearer token to every request.
api.interceptors.request.use((req) => {
  const token = getToken();
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

// Normalize backend error shape ({ error: { message } }) into Error.message.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const message =
      err.response?.data?.error?.message ||
      err.response?.data?.message ||
      err.message ||
      "Request failed";
    const details = err.response?.data?.error?.details;
    const normalized = new Error(message);
    normalized.status = err.response?.status;
    normalized.details = details;
    return Promise.reject(normalized);
  }
);

export default api;
