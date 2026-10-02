const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

/*
 * Sending through the Gmail API — HTTPS, so it works where the host blocks
 * outbound SMTP.
 *
 * A local server stands in for Google's token and send endpoints, so these run
 * offline and send nothing. Settings are fixed before the email service loads,
 * because it decides its route once, at load.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";
process.env.DB_NAME = process.env.DB_NAME || "seat_planner";
process.env.DB_USER = process.env.DB_USER || "root";
process.env.GMAIL_CLIENT_ID = "test-client";
process.env.GMAIL_CLIENT_SECRET = "test-secret";
process.env.GMAIL_REFRESH_TOKEN = "test-refresh";
process.env.BREVO_API_KEY = "should-be-ignored-when-gmail-is-set";
process.env.EMAIL_FROM = "Seat Planner <me@gmail.com>";

const calls = { token: [], send: [] };
let tokenReply = () => ({ status: 200, body: { access_token: `access-${calls.token.length}`, expires_in: 3599 } });
let sendReply = () => ({ status: 200, body: { id: "msg-1" } });

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let reply;
    if (req.url === "/token") {
      calls.token.push(Object.fromEntries(new URLSearchParams(body)));
      reply = tokenReply();
    } else {
      calls.send.push({ auth: req.headers.authorization, body: JSON.parse(body || "{}") });
      reply = sendReply();
    }
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
});

let email;
const decode = (raw) => Buffer.from(raw, "base64url").toString("utf8");

test.before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.GMAIL_TOKEN_URL = `${base}/token`;
  process.env.GMAIL_SEND_URL = `${base}/send`;
  email = require("../../src/services/emailService");
});

test.after(() => {
  server.closeAllConnections?.();
  server.close();
});

test("a message is exchanged for a token, then sent as raw MIME with it", async () => {
  await email.sendVerificationEmail("passenger@gmail.com", "424242", 10);

  assert.equal(calls.token.length, 1);
  assert.deepEqual(calls.token[0], {
    client_id: "test-client",
    client_secret: "test-secret",
    refresh_token: "test-refresh",
    grant_type: "refresh_token",
  });

  assert.equal(calls.send.length, 1);
  assert.equal(calls.send[0].auth, "Bearer access-1");
  const mime = decode(calls.send[0].body.raw);
  assert.match(mime, /^To: passenger@gmail\.com/m);
  assert.match(mime, /^From: Seat Planner <me@gmail\.com>/m);
  assert.match(mime, /^Subject: Verify your email/m);
  assert.match(mime, /424242/);
});

test("the access token is reused, not fetched for every message", async () => {
  await email.sendPasswordResetEmail("passenger@gmail.com", "111111", 10);
  assert.equal(calls.token.length, 1, "a second token was fetched");
  assert.equal(calls.send.length, 2);
});

test("a ticket PDF travels as a MIME attachment", async () => {
  const pdf = Buffer.from("%PDF-1.4 a ticket");
  await email.sendMail({
    to: "passenger@gmail.com",
    subject: "Tickets confirmed",
    html: "<p>Your tickets</p>",
    attachments: [{ filename: "ticket-ABC123.pdf", content: pdf, contentType: "application/pdf" }],
  });
  const mime = decode(calls.send.at(-1).body.raw);
  assert.match(mime, /Content-Type: application\/pdf; name=ticket-ABC123\.pdf/);
  assert.match(mime, new RegExp(pdf.toString("base64")));
});

test("a token Google stops honouring is replaced, and the send retried once", async () => {
  const before = { token: calls.token.length, send: calls.send.length };
  let first = true;
  sendReply = () => {
    if (first) {
      first = false;
      return { status: 401, body: { error: { message: "Invalid Credentials" } } };
    }
    return { status: 200, body: { id: "msg-2" } };
  };
  try {
    await email.sendVerificationEmail("passenger@gmail.com", "222222", 10);
  } finally {
    sendReply = () => ({ status: 200, body: { id: "msg-1" } });
  }
  assert.equal(calls.token.length, before.token + 1, "a fresh token was not fetched");
  assert.equal(calls.send.length, before.send + 2);
});

test("an expired refresh token fails as a 503, with the cause in the log", async () => {
  tokenReply = () => ({ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } });
  sendReply = () => ({ status: 401, body: {} });
  const logged = [];
  const original = console.error;
  console.error = (line) => logged.push(String(line));
  try {
    await assert.rejects(email.sendVerificationEmail("passenger@gmail.com", "333333", 10), (err) => {
      assert.equal(err.statusCode, 503);
      assert.doesNotMatch(err.message, /invalid_grant/);
      return true;
    });
  } finally {
    console.error = original;
    tokenReply = () => ({ status: 200, body: { access_token: "access-again", expires_in: 3599 } });
    sendReply = () => ({ status: 200, body: { id: "msg-1" } });
  }
  assert.ok(logged.some((l) => /invalid_grant/.test(l) && /Testing/.test(l)), logged.join("\n"));
});

test("reserved addresses are still never sent", async () => {
  const before = calls.send.length;
  await email.sendVerificationEmail("unittest-user@example.com", "123456", 10);
  assert.equal(calls.send.length, before);
});
