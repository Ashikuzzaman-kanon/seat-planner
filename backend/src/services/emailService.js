const nodemailer = require("nodemailer");
const MailComposer = require("nodemailer/lib/mail-composer");
const env = require("../config/env");
const ApiError = require("../utils/ApiError");

/*
 * How mail leaves the building, in order of preference:
 *
 * 1. The Gmail API, when GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and
 *    GMAIL_REFRESH_TOKEN are all set.
 * 2. Brevo's HTTP API, when BREVO_API_KEY is set.
 * 3. SMTP, when EMAIL_HOST is set — Gmail and the like, for local development.
 * 4. None of them: messages are written to the console, so every flow still runs.
 *
 * The first two go out over HTTPS, so they work where outbound SMTP is
 * blocked — Render's free web services have refused ports 25, 465 and 587
 * since September 2025.
 *
 * Every route is bounded in time. A mail server that never answers must not
 * hold a sign-up or a booking open while it fails to: unbounded, nodemailer
 * waits two minutes for a connection, which is longer than the proxy in front
 * of the API waits for the response.
 */
const SEND_TIMEOUT_MS = 15_000;

const { gmail: gmailConfig } = env.email;
const gmail = Boolean(gmailConfig.clientId && gmailConfig.clientSecret && gmailConfig.refreshToken);
const brevo = !gmail && Boolean(env.email.brevoApiKey);

let transporter = null;

if (gmail) {
  console.info("[email] sending through the Gmail API");
} else if (brevo) {
  console.info("[email] sending through Brevo's HTTP API");
} else if (env.email.host) {
  transporter = nodemailer.createTransport({
    host: env.email.host,
    port: env.email.port,
    secure: env.email.secure,
    auth: env.email.user
      ? { user: env.email.user, pass: env.email.pass }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: SEND_TIMEOUT_MS,
  });
  console.info(`[email] sending through SMTP at ${env.email.host}:${env.email.port}`);
} else {
  // No SMTP configured: fall back to logging so the flow is testable in dev.
  console.warn(
    "[email] No GMAIL_*, BREVO_API_KEY or EMAIL_HOST is set — verification codes will be logged to the console instead of emailed."
  );
}

/** "Seat Planner <no-reply@x.com>" -> { name: "Seat Planner", email: "no-reply@x.com" } */
function parseAddress(value) {
  const text = String(value || "").trim();
  const match = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(text);
  if (!match) return { email: text };
  const name = match[1].trim();
  return name ? { name, email: match[2].trim() } : { email: match[2].trim() };
}

/** The request body Brevo's transactional email endpoint takes. */
function brevoPayload({ from, to, subject, html, attachments }) {
  return {
    sender: parseAddress(from),
    to: [{ email: to }],
    subject,
    htmlContent: html,
    ...(attachments?.length
      ? {
          attachment: attachments.map((a) => ({
            name: a.filename,
            content: Buffer.from(a.content).toString("base64"),
          })),
        }
      : {}),
  };
}

