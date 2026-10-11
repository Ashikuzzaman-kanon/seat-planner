const fs = require("fs");
const nodemailer = require("nodemailer");
const MailComposer = require("nodemailer/lib/mail-composer");
const env = require("../config/env");
const ApiError = require("../utils/ApiError");
const ui = require("../emails/layout");

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

// Startup chatter is skipped under test; everything else behaves the same.
const say = env.isTest ? () => {} : (...args) => console.info(...args);

if (gmail) {
  say("[email] sending through the Gmail API");
} else if (brevo) {
  say("[email] sending through Brevo's HTTP API");
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
  say(`[email] sending through SMTP at ${env.email.host}:${env.email.port}`);
} else {
  // No SMTP configured: fall back to logging so the flow is testable in dev.
  if (!env.isTest) console.warn(
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
function brevoPayload({ from, to, subject, html, text, attachments }) {
  return {
    sender: parseAddress(from),
    to: [{ email: to }],
    subject,
    htmlContent: html,
    ...(text ? { textContent: text } : {}),
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
async function gmailRaw({ from, to, subject, html, text, attachments }) {
  const mime = await new MailComposer({
    from,
    to,
    subject,
    html,
    ...(text ? { text } : {}),
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

async function sendMail({ to, subject, html, text, attachments }) {
  const routed = gmail || brevo || Boolean(transporter);
  // Every message goes out with a plain-text version too: some clients show
  // nothing else, and spam filters look for one.
  const plain = text || ui.toText(html);
  if (!routed || isUnroutable(to)) {
    const files = attachments?.length
      ? `\n[email] Attachments: ${attachments
          .map((a) => `${a.filename} (${a.content?.length ?? 0} bytes)`)
          .join(", ")}`
      : "";
    const why = routed ? "unroutable address" : "no email route configured";
    if (env.email.outbox) {
      fs.appendFileSync(
        env.email.outbox,
        `${JSON.stringify({ at: new Date().toISOString(), why, to, subject, text: plain, attachments: (attachments || []).map((a) => a.filename) })}\n`
      );
    }
    // Long bodies are truncated: the console is for confirming the mail went
    // out, not for reading a ticket in.
    say(
      `\n[email:${why}] To: ${to}\n[email] Subject: ${subject}${files}\n${plain.slice(0, 600)}${
        plain.length > 600 ? "…" : ""
      }\n`
    );
    return;
  }

  try {
    if (gmail) {
      await sendWithGmail({ to, subject, html, text: plain, attachments });
    } else if (brevo) {
      await sendWithBrevo({ to, subject, html, text: plain, attachments });
    } else {
      await transporter.sendMail({
        from: env.email.from,
        to,
        subject,
        html,
        text: plain,
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

/* ------------------------------------------------------------------ *
 * Codes: verifying an address, resetting a password
 * ------------------------------------------------------------------ */

function verificationEmail(to, code, ttlMinutes) {
  const subject = "Your Seat Planner verification code";
  return {
    subject,
    html: ui.page({
      subject,
      preheader: `${code} — enter it to finish creating your account. It expires in ${ttlMinutes} minutes.`,
      eyebrow: "Verify your email",
      title: "Your verification code",
      intro: "Enter this code to finish creating your Seat Planner account.",
      body:
        ui.code(code, { caption: `Expires in ${ttlMinutes} minutes` }) +
        ui.button("Enter the code", ui.appUrl(`/verify-email?email=${encodeURIComponent(to)}`)) +
        ui.callout("If you did not sign up for Seat Planner, ignore this email — nothing happens without the code.", {
          tone: "neutral",
        }),
    }),
  };
}

function passwordResetEmail(to, code, ttlMinutes) {
  const subject = "Your Seat Planner password reset code";
  return {
    subject,
    html: ui.page({
      subject,
      preheader: `${code} — use it to choose a new password. It expires in ${ttlMinutes} minutes.`,
      eyebrow: "Password reset",
      title: "Reset your password",
      intro: "Use this code to choose a new password. Every device signed in to your account will be signed out.",
      body:
        ui.code(code, { caption: `Expires in ${ttlMinutes} minutes` }) +
        ui.button("Choose a new password", ui.appUrl(`/reset-password?email=${encodeURIComponent(to)}`)) +
        ui.callout(
          "Did not ask for this? Your password has not changed, and it will not unless someone enters this code. " +
            "You can safely ignore this email.",
          { tone: "warning", title: "Not you?" }
        ),
    }),
  };
}

async function sendVerificationEmail(to, code, ttlMinutes) {
  await sendMail({ to, ...verificationEmail(to, code, ttlMinutes) });
}

async function sendPasswordResetEmail(to, code, ttlMinutes) {
  await sendMail({ to, ...passwordResetEmail(to, code, ttlMinutes) });
}

/**
 * The confirmation a passenger gets the moment a purchase completes.
 *
 * The tickets are attached as a PDF *and* summarised in the body, because the
 * two get used differently: the body is what someone glances at on a phone to
 * check they booked the right day, and the attachment is what they show at the
 * gate. The booking reference appears in the subject so the mail is findable by
 * search months later.
 *
 * `times` — when the train leaves the passenger's station and reaches theirs —
 * is looked up by the caller; without it the journey simply shows no times.
 */
function bookingTemplate(booking, times = {}) {
  const tickets = booking.tickets || [];
  const date = booking.boardingDate || booking.trip?.departureDate || "—";
  const arrivesNote = booking.nightsOnBoard > 0 ? `arrives ${booking.arrivalDate} (the next day)` : null;

  return ui.page({
    subject: `Tickets confirmed — ${booking.reference}`,
    preheader: `${booking.trip?.train?.name || "Your train"}, ${date}: ${tickets.length} ticket${tickets.length === 1 ? "" : "s"}, PDF attached.`,
    eyebrow: "Booking confirmed",
    tone: "success",
    title: "Your tickets are confirmed",
    intro: ui.trusted(
      `Booking reference ${ui.esc(ui.strong(booking.reference || "—"))}. Your tickets are attached as a PDF — one page each, with its own QR code.`
    ),
    body:
      ui.journey({
        from: booking.fromStation?.name || "—",
        to: booking.toStation?.name || "—",
        departs: times.departs,
        arrives: times.arrives,
        train: booking.trip?.train?.name || "—",
        date,
        note: arrivesNote,
      }) +
      (tickets.length ? ui.sectionTitle(`Passengers (${tickets.length})`) : "") +
      ui.people(
        tickets.map((t) => [t.passengerName || "—", `Coach ${t.coachCode || "—"} · Seat ${t.seatNumber || "—"}`])
      ) +
      ui.amount({
        label: "Total paid",
        value: booking.totalMinor != null ? ui.taka(booking.totalMinor) : booking.totalFormatted || "—",
        tone: "brand",
      }) +
      ui.button("View your tickets", ui.appUrl("/dashboard/bookings")) +
      ui.callout(
        "Carry the National ID used for this booking. Tickets are valid only for the journey, date, seat and passenger shown.",
        { tone: "neutral" }
      ),
  });
}

async function sendBookingConfirmation({ to, booking, pdf, times }) {
  await sendMail({
    to,
    subject: `Tickets confirmed — ${booking.reference}`,
    html: bookingTemplate(booking, times),
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
  verificationEmail,
  passwordResetEmail,
  // Exported so the guard is tested as it is used, rather than through a copy
  // of the patterns that can quietly drift out of step with these.
  isUnroutable,
  parseAddress,
  brevoPayload,
  gmailRaw,
};
