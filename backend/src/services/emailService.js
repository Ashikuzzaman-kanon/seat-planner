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

async function sendMail({ to, subject, html }) {
  if (!transporter) {
    console.info(`\n[email:dev] To: ${to}\n[email:dev] Subject: ${subject}\n[email:dev] ${html.replace(/<[^>]+>/g, " ").trim()}\n`);
    return;
  }
  await transporter.sendMail({ from: env.email.from, to, subject, html });
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

module.exports = { sendMail, sendVerificationEmail, sendPasswordResetEmail };
