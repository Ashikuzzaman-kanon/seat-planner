const env = require("../config/env");
const money = require("../utils/money");

/**
 * The look every email shares, as small building blocks.
 *
 * Email is not the web. Most mail clients ignore stylesheets, flexbox, web
 * fonts and SVG; Outlook renders with Word. What survives everywhere is a
 * table-based layout with inline styles, at most 600px wide — so that is what
 * this produces, and no template has to know it.
 *
 * Every piece of text a template passes in is escaped. A passenger called
 * `<b>` or an admin's note with a stray `<` cannot change what the email shows.
 * Where a template does want markup (a bold word in a sentence), it says so
 * with `trusted()`.
 */

const FONT = "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/** Colours per kind of message: the strong one for text and borders, the soft one behind it. */
const TONES = {
  brand: { strong: "#4338ca", soft: "#eef2ff", text: "#312e81" },
  success: { strong: "#15803d", soft: "#ecfdf3", text: "#14532d" },
  warning: { strong: "#b45309", soft: "#fffbeb", text: "#78350f" },
  danger: { strong: "#b91c1c", soft: "#fef2f2", text: "#7f1d1d" },
  neutral: { strong: "#475569", soft: "#f1f5f9", text: "#1e293b" },
};
const tone = (name) => TONES[name] || TONES.brand;

/* ------------------------------------------------------------------ *
 * Escaping
 * ------------------------------------------------------------------ */

const TRUSTED = Symbol("trusted");

/** Markup a template wrote itself, to be inserted as it is. */
const trusted = (html) => ({ [TRUSTED]: String(html) });

function esc(value) {
  if (value && value[TRUSTED] !== undefined) return value[TRUSTED];
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Bold text inside a sentence. */
const strong = (value) => trusted(`<strong style="color:#0f172a;">${esc(value)}</strong>`);

const blank = (value) => value === null || value === undefined || value === "";

/** An amount as a person reads it: "৳ 1,830.40". The screens add the symbol themselves; email has to. */
const taka = (minor) =>
  `৳ ${money.toMajor(minor || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ------------------------------------------------------------------ *
 * Addresses in the app
 * ------------------------------------------------------------------ */

/** The web app's address, for buttons. APP_URL, else the first allowed origin. */
function appUrl(path = "") {
  const base = (env.appUrl || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path}`;
}

/* ------------------------------------------------------------------ *
 * Building blocks — each returns an HTML string
 * ------------------------------------------------------------------ */

const spacer = (px) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:${px}px;line-height:${px}px;font-size:1px;">&nbsp;</td></tr></table>`;

/** A paragraph. */
const paragraph = (text, { muted = false, size = 15 } = {}) =>
  `<p style="margin:0 0 16px;font:${size}px/1.65 ${FONT};color:${muted ? "#64748b" : "#334155"};">${esc(text)}</p>`;

/** A small heading over a section. */
const sectionTitle = (text) =>
  `<p style="margin:6px 0 10px;font:700 12px/1.2 ${FONT};letter-spacing:.07em;text-transform:uppercase;color:#64748b;">${esc(text)}</p>`;

/**
 * The money, large: what the person most wants to know, before anything else.
 * `caption` says what it means ("in your wallet now", "at most, as the seat resells").
 */
function amount({ label, value, caption, tone: t = "success" }) {
  const c = tone(t);
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.soft};border-radius:14px;">
  <tr><td style="padding:18px 22px;">
    <div style="font:700 12px/1.3 ${FONT};letter-spacing:.06em;text-transform:uppercase;color:${c.strong};">${esc(label)}</div>
    <div style="font:800 30px/1.2 ${FONT};color:${c.text};margin-top:6px;">${esc(value)}</div>
    ${caption ? `<div style="font:14px/1.5 ${FONT};color:${c.text};margin-top:6px;opacity:.85;">${esc(caption)}</div>` : ""}
  </td></tr>
</table>${spacer(18)}`;
}

/** Label / value rows in a light panel. Empty values are left out, never shown as blanks. */
function details(pairs) {
  const rows = pairs.filter(([, value]) => !blank(value));
  if (!rows.length) return "";
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:14px;border-collapse:separate;">
  ${rows
    .map(
      ([label, value], i) => `
  <tr>
    <td style="padding:11px 18px;${i ? "border-top:1px solid #eef2f6;" : ""}font:13px/1.45 ${FONT};color:#64748b;width:44%;vertical-align:top;">${esc(label)}</td>
    <td style="padding:11px 18px;${i ? "border-top:1px solid #eef2f6;" : ""}font:600 14px/1.45 ${FONT};color:#0f172a;vertical-align:top;">${esc(value)}</td>
  </tr>`
    )
    .join("")}
</table>${spacer(18)}`;
}

