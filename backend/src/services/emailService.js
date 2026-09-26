const nodemailer = require("nodemailer");
const env = require("../config/env");

let transporter = null;

if (env.email.host) {
  transporter = nodemailer.createTransport({
    host: env.email.host,
    port: env.email.port,
    secure: env.email.secure,
    auth: env.email.user
      ? { user: env.email.user, pass: env.email.pass }
      : undefined,
  });
} else {
  // No SMTP configured: fall back to logging so the flow is testable in dev.
  console.warn(
    "[email] EMAIL_HOST is not set — verification codes will be logged to the console instead of emailed."
  );
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
  if (!transporter || isUnroutable(to)) {
    const files = attachments?.length
      ? `\n[email] Attachments: ${attachments
          .map((a) => `${a.filename} (${a.content?.length ?? 0} bytes)`)
          .join(", ")}`
      : "";
    // Long bodies are truncated: the console is for confirming the mail went
    // out, not for reading a ticket in.
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const why = transporter ? "unroutable address" : "no SMTP configured";
    console.info(
      `\n[email:${why}] To: ${to}\n[email] Subject: ${subject}${files}\n[email] ${text.slice(0, 400)}${
        text.length > 400 ? "…" : ""
      }\n`
    );
    return;
  }
  await transporter.sendMail({
    from: env.email.from,
    to,
    subject,
    html,
    ...(attachments?.length ? { attachments } : {}),
  });
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
};
