const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const money = require("../utils/money");
const { issue, qrContent } = require("../utils/ticketToken");

/**
 * The ticket as a passenger receives it: one page per ticket, each with its own
 * QR.
 *
 * Built in memory and handed back as a buffer rather than written to disk. A
 * ticket is derivable from the booking at any time, so storing the file would
 * only create something to keep in sync, back up, and clean up. Regenerating it
 * costs milliseconds.
 *
 * Laid out for the conditions it will actually be used in: a phone screen at
 * arm's length, or a page printed on an office printer and folded in a pocket.
 * Seat and coach are the largest things on the page, because that is what a
 * passenger looks for while walking down a platform, and the QR sits away from
 * the fold.
 */

const INK = {
  ink: "#111827",
  muted: "#6b7280",
  rule: "#d1d5db",
  accent: "#1d4ed8",
  panel: "#f3f4f6",
};

const PAGE = { size: "A4", margin: 48 };

/** Renders the QR as a PNG buffer at a size that survives a cheap printer. */
async function qrImage(token) {
  return QRCode.toBuffer(qrContent(token), {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  });
}

const dateLong = (value) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00+06:00`);
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Dhaka",
  });
};

/** One ticket, one page. */
function drawTicket(doc, { booking, ticket, qr, index, total }) {
  const left = PAGE.margin;
  const right = doc.page.width - PAGE.margin;
  const width = right - left;

  doc.fillColor(INK.accent).fontSize(20).font("Helvetica-Bold")
    .text("Bangladesh Railway", left, PAGE.margin);
  doc.fillColor(INK.muted).fontSize(10).font("Helvetica")
    .text("Electronic ticket", left, doc.y + 2);

  if (total > 1) {
    doc.fillColor(INK.muted).fontSize(10)
      .text(`Ticket ${index + 1} of ${total}`, left, PAGE.margin + 4, { width, align: "right" });
  }

  let y = PAGE.margin + 58;
  doc.moveTo(left, y).lineTo(right, y).strokeColor(INK.rule).lineWidth(1).stroke();
  y += 24;

  // The train and the journey.
  doc.fillColor(INK.ink).fontSize(18).font("Helvetica-Bold")
    .text(booking.trip?.train?.name || "Train", left, y);
  y = doc.y + 6;

  doc.fillColor(INK.ink).fontSize(13).font("Helvetica")
    .text(
      `${booking.fromStation?.name || "Origin"}  →  ${booking.toStation?.name || "Destination"}`,
      left,
      y
    );
  y = doc.y + 4;

  /*
   * The day this passenger boards, not the day the train left its origin.
   * Joining an overnight service at 00:08 means travelling the day after it set
   * off, and a ticket printing the departure date would send them to the
   * station a night early.
   */
  const boards = booking.boardingDate || booking.trip?.departureDate;
  doc.fillColor(INK.muted).fontSize(11).text(dateLong(boards), left, y);
  y = doc.y + 2;

  if (booking.nightsOnBoard > 0) {
    doc.fillColor(INK.muted).fontSize(9)
      .text(`Arrives ${dateLong(booking.arrivalDate)}`, left, y);
    y = doc.y + 2;
  }
  y += 18;

  // Seat and coach, the two things looked for on a platform.
  const panelHeight = 78;
  doc.roundedRect(left, y, width * 0.56, panelHeight, 6).fill(INK.panel);

  doc.fillColor(INK.muted).fontSize(9).font("Helvetica")
    .text("COACH", left + 18, y + 14);
  doc.fillColor(INK.ink).fontSize(28).font("Helvetica-Bold")
    .text(ticket.coachCode || "—", left + 18, y + 28);

  doc.fillColor(INK.muted).fontSize(9).font("Helvetica")
    .text("SEAT", left + 130, y + 14);
  doc.fillColor(INK.ink).fontSize(28).font("Helvetica-Bold")
    .text(ticket.seatNumber, left + 130, y + 28);

  // The QR, to the right of the seat panel. It is taller than the panel, so the
  // details below start under whichever of the two reaches lower — otherwise the
  // caption and the first detail row land on the same line.
  const qrSize = 116;
  const qrTop = y - 14;
  const captionHeight = 14;
  doc.image(qr, right - qrSize, qrTop, { width: qrSize });
  doc.fillColor(INK.muted).fontSize(8).font("Helvetica")
    .text("Scan to verify", right - qrSize, qrTop + qrSize + 4, { width: qrSize, align: "center" });

  y = Math.max(y + panelHeight, qrTop + qrSize + captionHeight) + 26;

  const rows = [
    ["Passenger", ticket.passengerName],
    ["National ID", ticket.passengerNid],
    ["Date of birth", ticket.passengerDob],
    ["Ticket number", ticket.ticketNumber],
    ["Booking reference", booking.reference],
    ["Fare", money.format(ticket.fareMinor)],
  ];

  for (const [label, value] of rows) {
    doc.fillColor(INK.muted).fontSize(10).font("Helvetica").text(label, left, y, { width: 140 });
    doc.fillColor(INK.ink).fontSize(11).font("Helvetica-Bold")
      .text(String(value ?? "—"), left + 150, y, { width: width - 150 });
    y = doc.y + 10;
  }

  y += 14;
  doc.moveTo(left, y).lineTo(right, y).strokeColor(INK.rule).lineWidth(1).stroke();
  y += 14;

  doc.fillColor(INK.muted).fontSize(9).font("Helvetica").text(
    "Carry the National ID used for this booking. This ticket is valid only for the " +
      "journey, date and seat shown above, and only for the named passenger.",
    left,
    y,
    { width }
  );
}

/**
 * The whole booking as one PDF.
 *
 * @param booking a booking in its public shape, with tickets, stations and trip
 * @returns {Promise<Buffer>}
 */
async function bookingPdf(booking) {
  const tickets = booking.tickets || [];
  const qrs = await Promise.all(tickets.map((ticket) => qrImage(issue(ticket, booking))));

  const doc = new PDFDocument({ size: PAGE.size, margin: PAGE.margin, info: {
    Title: `Ticket ${booking.reference}`,
    Author: "Bangladesh Railway",
    Subject: `${booking.fromStation?.name || ""} to ${booking.toStation?.name || ""}`,
  } });

  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  tickets.forEach((ticket, index) => {
    if (index > 0) doc.addPage();
    drawTicket(doc, { booking, ticket, qr: qrs[index], index, total: tickets.length });
  });

  if (!tickets.length) {
    doc.fillColor(INK.ink).fontSize(14).text(`Booking ${booking.reference} has no tickets.`);
  }

  doc.end();
  return finished;
}

/** A data URI for one ticket's QR, for showing it on screen. */
async function ticketQrDataUrl(ticket, booking) {
  return QRCode.toDataURL(qrContent(issue(ticket, booking)), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  });
}

module.exports = { bookingPdf, ticketQrDataUrl, qrImage };
