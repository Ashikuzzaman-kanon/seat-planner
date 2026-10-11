/**
 * Render every email the system sends, with sample data, to look at.
 *
 *   node tools/preview-emails.js            → tools/.email-previews/index.html
 *
 * Nothing is sent and no database is needed: the account and station lookups
 * are answered with sample values, and sending is replaced by writing the HTML
 * (and its plain-text version) to files. Open index.html in a browser — or
 * paste a file into an email client — after changing any template.
 */
const path = require("path");
const fs = require("fs");

process.env.NODE_ENV = "test"; // quiet start-up
process.env.EMAIL_HOST = "";
process.env.APP_URL = process.env.APP_URL || "https://seat-planner-sable.vercel.app";

const BACKEND = path.resolve(__dirname, "../backend");
const OUT = path.join(__dirname, ".email-previews");
fs.mkdirSync(OUT, { recursive: true });

const models = require(path.join(BACKEND, "src/models"));
models.User.findByPk = async () => ({ email: "rahim.uddin@example.com" });
models.Station.findByPk = async (id) => ({ name: id === 1 ? "Dhaka (Kamalapur)" : "Dinajpur" });

const email = require(path.join(BACKEND, "src/services/emailService"));
const notify = require(path.join(BACKEND, "src/services/notificationService"));
const waitlist = require(path.join(BACKEND, "src/services/waitlistService"));
const { toText } = require(path.join(BACKEND, "src/emails/layout"));

const rendered = [];
let current = null;
email.sendMail = async ({ subject, html, text }) => {
  rendered.push({ name: current, subject, html, text: text || toText(html) });
};

const money = (n) => Math.round(n * 100);
const refund = (extra = {}) => ({
  reference: "RF7K2M9Q",
  fareMinor: money(915.2),
  refundedMinor: money(823.68),
  maximumMinor: money(823.68),
  deductionPercent: 10,
  ...extra,
});

