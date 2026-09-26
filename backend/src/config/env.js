const path = require("path");
const dotenv = require("dotenv");

// Load .env from the backend root regardless of where the process is started.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "4000", 10),
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306", 10),
    name: required("DB_NAME", "seat_planner"),
    user: required("DB_USER", "root"),
    pass: process.env.DB_PASS || "",
  },

  jwt: {
    secret: required("JWT_SECRET"),
    // Access tokens are deliberately short-lived: they carry identity only, and
    // permissions are re-read per request, so revoking a role takes effect
    // almost immediately instead of lingering until the token expires.
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    // Refresh tokens are long-lived but revocable server-side.
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  },

  verification: {
    ttlMinutes: parseInt(process.env.VERIFICATION_CODE_TTL_MIN || "15", 10),
  },

  ticket: {
    // Signs the payload inside a ticket QR, so a checker can verify a ticket
    // without reaching the database. Separate from JWT_SECRET on purpose: these
    // signatures end up printed on paper in passengers' hands and live as long
    // as the journey, so rotating one must not invalidate everyone's session.
    signingSecret: process.env.TICKET_SIGNING_SECRET || required("JWT_SECRET"),
    // What a scanner opens when the QR is read by a plain camera app.
    verifyUrl: process.env.TICKET_VERIFY_URL || "",
  },

  // MongoDB (document store). Blank = document features disabled.
  mongo: {
    uri: process.env.MONGO_URI || "",
  },

  email: {
    host: process.env.EMAIL_HOST || "",
    port: parseInt(process.env.EMAIL_PORT || "587", 10),
    secure: process.env.EMAIL_SECURE === "true",
    user: process.env.EMAIL_USER || "",
    pass: process.env.EMAIL_PASS || "",
    from: process.env.EMAIL_FROM || "Seat Planner <no-reply@seatplanner.local>",
    // Brevo's HTTP API. When the key is set it is used instead of SMTP — for
    // hosts that block outbound SMTP, as Render's free tier does.
    brevoApiKey: process.env.BREVO_API_KEY || "",
    brevoUrl: process.env.BREVO_API_URL || "https://api.brevo.com/v3/smtp/email",
  },

  superAdmin: {
    name: process.env.SUPER_ADMIN_NAME || "Super Admin",
    email: process.env.SUPER_ADMIN_EMAIL || "",
    password: process.env.SUPER_ADMIN_PASSWORD || "",
  },
};

env.isProduction = env.nodeEnv === "production";

module.exports = env;
