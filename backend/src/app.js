const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const env = require("./config/env");
const routes = require("./routes");
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

function isAllowedOrigin(origin) {
  if (env.corsOrigins.includes(origin)) return true;
  if (!env.isProduction) {
    try {
      const host = new URL(origin).hostname;
      return TUNNEL_SUFFIXES.some((s) => host.endsWith(s));
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

app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