const samples = [
  ["verification", async () => {
    const m = email.verificationEmail("rahim.uddin@example.com", "482913", 15);
    rendered.push({ name: current, ...m, text: toText(m.html) });
  }],
  ["password-reset", async () => {
    const m = email.passwordResetEmail("rahim.uddin@example.com", "730514", 15);
    rendered.push({ name: current, ...m, text: toText(m.html) });
  }],
  ["booking-confirmed", async () => {
    const booking = {
      reference: "K4M9YT",
      totalFormatted: "৳ 1,830.40",
      fromStation: { name: "Dhaka (Kamalapur)" },
      toStation: { name: "Dinajpur" },
      boardingDate: "2026-10-06",
      arrivalDate: "2026-10-07",
      nightsOnBoard: 1,
      trip: { departureDate: "2026-10-06", train: { name: "Ekota Express" } },
      tickets: [
        { passengerName: "Rahim Uddin", seatNumber: "12", coachCode: "KA" },
        { passengerName: "Nusrat Jahan", seatNumber: "13", coachCode: "KA" },
      ],
    };
    const html = email.bookingTemplate(booking, { departs: "22:00", arrives: "06:15" });
    rendered.push({ name: current, subject: `Tickets confirmed — ${booking.reference}`, html, text: toText(html) });
  }],
  ["return-convenient", () =>
    notify.ticketReturned({ userId: 1, refund: refund(), ticket: { ticketNumber: "TK-4M9Y-01" }, journey: "Dhaka (Kamalapur) → Dinajpur", immediate: true })],
  ["return-demand", () =>
    notify.ticketReturned({ userId: 1, refund: refund({ refundedMinor: 0, maximumMinor: money(864.5) }), ticket: { ticketNumber: "TK-4M9Y-02" }, journey: "Dhaka (Kamalapur) → Dinajpur", immediate: false, segments: 4 })],
  ["return-part-paid", () =>
    notify.refundSegmentSettled({ userId: 1, refund: refund({ refundedMinor: money(310), maximumMinor: money(864.5) }), paidMinor: money(310), remaining: 2 })],
  ["return-complete", () =>
    notify.refundSegmentSettled({ userId: 1, refund: refund({ refundedMinor: money(864.5), maximumMinor: money(864.5) }), paidMinor: money(554.5), remaining: 0 })],
  ["return-closed", () =>
    notify.refundClosedUnsold({ userId: 1, refund: refund({ refundedMinor: 0 }), unsoldSegments: 3 })],
  ["departure-cancelled", () =>
    notify.departureCancelled({ userId: 1, ticket: "TK-4M9Y-01", refundMinor: money(915.2), reason: "Track maintenance between Joydebpur and Tangail", train: "Ekota Express", journey: "Dhaka (Kamalapur) → Dinajpur", date: "2026-10-06" })],
  ["approval-approved", () =>
    notify.approvalDecided({ userId: 1, request: { type: "ticket_transfer", reference: "APTX8Q2M4L" }, approved: true, note: "Identity documents checked.", decidedBy: "Admin 1" })],
  ["approval-rejected", () =>
    notify.approvalDecided({ userId: 1, request: { type: "wallet_withdrawal", reference: "APWD3K9P2N" }, approved: false, note: "The destination account could not be verified.", decidedBy: "Admin 1" })],
  ["roles-granted", () =>
    notify.rolesChanged({
      userId: 1,
      granted: [{ name: "checker", description: "Checks tickets on the train or at the gate, and reports what looks wrong." }],
      revoked: [],
      changedBy: "Super Admin",
      everything: false,
      abilities: [
        { group: "Departures", labels: ["View departures"] },
        { group: "Checking tickets", labels: ["Look up tickets", "Admit passengers", "Report a ticket"] },
        { group: "Buying", labels: ["Buy tickets", "Return tickets", "Join a waitlist"] },
      ],
    })],
  ["roles-changed", () =>
    notify.rolesChanged({
      userId: 1,
      granted: [{ name: "admin", description: "Approves layouts, manages reference data, and delegates access." }],
      revoked: [{ name: "planner", description: "Designs coach seat layouts and submits them for approval." }],
      changedBy: "Super Admin",
      everything: false,
      abilities: [
        { group: "Seat plans", labels: ["View", "Create", "Edit", "Delete", "Approve"] },
        { group: "Departures", labels: ["View departures", "Manage departures", "Cancel departures"] },
        { group: "Users and roles", labels: ["View users", "Change a user's roles", "Create roles"] },
      ],
    })],
  ["account-held", () =>
    notify.accountHeld({ userId: 1, detail: "Three tickets on this account were reported for identity mismatch and upheld on review.", automatic: false })],
  ["account-released", () =>
    notify.accountReleased({ userId: 1, note: "Reviewed with the passenger — the reports were a misunderstanding." })],
  ["waitlist-offer", () =>
    waitlist.notifyOffer(
      { userId: 1, fromStationId: 1, toStationId: 2, reference: "WLQ7M2K9" },
      { train: { name: "Ekota Express" }, departureDate: "2026-10-06" },
      { seats: [{ coachCode: "GA", seatNumber: "24" }, { coachCode: "GA", seatNumber: "25" }] },
      30
    )],
  ["waitlist-missed", () =>
    notify.waitlistOfferExpired({ userId: 1, entry: { reference: "WLQ7M2K9", train: "Ekota Express", journey: "Dhaka (Kamalapur) → Dinajpur", departureDate: "2026-10-06" }, stillQueued: true, offersMade: 1, limit: 3 })],
  ["waitlist-left", () =>
    notify.waitlistOfferExpired({ userId: 1, entry: { reference: "WLQ7M2K9", train: "Ekota Express", journey: "Dhaka (Kamalapur) → Dinajpur", departureDate: "2026-10-06" }, stillQueued: false, offersMade: 3, limit: 3 })],
];

(async () => {
  for (const [name, make] of samples) {
    current = name;
    await make();
  }
  for (const m of rendered) {
    fs.writeFileSync(path.join(OUT, `${m.name}.html`), m.html);
    fs.writeFileSync(path.join(OUT, `${m.name}.txt`), `Subject: ${m.subject}\n\n${m.text}\n`);
  }
  const list = rendered
    .map((m) => `<li><a href="${m.name}.html">${m.name}</a> — ${m.subject.replace(/</g, "&lt;")} <small>(<a href="${m.name}.txt">text</a>)</small></li>`)
    .join("\n");
  fs.writeFileSync(
    path.join(OUT, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Email previews</title><body style="font:15px/1.7 system-ui;margin:32px"><h1>Email previews</h1><ol>${list}</ol></body>`
  );
  console.log(`${rendered.length} emails written to ${OUT}`);
  await models.sequelize.close().catch(() => {});
})();
