// The bundled QR decoder actually reads a real ticket's QR.
//
// This exists because the first version of the scanner assumed Chrome ships
// `BarcodeDetector` and told people on Windows their browser could not read QR
// codes. That was wrong and it shipped, so the fallback gets a test that
// decodes a genuine ticket image rather than a claim that it will.
const path = require("path");
const FRONTEND = require("path").resolve(__dirname, "../../../../frontend");
const BACKEND = require("path").resolve(__dirname, "../../..");

let pass = 0;
let fail = 0;
const check = (what, ok, note = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what} ${ok ? "" : note}`);
  ok ? pass++ : fail++;
};

(async () => {
  const jsQR = require("jsqr").default
    || require("jsqr");
  const QRCode = require(path.join(BACKEND, "node_modules/qrcode"));
  const ticketToken = require(path.join(BACKEND, "src/utils/ticketToken"));
  const { sequelize, Ticket, Booking, Trip } = require(path.join(BACKEND, "src/models"));

  console.log("\n== the bundled decoder reads a real ticket QR ==");

  const ticket = await Ticket.findOne({
    where: { status: "valid" },
    include: [{ model: Booking, as: "booking", include: [{ model: Trip, as: "trip" }] }],
    order: [["id", "DESC"]],
  });
  check("a real ticket exists to encode", !!ticket, "no valid ticket in the database");

  // Exactly what the PDF and the QR endpoint put in the code.
  const token = ticketToken.issue(ticket, ticket.booking);
  const content = ticketToken.qrContent(token);
  check("its token signs and encodes", typeof content === "string" && content.length > 40,
    `${content?.length} chars`);

  /*
   * Render it the way the ticket does, then decode the pixels the way the
   * browser fallback does — canvas in, jsQR out.
   */
  const png = await QRCode.toBuffer(content, { type: "png", width: 512, margin: 2 });
  check("the QR renders to an image", png.length > 0, `${png.length} bytes`);

  // Decode the PNG to raw RGBA without pulling in a canvas library.
  const { PNG } = (() => {
    try {
      return require(path.join(BACKEND, "node_modules/pngjs"));
    } catch {
      return {};
    }
  })();

  if (!PNG) {
    console.log("  SKIP  pixel decode — pngjs is not installed, so the image cannot be unpacked here");
    console.log(`\n${pass} passed, ${fail} failed`);
    await sequelize.close();
    process.exit(fail ? 1 : 0);
  }

  const image = PNG.sync.read(png);
  const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height, {
    inversionAttempts: "dontInvert",
  });

  check("jsQR decodes it", !!decoded?.data, "the bundled reader could not read a genuine ticket QR");
  check("and gets back exactly what was encoded", decoded?.data === content,
    `${String(decoded?.data).slice(0, 60)} vs ${content.slice(0, 60)}`);

  // And the thing the checker page does with that string.
  const fromUrl = /[?&]t=([^&]+)/.exec(decoded.data);
  const raw = fromUrl ? decodeURIComponent(fromUrl[1]) : decoded.data;
  const verified = ticketToken.verify(raw);
  check("the decoded string verifies as a genuine ticket", verified.valid === true,
    verified.message);
  check("and names the right ticket", verified.ticket?.ticketNumber === ticket.ticketNumber,
    `${verified.ticket?.ticketNumber} vs ${ticket.ticketNumber}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  await sequelize.close();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error("\nsuite crashed:", err.message);
  process.exit(1);
});
