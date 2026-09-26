const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

/*
 * Sending through Brevo's HTTP API — the route production uses, because its
 * host blocks outbound SMTP.
 *
 * A local server stands in for Brevo, so these run offline and send nothing.
 * The settings are fixed before the email service is loaded: it decides its
 * route once, at load.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";
process.env.DB_NAME = process.env.DB_NAME || "seat_planner";
process.env.DB_USER = process.env.DB_USER || "root";
process.env.BREVO_API_KEY = "test-brevo-key";
process.env.EMAIL_FROM = "Seat Planner <tickets@railway.example-mail.com>";

const received = [];
let reply = { status: 201, body: '{"messageId":"<test@brevo>"}' };
let stall = false;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    received.push({ method: req.method, headers: req.headers, body: JSON.parse(body || "{}") });
    if (stall) return; // never answers
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(reply.body);
  });
});

let email;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.BREVO_API_URL = `http://127.0.0.1:${server.address().port}/v3/smtp/email`;
  email = require("../src/services/emailService");
});

test.after(() => {
  server.closeAllConnections?.();
  server.close();
});

test("a display-name address is split into name and email", () => {
  const { parseAddress } = require("../src/services/emailService");
  assert.deepEqual(parseAddress("Seat Planner <no-reply@x.com>"), { name: "Seat Planner", email: "no-reply@x.com" });
  assert.deepEqual(parseAddress('"Seat Planner" <no-reply@x.com>'), { name: "Seat Planner", email: "no-reply@x.com" });
  assert.deepEqual(parseAddress("<no-reply@x.com>"), { email: "no-reply@x.com" });
  assert.deepEqual(parseAddress("  no-reply@x.com "), { email: "no-reply@x.com" });
});

test("attachments are sent base64-encoded, under Brevo's field names", () => {
  const { brevoPayload } = require("../src/services/emailService");
  const pdf = Buffer.from("%PDF-1.4 ticket");
  const payload = brevoPayload({
    from: "Seat Planner <a@b.com>",
    to: "passenger@gmail.com",
    subject: "Tickets",
    html: "<p>hi</p>",
    attachments: [{ filename: "ticket.pdf", content: pdf, contentType: "application/pdf" }],
  });
  assert.deepEqual(payload.sender, { name: "Seat Planner", email: "a@b.com" });
  assert.deepEqual(payload.to, [{ email: "passenger@gmail.com" }]);
  assert.equal(payload.htmlContent, "<p>hi</p>");
  assert.deepEqual(payload.attachment, [{ name: "ticket.pdf", content: pdf.toString("base64") }]);
});

test("no attachment field when there is nothing attached", () => {
  const { brevoPayload } = require("../src/services/emailService");
  const payload = brevoPayload({ from: "a@b.com", to: "c@d.com", subject: "s", html: "h" });
  assert.equal("attachment" in payload, false);
});

test("a message goes to Brevo with the API key, and nowhere else", async () => {
  received.length = 0;
  await email.sendVerificationEmail("passenger@gmail.com", "123456", 10);
  assert.equal(received.length, 1);
  const [call] = received;
  assert.equal(call.method, "POST");
  assert.equal(call.headers["api-key"], "test-brevo-key");
  assert.deepEqual(call.body.to, [{ email: "passenger@gmail.com" }]);
  assert.deepEqual(call.body.sender, { name: "Seat Planner", email: "tickets@railway.example-mail.com" });
  assert.match(call.body.htmlContent, /123456/);
});

test("reserved addresses are still never sent, even with Brevo configured", async () => {
  received.length = 0;
  await email.sendVerificationEmail("unittest-user@example.com", "123456", 10);
  assert.equal(received.length, 0);
});

test("a refusal from Brevo becomes a 503 the person can act on", async () => {
  reply = { status: 401, body: '{"code":"unauthorized","message":"Key not found"}' };
  try {
    await assert.rejects(email.sendPasswordResetEmail("passenger@gmail.com", "654321", 10), (err) => {
      assert.equal(err.statusCode, 503);
      assert.match(err.message, /could not be sent/);
      // The cause stays in the server log, not in the answer.
      assert.doesNotMatch(err.message, /Key not found/);
      return true;
    });
  } finally {
    reply = { status: 201, body: "{}" };
  }
});

test("a Brevo that never answers is given up on, not waited for forever", { timeout: 30_000 }, async () => {
  stall = true;
  const started = Date.now();
  try {
    await assert.rejects(email.sendVerificationEmail("passenger@gmail.com", "111111", 10), (err) => err.statusCode === 503);
  } finally {
    stall = false;
  }
  const waited = Date.now() - started;
  assert.ok(waited < 20_000, `waited ${waited}ms`);
});
