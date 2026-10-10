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

const siteCors = cors({
  origin(origin, callback) {
    // Allow non-browser clients (no origin) and any whitelisted origin.
    if (!origin || isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
});

/*
 * The subscription check is called from anywhere — a page on any other site
 * included — so it alone answers every origin.
 *
 * That is safe to open where the rest of the API is not, because nothing of
 * the browser's own goes with the call: no cookie, no stored token. The
 * caller has to send the email and password itself, so another site learns
 * nothing it was not already given. Credentials mode stays off, and
 * Retry-After is exposed so a page can read how long a pause lasts.
 */
const OPEN_TO_ANY_ORIGIN = /^\/api(?:\/v1)?\/subscriptions\/check\/?$/;
const openCors = cors({
  origin: "*",
  methods: ["POST"],
  allowedHeaders: ["Content-Type"],
  exposedHeaders: ["Retry-After"],
  maxAge: 86_400,
});

app.use((req, res, next) => (OPEN_TO_ANY_ORIGIN.test(req.path) ? openCors : siteCors)(req, res, next));

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
