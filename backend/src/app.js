const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const env = require("./config/env");
const routes = require("./routes");
const requestContext = require("./middleware/requestContext");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();

// Public dev tunnels (cloudflare/localtunnel/ngrok/VS Code) hand out a fresh
// random hostname each run, so allow their domains by suffix in development
// rather than hardcoding a URL that changes every session.
const TUNNEL_SUFFIXES = [
  ".trycloudflare.com",
  ".loca.lt",
  ".ngrok-free.app",
  ".ngrok.app",
  ".devtunnels.ms",
];

/**
 * Addresses that only exist inside somebody's own network.
 *
 * Loopback, the three RFC 1918 ranges, and link-local. A phone on the same
 * Wi-Fi reaching a laptop is the ordinary way this gets tested, and writing one
 * address into `CORS_ORIGINS` breaks the next time the router hands out a
 * different one.
 *
 * Development only — see the guard in `isAllowedOrigin`. In production, being
 * on a private address is not a reason to trust an origin: it would let
 * anything sharing a network with the server call the API from a browser.
 */
const PRIVATE_HOSTS = [
  /^localhost$/,
  /^\[?::1\]?$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  // 172.16.0.0 – 172.31.255.255, and not 172.32+ which is public.
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
];

const isPrivateHost = (host) => PRIVATE_HOSTS.some((pattern) => pattern.test(host));

function isAllowedOrigin(origin) {
  if (env.corsOrigins.includes(origin)) return true;
  if (!env.isProduction) {
    try {
      const host = new URL(origin).hostname;
      // A dev tunnel, or a machine on the same network as this one.
      return TUNNEL_SUFFIXES.some((s) => host.endsWith(s)) || isPrivateHost(host);
    } catch {
      return false;
    }
  }
  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients (no origin) and any whitelisted origin.
      if (!origin || isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
if (!env.isProduction) app.use(morgan("dev"));

// Opens the per-request context (request id, caller, client details) that the
// audit log reads from. Must sit above the routes.
app.use(requestContext);

// Versioned from the first endpoint, so a breaking change can ship alongside
// the old contract rather than replacing it. `/api` stays as an alias while the
// web client migrates — it must be mounted second, or it would swallow `/v1`.
app.use("/api/v1", routes);
app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
