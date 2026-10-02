const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const env = require("./config/env");
const { originPolicy } = require("./utils/allowedOrigin");
const routes = require("./routes");
const requestContext = require("./middleware/requestContext");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();

// CORS_ORIGINS, with `*` for Vercel previews — see utils/allowedOrigin.js.
const isAllowedOrigin = originPolicy(env.corsOrigins, { production: env.isProduction });

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
if (!env.isProduction && !env.isTest) app.use(morgan("dev"));

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