async function sendWithBrevo(message) {
  const res = await fetch(env.email.brevoUrl, {
    method: "POST",
    headers: {
      "api-key": env.email.brevoApiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(brevoPayload({ from: env.email.from, ...message })),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Brevo refused the message (HTTP ${res.status}) ${detail}`.trim());
  }
}

/*
 * The Gmail API.
 *
 * A refresh token — granted once, by the account owner, for the gmail.send
 * scope only — is traded for an access token lasting about an hour, which is
 * kept and reused until shortly before it runs out. The message itself is an
 * ordinary MIME message, built by nodemailer exactly as SMTP would send it,
 * handed over base64url-encoded.
 */
let gmailToken = null; // { value, expiresAt }

async function gmailAccessToken({ fresh = false } = {}) {
  if (!fresh && gmailToken && gmailToken.expiresAt > Date.now() + 60_000) return gmailToken.value;

  const res = await fetch(gmailConfig.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: gmailConfig.clientId,
      client_secret: gmailConfig.clientSecret,
      refresh_token: gmailConfig.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    gmailToken = null;
    // invalid_grant is the one people meet: the token was revoked, or it came
    // from an OAuth app still in "Testing", whose tokens die after seven days.
    const hint =
      body.error === "invalid_grant"
        ? " — the refresh token was revoked or has expired (an OAuth app left in Testing expires them after 7 days); get a new one"
        : "";
    throw new Error(`Google refused the refresh token (HTTP ${res.status} ${body.error || ""})${hint}`);
  }
  gmailToken = { value: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
  return gmailToken.value;
}

/** The message as Gmail's `messages.send` takes it: raw MIME, base64url. */
async function gmailRaw({ from, to, subject, html, attachments }) {
  const mime = await new MailComposer({
    from,
    to,
    subject,
    html,
    ...(attachments?.length ? { attachments } : {}),
  })
    .compile()
    .build();
  return mime.toString("base64url");
}

async function sendWithGmail(message) {
  const raw = await gmailRaw({ from: env.email.from, ...message });
  const send = async (token) =>
    fetch(gmailConfig.sendUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

  let res = await send(await gmailAccessToken());
  // A token Google has stopped honouring before its time: get another, once.
  if (res.status === 401) res = await send(await gmailAccessToken({ fresh: true }));
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Gmail refused the message (HTTP ${res.status}) ${detail}`.trim());
  }
}

/**
 * Domains RFC 2606 and RFC 6761 set aside so they can never receive mail.
 *
 * Anything addressed here is a seeded, fixture or placeholder account. Handing
 * it to a real SMTP server achieves nothing except a bounce arriving in the
 * sender's own inbox, and — on a shared provider like Gmail — a slow accrual of
 * failed deliveries against the sending reputation of a real address.
 *
 * So these are logged like an unconfigured transport: the flow still runs end
 * to end and is still observable, the message just never leaves the building.
 */
const UNROUTABLE = [
  /@example\.(com|net|org)$/i,
  // The leading [.@] matters: `root@localhost` has no dot before the label, and
  // an unanchored match would also swallow a real domain like `examples.com`.
  /[.@](test|example|invalid|localhost)$/i,
];

const isUnroutable = (address) => UNROUTABLE.some((pattern) => pattern.test(String(address || "").trim()));

async function sendMail({ to, subject, html, attachments }) {
  const routed = gmail || brevo || Boolean(transporter);
  if (!routed || isUnroutable(to)) {
    const files = attachments?.length
      ? `\n[email] Attachments: ${attachments
          .map((a) => `${a.filename} (${a.content?.length ?? 0} bytes)`)
          .join(", ")}`
      : "";
    // Long bodies are truncated: the console is for confirming the mail went
    // out, not for reading a ticket in.
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const why = routed ? "unroutable address" : "no email route configured";
    console.info(
      `\n[email:${why}] To: ${to}\n[email] Subject: ${subject}${files}\n[email] ${text.slice(0, 400)}${
        text.length > 400 ? "…" : ""
      }\n`
    );
    return;
  }

  try {
    if (gmail) {
      await sendWithGmail({ to, subject, html, attachments });
    } else if (brevo) {
      await sendWithBrevo({ to, subject, html, attachments });
    } else {
      await transporter.sendMail({
        from: env.email.from,
        to,
        subject,
        html,
        ...(attachments?.length ? { attachments } : {}),
      });
    }
  } catch (err) {
    // The cause goes to the server log; the caller gets something a person
    // can act on. 503, not 500: nothing is wrong with the request, and trying
    // again later is the right response — a queued job retries on it too.
    const why = err.name === "TimeoutError" ? `no answer within ${SEND_TIMEOUT_MS / 1000}s` : err.message;
    console.error(`[email] could not send "${subject}" to ${to}: ${why}`);
    throw new ApiError(503, "The email could not be sent just now. Please try again in a minute.");
  }
}

function otpTemplate(title, intro, code, ttlMinutes) {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <h2 style="color: #2563eb;">${title}</h2>
      <p>${intro}</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px; color: #111827;">${code}</p>
      <p style="color: #6b7280;">This code expires in ${ttlMinutes} minutes. If you didn't request it, you can ignore this email.</p>
    </div>`;
}

async function sendVerificationEmail(to, code, ttlMinutes) {
  await sendMail({
    to,
    subject: "Verify your email",
    html: otpTemplate(
      "Email Verification",
      "Use the code below to verify your account:",
      code,
      ttlMinutes
    ),
  });
}

async function sendPasswordResetEmail(to, code, ttlMinutes) {
  await sendMail({
    to,
    subject: "Reset your password",
    html: otpTemplate(
      "Password Reset",
      "Use the code below to reset your password:",
      code,
      ttlMinutes
    ),
  });
}

/**
 * The confirmation a passenger gets the moment a purchase completes.
 *
 * The tickets are attached as a PDF *and* summarised in the body, because the
 * two get used differently: the body is what someone glances at on a phone to
 * check they booked the right day, and the attachment is what they show at the
 * gate. The booking reference appears in the subject so the mail is findable by
 * search months later.
 */
function bookingTemplate(booking) {
  const row = (label, value) => `
    <tr>
      <td style="padding:6px 16px 6px 0;color:#6b7280;font-size:13px;">${label}</td>
      <td style="padding:6px 0;color:#111827;font-size:14px;font-weight:600;">${value}</td>
    </tr>`;

  const tickets = (booking.tickets || [])
    .map(
      (t) => `
      <tr>
        <td style="padding:8px 0;border-top:1px solid #e5e7eb;font-size:14px;color:#111827;">
          ${t.passengerName}
        </td>
        <td style="padding:8px 0;border-top:1px solid #e5e7eb;font-size:14px;color:#111827;text-align:right;">
          Coach <strong>${t.coachCode || "—"}</strong>, seat <strong>${t.seatNumber}</strong>
        </td>
      </tr>`
    )
    .join("");

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#1f2937;max-width:560px;">
      <h2 style="color:#1d4ed8;margin:0 0 4px;">Your tickets are confirmed</h2>
      <p style="margin:0 0 20px;color:#6b7280;">
        Booking reference <strong style="color:#111827;">${booking.reference}</strong>
      </p>

      <table style="border-collapse:collapse;margin-bottom:20px;">
        ${row("Train", booking.trip?.train?.name || "—")}
        ${row("Journey", `${booking.fromStation?.name || "—"} → ${booking.toStation?.name || "—"}`)}
        ${row(
          "Travelling on",
          booking.boardingDate || booking.trip?.departureDate || "—"
        )}
        ${
          booking.nightsOnBoard > 0
            ? row("Arriving", `${booking.arrivalDate} (the next day)`)
            : ""
        }
        ${row("Total paid", booking.totalFormatted || "—")}
      </table>

      <table style="border-collapse:collapse;width:100%;margin-bottom:20px;">${tickets}</table>

      <p style="color:#6b7280;font-size:13px;margin:0 0 8px;">
        Your tickets are attached as a PDF, one page each with its own QR code.
        Carry the National ID used for this booking.
      </p>
      <p style="color:#6b7280;font-size:13px;margin:0;">
        Tickets are valid only for the journey, date, seat and passenger shown.
      </p>
    </div>`;
}

async function sendBookingConfirmation({ to, booking, pdf }) {
  await sendMail({
    to,
    subject: `Tickets confirmed — ${booking.reference}`,
    html: bookingTemplate(booking),
    attachments: pdf
      ? [{ filename: `ticket-${booking.reference}.pdf`, content: pdf, contentType: "application/pdf" }]
      : undefined,
  });
}

module.exports = {
  sendMail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendBookingConfirmation,
  bookingTemplate,
  // Exported so the guard is tested as it is used, rather than through a copy
  // of the patterns that can quietly drift out of step with these.
  isUnroutable,
  parseAddress,
  brevoPayload,
  gmailRaw,
};