/** A tinted box with a coloured edge: what to do, what to know, what went wrong. */
function callout(text, { tone: t = "brand", title } = {}) {
  const c = tone(t);
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="background:${c.soft};border-left:4px solid ${c.strong};border-radius:10px;padding:14px 18px;font:14px/1.6 ${FONT};color:${c.text};">
    ${title ? `<div style="font-weight:700;margin-bottom:4px;">${esc(title)}</div>` : ""}${esc(text)}
  </td></tr>
</table>${spacer(16)}`;
}

/**
 * The one thing to do next, as a button that works in every client (a table
 * cell with a background, not a styled element), with the address beneath for
 * clients that strip it.
 */
function button(label, url, { tone: t = "brand" } = {}) {
  const c = tone(t);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 10px;">
  <tr><td style="border-radius:11px;background:${c.strong};">
    <a href="${esc(url)}" target="_blank" style="display:inline-block;padding:13px 24px;font:700 15px/1.2 ${FONT};color:#ffffff;text-decoration:none;border-radius:11px;">${esc(label)} &rarr;</a>
  </td></tr>
</table>
<p style="margin:0 0 18px;font:12px/1.5 ${FONT};color:#94a3b8;">Or open <a href="${esc(url)}" style="color:#64748b;">${esc(url)}</a></p>`;
}

/** A one-time code, large and spaced so it can be read off one screen and typed into another. */
function code(digits, { caption } = {}) {
  const shown = String(digits).replace(/(\d{3})(?=\d)/g, "$1 ");
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="background:#f8fafc;border:1px dashed #a5b4fc;border-radius:14px;padding:22px 16px;">
    <div style="font:800 36px/1 'Courier New',Courier,monospace;letter-spacing:8px;color:#0f172a;">${esc(shown)}</div>
    ${caption ? `<div style="font:13px/1.5 ${FONT};color:#64748b;margin-top:10px;">${esc(caption)}</div>` : ""}
  </td></tr>
</table>${spacer(18)}`;
}

/**
 * Where from, where to, when: the shape of a ticket. Times are optional —
 * a cancelled departure or a queue entry may not have them to hand.
 */
function journey({ from, to, departs, arrives, train, date, note }) {
  const end = (name, time, align) => `
      <td style="vertical-align:top;text-align:${align};width:42%;">
        <div style="font:800 18px/1.25 ${FONT};color:#0f172a;">${esc(name || "—")}</div>
        ${time ? `<div style="font:600 14px/1.4 ${FONT};color:#4338ca;margin-top:3px;">${esc(time)}</div>` : ""}
      </td>`;
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;">
  <tr><td style="padding:18px 20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        ${end(from, departs, "left")}
        <td style="vertical-align:middle;text-align:center;font:700 20px/1 ${FONT};color:#a5b4fc;">&rarr;</td>
        ${end(to, arrives, "right")}
      </tr>
    </table>
    ${
      train || date
        ? `<div style="border-top:1px dashed #cbd5e1;margin-top:14px;padding-top:12px;font:13px/1.5 ${FONT};color:#475569;">${[
            train ? `<strong style="color:#0f172a;">${esc(train)}</strong>` : "",
            date ? esc(date) : "",
            note ? esc(note) : "",
          ]
            .filter(Boolean)
            .join(" &middot; ")}</div>`
        : ""
    }
  </td></tr>
</table>${spacer(18)}`;
}

/** Small rounded labels in a row — roles, seats. */
function chips(items, { tone: t = "brand", prefix = "" } = {}) {
  const c = tone(t);
  if (!items.length) return "";
  return `<div style="margin:0 0 6px;">${items
    .map(
      (item) =>
        `<span style="display:inline-block;margin:0 6px 8px 0;padding:6px 12px;border-radius:999px;background:${c.soft};color:${c.text};font:600 13px/1.2 ${FONT};">${esc(prefix)}${esc(item)}</span>`
    )
    .join("")}</div>`;
}

/** Rows of a person and a short tag to their right — passengers and their seats. */
function people(rows) {
  if (!rows.length) return "";
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:14px;border-collapse:separate;">
  ${rows
    .map(
      ([name, tag], i) => `
  <tr>
    <td style="padding:12px 18px;${i ? "border-top:1px solid #eef2f6;" : ""}font:600 14px/1.4 ${FONT};color:#0f172a;">${esc(name)}</td>
    <td align="right" style="padding:12px 18px;${i ? "border-top:1px solid #eef2f6;" : ""}"><span style="display:inline-block;padding:5px 10px;border-radius:8px;background:#eef2ff;color:#3730a3;font:700 13px/1.2 ${FONT};white-space:nowrap;">${esc(tag)}</span></td>
  </tr>`
    )
    .join("")}
</table>${spacer(18)}`;
}

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

/**
 * Wrap a message in the shared frame: brand bar, card, footer.
 *
 * `eyebrow` names the kind of message (Refund, Cancelled, Your account…) in
 * the message's colour; `preheader` is the line inbox lists show after the
 * subject, so it should add to the subject rather than repeat it.
 */
function page({ subject, preheader, eyebrow, tone: t = "brand", title, intro, body = "" }) {
  const c = tone(t);
  // The logo has to come from somewhere the reader's mail client can reach: a
  // local address (testing on a laptop) cannot be fetched by Gmail, so the
  // live site's copy is used instead.
  const local = /\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(appUrl());
  const logo = local ? "https://seat-planner-sable.vercel.app/apple-icon.png" : appUrl("/apple-icon.png");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject || title)}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f7;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader || "")}${"&nbsp;&zwnj;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;">
  <tr><td align="center" style="padding:28px 12px 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

      <tr><td style="background:#4f46e5;background-image:linear-gradient(135deg,#2563eb 0%,#4f46e5 55%,#7c3aed 100%);border-radius:18px 18px 0 0;padding:18px 28px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;"><img src="${esc(logo)}" width="38" height="38" alt="Seat Planner" style="display:block;border:0;border-radius:10px;"></td>
          <td style="vertical-align:middle;padding-left:12px;">
            <div style="font:800 17px/1.15 ${FONT};color:#ffffff;">Seat Planner</div>
            <div style="font:500 12px/1.3 ${FONT};color:#c7d2fe;">Railway ticketing</div>
          </td>
        </tr></table>
      </td></tr>

      <tr><td style="background:#ffffff;border-radius:0 0 18px 18px;padding:30px 28px 26px;box-shadow:0 10px 30px -12px rgba(15,23,42,.18);">
        ${eyebrow ? `<span style="display:inline-block;padding:5px 11px;border-radius:999px;background:${c.soft};color:${c.strong};font:800 11px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;">${esc(eyebrow)}</span>` : ""}
        <h1 style="margin:${eyebrow ? "14px" : "0"} 0 10px;font:800 25px/1.25 ${FONT};color:#0f172a;">${esc(title)}</h1>
        ${intro ? `<p style="margin:0 0 22px;font:16px/1.6 ${FONT};color:#475569;">${esc(intro)}</p>` : ""}
        ${body}
      </td></tr>

      <tr><td style="padding:22px 24px 0;text-align:center;font:12px/1.65 ${FONT};color:#64748b;">
        You are receiving this because it concerns your Seat Planner account.<br>
        <a href="${esc(appUrl("/dashboard"))}" style="color:#4338ca;text-decoration:none;font-weight:600;">Open Seat Planner</a>
        &nbsp;&middot;&nbsp;
        <a href="${esc(appUrl("/privacy"))}" style="color:#4338ca;text-decoration:none;font-weight:600;">Privacy</a><br>
        <span style="color:#94a3b8;">A demonstration ticketing system — not affiliated with Bangladesh Railway.</span>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/* ------------------------------------------------------------------ *
 * The plain-text version
 * ------------------------------------------------------------------ */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", middot: "·", rarr: "→", zwnj: "" };

/**
 * The same message as plain text, for clients that show no HTML and for spam
 * filters that look for one. Links keep their address; tables become lines.
 */
function toText(html) {
  return String(html)
    .replace(/<head>[\s\S]*?<\/head>/i, "")
    .replace(/<div style="display:none[\s\S]*?<\/div>/i, "")
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, label) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      const url = href.replace(/&amp;/g, "&");
      return text && !text.includes(url) && !text.startsWith("Or open") ? `${text} (${url})` : text || url;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|tr|table)>/gi, "\n")
    .replace(/<\/td>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#?\w+);/g, (m, name) => (name in ENTITIES ? ENTITIES[name] : m))
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = {
  page,
  paragraph,
  sectionTitle,
  amount,
  details,
  callout,
  button,
  code,
  journey,
  chips,
  people,
  strong,
  trusted,
  esc,
  taka,
  appUrl,
  toText,
  TONES,
};
